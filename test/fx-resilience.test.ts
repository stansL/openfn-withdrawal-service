import test from 'node:test';
import { createServer, type RequestListener } from 'node:http';
import type { AddressInfo } from 'node:net';
import assert from 'node:assert/strict';
import { FrankfurterClient, ProviderRequestError, ResilientExchangeRateProvider, parseFrankfurterV2Rate, type RawFxClient } from '../src/fx/exchange-rate.js';
import type { FxQuote } from '../src/domain/types.js';
import { FxPairUnsupportedError, FxUnavailableError } from '../src/domain/errors.js';

class ScriptedClient implements RawFxClient {
  calls = 0;
  constructor(private readonly script: Array<Error | FxQuote>) {}
  async fetchRate(): Promise<FxQuote> {
    const value = this.script[Math.min(this.calls, this.script.length - 1)]!;
    this.calls++;
    if (value instanceof Error) throw value;
    return value;
  }
}

const quote: FxQuote = { rate: '0.923456', provider: 'fake', effectiveDate: '2026-10-16' };

test('preserves provider rate text from JSON numeric source', () => {
  assert.deepEqual(
    parseFrankfurterV2Rate('{"date":"2026-10-16","base":"USD","quote":"EUR","rate":0.923456}', 'USD', 'EUR'),
    { rate: '0.923456', effectiveDate: '2026-10-16' },
  );
});

test('retries bounded transient failures and succeeds', async () => {
  const client = new ScriptedClient([new ProviderRequestError('temporary', true), quote]);
  const sleeps: number[] = [];
  const provider = new ResilientExchangeRateProvider(client, {
    timeoutMs: 100, maxAttempts: 2, initialBackoffMs: 100, failureThreshold: 3, cooldownMs: 1000,
    random: () => 0.5, sleep: async (ms) => { sleeps.push(ms); },
  });
  const result = await provider.getQuote('USD', 'EUR');
  assert.equal(result.rate, quote.rate);
  assert.equal(client.calls, 2);
  assert.deepEqual(sleeps, [50]);
});

test('does not retry a non-retryable provider response', async () => {
  const client = new ScriptedClient([new ProviderRequestError('bad request', false)]);
  const provider = new ResilientExchangeRateProvider(client, {
    timeoutMs: 100, maxAttempts: 3, initialBackoffMs: 1, failureThreshold: 3, cooldownMs: 1000, sleep: async () => {},
  });
  await assert.rejects(provider.getQuote('USD', 'EUR'), FxUnavailableError);
  assert.equal(client.calls, 1);
});

test('opens the circuit after repeated dependency failures', async () => {
  let now = 0;
  const client = new ScriptedClient([new ProviderRequestError('down', true)]);
  const provider = new ResilientExchangeRateProvider(client, {
    timeoutMs: 100, maxAttempts: 1, initialBackoffMs: 1, failureThreshold: 2, cooldownMs: 1000,
    now: () => now, sleep: async () => {},
  });
  await assert.rejects(provider.getQuote('USD', 'EUR'), FxUnavailableError);
  await assert.rejects(provider.getQuote('USD', 'EUR'), FxUnavailableError);
  assert.equal(client.calls, 2);
  await assert.rejects(provider.getQuote('USD', 'EUR'), /circuit is open/);
  assert.equal(client.calls, 2, 'open circuit should fail fast without calling dependency');
  now = 1001;
  await assert.rejects(provider.getQuote('USD', 'EUR'), FxUnavailableError);
  assert.equal(client.calls, 3, 'half-open circuit should probe dependency after cooldown');
});

test('validates provider currency-pair provenance before accepting a rate', () => {
  assert.equal(
    parseFrankfurterV2Rate('{"date":"2026-10-16","base":"USD","quote":"GBP","rate":0.8}', 'USD', 'EUR'),
    null,
  );
});

test('maps an unsupported provider currency pair to a non-retryable 422 domain error', async () => {
  const client = new ScriptedClient([new ProviderRequestError('unsupported', false, 'unsupported_pair')]);
  const provider = new ResilientExchangeRateProvider(client, {
    timeoutMs: 100, maxAttempts: 3, initialBackoffMs: 1, failureThreshold: 3, cooldownMs: 1000, sleep: async () => {},
  });
  await assert.rejects(provider.getQuote('USD', 'EUR'), FxPairUnsupportedError);
  assert.equal(client.calls, 1);
});


