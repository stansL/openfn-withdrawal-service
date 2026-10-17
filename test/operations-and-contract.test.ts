import { seedDemoData } from '../src/db/demo-seed.js';
import test from 'node:test';
import { request } from 'node:http';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { AppDatabase } from '../src/db/database.js';
import { AuthService } from '../src/auth/auth-service.js';
import { WithdrawalService } from '../src/application/withdrawal-service.js';
import type { ExchangeRateProvider } from '../src/application/ports.js';
import type { FxQuote } from '../src/domain/types.js';
import { createHttpServer } from '../src/http/app.js';
import { FxPairUnsupportedError, FxUnavailableError } from '../src/domain/errors.js';
import { createNodeSqliteTestDriver } from './support/node-sqlite-driver.js';

class FakeFx implements ExchangeRateProvider {
  async getQuote(): Promise<FxQuote> {
    return { rate: '0.92', provider: 'fake', effectiveDate: '2026-10-16' };
  }
}

async function start(readiness = () => ({ ready: true, checks: { database: 'ok', lifecycle: 'accepting_traffic' } }), fx: ExchangeRateProvider = new FakeFx()) {
  const db = new AppDatabase(':memory:', createNodeSqliteTestDriver);
  seedDemoData(db.db);
  const server = createHttpServer({
    auth: new AuthService(db),
    withdrawals: new WithdrawalService(db, fx),
    readiness,
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    db,
    close: async () => {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      db.close();
    },
  };
}

test('serves an OpenAPI document generated from the registered route contracts', async () => {
  const app = await start();
  try {
    const response = await fetch(`${app.baseUrl}/openapi.json`);
    assert.equal(response.status, 200);
    const spec = await response.json() as any;
    assert.equal(spec.openapi, '3.0.3');
    assert.ok(spec.paths['/v1/accounts/{account_id}/withdrawals'].post);
    assert.ok(spec.paths['/healthz'].get);
    assert.ok(spec.paths['/readyz'].get);
    const operation = spec.paths['/v1/accounts/{account_id}/withdrawals'].post;
    assert.equal(operation.operationId, 'authoriseWithdrawal');
    const schema = operation.responses['201'].content['application/json'].schema;
    assert.ok(schema.required.includes('expires_at'));
    assert.equal(schema.properties.expires_at.format, 'date-time');
    assert.match(schema.properties.authorisation_code.example, new RegExp(schema.properties.authorisation_code.pattern));
    for (const status of ['405', '413', '415', '500']) {
      assert.ok(operation.responses[status].content['application/json'].schema.required.includes('error'));
    }
    assert.deepEqual(operation.responses['405'].headers.Allow.schema.enum, ['POST']);
    const authorised = await fetch(`${app.baseUrl}/v1/accounts/acc_1001/withdrawals`, {
      method: 'POST', headers: jsonHeaders, body: validBody,
    });
    assert.equal(authorised.status, 201);
    const result = await authorised.json() as Record<string, unknown>;
    assert.deepEqual(Object.keys(result).sort(), Object.keys(schema.properties).sort());
    for (const required of schema.required) assert.ok(Object.hasOwn(result, required));
    assert.match(String(result.expires_at), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  } finally {
    await app.close();
  }
});

test('serves Swagger UI pointing at the generated OpenAPI document', async () => {
  const app = await start();
  try {
    const response = await fetch(`${app.baseUrl}/docs`);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /swagger-ui/i);
    assert.match(html, /\/openapi\.json/);
  } finally {
    await app.close();
  }
});

test('readiness reports application lifecycle/database state without probing FX', async () => {
  const app = await start(() => ({ ready: false, checks: { database: 'ok', lifecycle: 'draining' } }));
  try {
    const response = await fetch(`${app.baseUrl}/readyz`);
    assert.equal(response.status, 503);
    const body = await response.json() as any;
    assert.equal(body.status, 'not_ready');
    assert.equal(body.checks.lifecycle, 'draining');

    const liveness = await fetch(`${app.baseUrl}/healthz`);
    assert.equal(liveness.status, 200);
  } finally {
    await app.close();
  }
});

test('returns a correlation id and includes it in structured errors', async () => {
  const app = await start();
  try {
    const response = await fetch(`${app.baseUrl}/v1/accounts/acc_1001/withdrawals`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-request-id': 'caller-request-123' },
      body: JSON.stringify({ amount: '10.00', target_currency: 'EUR' }),
    });
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('x-request-id'), 'caller-request-123');
    const body = await response.json() as any;
    assert.equal(body.error.request_id, 'caller-request-123');
  } finally {
    await app.close();
  }
});