async function withProviderServer(handler: RequestListener, run: (baseUrl: string) => Promise<void>) {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    // Ensure a broken timeout cannot leave the deliberately stalled server hanging.
    await Promise.race([
      run(`http://127.0.0.1:${port}`),
      new Promise<never>((_resolve, reject) => {
        deadline = setTimeout(() => reject(new Error('Local FX scenario did not complete')), 5_000);
      }),
    ]);
  } finally {
    clearTimeout(deadline);
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

const providerJson = '{"date":"2026-10-16","base":"USD","quote":"EUR","rate":0.9234567890123456789}';

test('Frankfurter HTTP client uses the expected pair path and preserves the exact numeric rate', async () => {
  await withProviderServer((req, res) => {
    assert.equal(req.url, '/v2/rate/usd/eur');
    res.setHeader('content-type', 'application/json');
    res.end(providerJson);
  }, async baseUrl => {
    const result = await new FrankfurterClient(baseUrl).fetchRate('USD', 'EUR', new AbortController().signal);
    assert.deepEqual(result, { rate: '0.9234567890123456789', provider: 'frankfurter-v2', effectiveDate: '2026-10-16' });
  });
});

test('Frankfurter HTTP failures retry only transient responses and reject malformed provenance', async () => {
  for (const scenario of [
    { statuses: [429, 503, 200], body: providerJson, expectedCalls: 3, error: undefined },
    { statuses: [422], body: '{}', expectedCalls: 1, error: FxPairUnsupportedError },
    { statuses: [400], body: '{}', expectedCalls: 1, error: FxUnavailableError },
    { statuses: [503], body: '{}', expectedCalls: 3, error: FxUnavailableError },
    { statuses: [200], body: '{', expectedCalls: 2, error: FxUnavailableError },
    { statuses: [200], body: providerJson.replace('EUR', 'GBP'), expectedCalls: 2, error: FxUnavailableError },
  ]) {
    let calls = 0;
    await withProviderServer((_req, res) => {
      res.statusCode = scenario.statuses[Math.min(calls++, scenario.statuses.length - 1)]!;
      res.end(scenario.body);
    }, async baseUrl => {
      const provider = new ResilientExchangeRateProvider(new FrankfurterClient(baseUrl), {
        timeoutMs: 1000, maxAttempts: scenario.expectedCalls === 1 ? 3 : scenario.expectedCalls, initialBackoffMs: 1,
        failureThreshold: 3, cooldownMs: 1000, sleep: async () => {},
      });
      if (scenario.error) await assert.rejects(provider.getQuote('USD', 'EUR'), scenario.error);
      else assert.equal((await provider.getQuote('USD', 'EUR')).rate, '0.9234567890123456789');
      assert.equal(calls, scenario.expectedCalls);
    });
  }
});

test('FX timeout aborts HTTP requests stalled before headers or during the body', { timeout: 10_000 }, async () => {
  for (const sendHeaders of [false, true]) {
    let calls = 0;
    let observeClose!: () => void;
    const closed = new Promise<void>(resolve => { observeClose = resolve; });
    await withProviderServer((_req, res) => {
      calls++;
      res.on('close', observeClose);
      if (sendHeaders) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.write('{"date":');
      }
      // No completion: cancellation must come from the client's timeout.
    }, async baseUrl => {
      const provider = new ResilientExchangeRateProvider(new FrankfurterClient(baseUrl), {
        timeoutMs: 500, maxAttempts: 1, initialBackoffMs: 1, failureThreshold: 1, cooldownMs: 1000,
      });
      await assert.rejects(provider.getQuote('USD', 'EUR'), FxUnavailableError);
      await closed;
      assert.equal(calls, 1);
      await assert.rejects(provider.getQuote('USD', 'EUR'), /circuit is open/);
      assert.equal(calls, 1);
    });
  }
});

test('successful half-open recovery permits only one probe and closes the circuit', async () => {
  let now = 0;
  let calls = 0;
  let finishProbe!: (value: FxQuote) => void;
  const probe = new Promise<FxQuote>(resolve => { finishProbe = resolve; });
  const client: RawFxClient = { fetchRate: async () => {
    calls++;
    if (calls === 1) throw new ProviderRequestError('down', true);
    if (calls === 2) return probe;
    return quote;
  } };
  const provider = new ResilientExchangeRateProvider(client, {
    timeoutMs: 1000, maxAttempts: 1, initialBackoffMs: 1, failureThreshold: 1, cooldownMs: 100,
    now: () => now,
  });
  await assert.rejects(provider.getQuote('USD', 'EUR'), FxUnavailableError);
  now = 100;
  const recovering = provider.getQuote('USD', 'EUR');
  await assert.rejects(provider.getQuote('USD', 'EUR'), /probe is already in progress/);
  assert.equal(calls, 2);
  finishProbe(quote);
  assert.equal((await recovering).rate, quote.rate);
  assert.equal((await provider.getQuote('USD', 'EUR')).rate, quote.rate);
  assert.equal(calls, 3);
});