test('replaces unsafe caller request ids rather than reflecting them', async () => {
  const app = await start();
  try {
    const response = await fetch(`${app.baseUrl}/healthz`, { headers: { 'x-request-id': 'bad id with spaces' } });
    assert.equal(response.status, 200);
    const requestId = response.headers.get('x-request-id');
    assert.ok(requestId);
    assert.notEqual(requestId, 'bad id with spaces');
  } finally {
    await app.close();
  }
});

test('rejects unsupported request fields so the runtime contract matches the API contract', async () => {
  const app = await start();
  try {
    const response = await fetch(`${app.baseUrl}/v1/accounts/acc_1001/withdrawals`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer demo-alice-token',
      },
      body: JSON.stringify({ amount: '10.00', target_currency: 'EUR', surprise: true }),
    });
    assert.equal(response.status, 400);
    const body = await response.json() as any;
    assert.equal(body.error.code, 'invalid_request');
  } finally {
    await app.close();
  }
});

async function assertError(response: Response, status: number, code: string) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.json() as any;
  assert.deepEqual(Object.keys(body), ['error']);
  assert.deepEqual(Object.keys(body.error).sort(), ['code', 'message', 'request_id']);
  assert.equal(body.error.code, code);
  assert.equal(body.error.request_id, response.headers.get('x-request-id'));
  assert.equal(body.error.request_id, 'hardening-request');
  return body;
}

const jsonHeaders = {
  authorization: 'Bearer demo-alice-token',
  'content-type': 'application/json',
  'x-request-id': 'hardening-request',
};
const validBody = JSON.stringify({ amount: '10.00', target_currency: 'EUR' });

test('known paths return 405 with Allow independently of account existence; unknown paths remain 404', async () => {
  const app = await start();
  try {
    for (const id of ['acc_1001', 'acc_2001', 'acc_missing', '%ZZ']) {
      const response = await fetch(`${app.baseUrl}/v1/accounts/${id}/withdrawals`, {
        headers: { 'x-request-id': 'hardening-request' },
      });
      assert.equal(response.headers.get('allow'), 'POST');
      await assertError(response, 405, 'method_not_allowed');
    }
    for (const path of ['/healthz', '/readyz', '/docs', '/openapi.json']) {
      const response = await fetch(`${app.baseUrl}${path}`, { method: 'POST', headers: jsonHeaders });
      assert.equal(response.headers.get('allow'), 'GET');
      await assertError(response, 405, 'method_not_allowed');
    }
    for (const method of ['GET', 'POST']) {
      const response = await fetch(`${app.baseUrl}/unknown`, { method, headers: jsonHeaders });
      assert.equal(response.headers.get('allow'), null);
      await assertError(response, 404, 'not_found');
    }
  } finally { await app.close(); }
});

test('media type validation distinguishes 415 from malformed JSON and preserves authentication precedence', async () => {
  const app = await start();
  const url = `${app.baseUrl}/v1/accounts/acc_1001/withdrawals`;
  try {
    for (const contentType of ['text/plain', 'application/jsonp', 'text/application/json', 'application/json; charset=iso-8859-1', 'invalid']) {
      await assertError(await fetch(url, {
        method: 'POST', headers: { ...jsonHeaders, 'content-type': contentType }, body: validBody,
      }), 415, 'unsupported_media_type');
    }
    await assertError(await fetch(url, { method: 'POST', headers: {
      authorization: jsonHeaders.authorization, 'x-request-id': 'hardening-request',
    } }), 415, 'unsupported_media_type');
    await assertError(await fetch(url, { method: 'POST', headers: jsonHeaders, body: '{' }), 400, 'invalid_request');
    const unauthenticated = await fetch(url, {
      method: 'POST', headers: { 'content-type': 'text/plain', 'x-request-id': 'hardening-request' }, body: validBody,
    });
    assert.equal(unauthenticated.headers.get('www-authenticate'), 'Bearer');
    await assertError(unauthenticated, 401, 'unauthenticated');
    for (const contentType of ['application/json', 'Application/JSON; charset="UTF-8"']) {
      const response = await fetch(url, { method: 'POST', headers: { ...jsonHeaders, 'content-type': contentType }, body: validBody });
      assert.equal(response.status, 201);
      await response.json();
    }
    // Only the two valid requests may reserve funds.
    assert.equal(app.db.getReservedBalance('acc_1001'), 2_000);
  } finally { await app.close(); }
});

test('enforces the 64 KiB byte limit and returns a structured 413', async () => {
  const app = await start();
  const url = `${app.baseUrl}/v1/accounts/acc_1001/withdrawals`;
  try {
    const atLimit = validBody + ' '.repeat(64 * 1024 - Buffer.byteLength(validBody));
    const accepted = await fetch(url, { method: 'POST', headers: jsonHeaders, body: atLimit });
    assert.equal(accepted.status, 201);
    await accepted.json();
    const rejected = await fetch(url, { method: 'POST', headers: jsonHeaders, body: atLimit + ' ' });
    await assertError(rejected, 413, 'payload_too_large');
    assert.equal(app.db.getReservedBalance('acc_1001'), 1_000);
  } finally { await app.close(); }
});

test('rejects a chunked oversized upload before the sender finishes its body', async () => {
  const app = await start();
  try {
    await new Promise<void>((resolve, reject) => {
      const req = request(`${app.baseUrl}/v1/accounts/acc_1001/withdrawals`, {
        method: 'POST', headers: jsonHeaders,
      }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          try {
            assert.equal(res.statusCode, 413);
            assert.equal(res.headers.connection, 'close');
            const body = JSON.parse(Buffer.concat(chunks).toString());
            assert.equal(body.error.code, 'payload_too_large');
            assert.equal(body.error.request_id, 'hardening-request');
            resolve();
          } catch (error) { reject(error); }
        });
        res.on('error', reject);
      });
      req.on('error', reject);
      req.setTimeout(3_000, () => req.destroy(new Error('Server waited for an oversized body to finish')));
      req.write(' '.repeat(32 * 1024));
      req.write(' '.repeat(32 * 1024));
      req.write(' ');
      // Intentionally do not end: the limit must be enforced while streaming.
    });
    assert.equal(app.db.getReservedBalance('acc_1001'), 0);
  } finally { await app.close(); }
});

test('unexpected failures return sanitized 500 envelopes and rejected credentials retain 401 semantics', async () => {
  const fx: ExchangeRateProvider = { getQuote: async () => { throw new Error('private-provider-detail'); } };
  const app = await start(undefined, fx);
  const url = `${app.baseUrl}/v1/accounts/acc_1001/withdrawals`;
  try {
    for (const authorization of ['Basic bad', 'Bearer invalid', 'Bearer demo-revoked-token']) {
      const response = await fetch(url, { method: 'POST', headers: { ...jsonHeaders, authorization }, body: validBody });
      assert.equal(response.headers.get('www-authenticate'), 'Bearer');
      await assertError(response, 401, 'unauthenticated');
    }
    const body = await assertError(await fetch(url, { method: 'POST', headers: jsonHeaders, body: validBody }), 500, 'internal_error');
    assert.equal(body.error.message, 'An unexpected error occurred.');
    assert.equal(app.db.getReservedBalance('acc_1001'), 0);
  } finally { await app.close(); }
});


test('FX domain failures retain HTTP status, code, message and retry headers', async () => {
  for (const [failure, status, code, retryAfter] of [
    [new FxPairUnsupportedError(), 422, 'fx_pair_unsupported', null],
    [new FxUnavailableError(), 503, 'fx_unavailable', '2'],
  ] as const) {
    const app = await start(undefined, { getQuote: async () => { throw failure; } });
    try {
      const response = await fetch(`${app.baseUrl}/v1/accounts/acc_1001/withdrawals`, {
        method: 'POST', headers: jsonHeaders, body: validBody,
      });
      assert.equal(response.headers.get('retry-after'), retryAfter);
      assert.equal(response.headers.get('www-authenticate'), null);
      const body = await assertError(response, status, code);
      assert.equal(body.error.message, failure.message);
      assert.equal(app.db.getReservedBalance('acc_1001'), 0);
    } finally { await app.close(); }
  }
});

test('an unexpected error cannot spoof a recognized failure code or leak its details', async () => {
  const app = await start(undefined, { getQuote: async () => {
    throw { code: 'fx_unavailable', status: 503, message: 'private-detail', retryable: true };
  } });
  try {
    const response = await fetch(`${app.baseUrl}/v1/accounts/acc_1001/withdrawals`, {
      method: 'POST', headers: jsonHeaders, body: validBody,
    });
    assert.equal(response.headers.get('retry-after'), null);
    const body = await assertError(response, 500, 'internal_error');
    assert.equal(body.error.message, 'An unexpected error occurred.');
    assert.equal(app.db.getReservedBalance('acc_1001'), 0);
  } finally { await app.close(); }
});
