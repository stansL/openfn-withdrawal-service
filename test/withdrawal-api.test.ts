import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { AppDatabase } from '../src/db/database.js';
import { AuthService } from '../src/auth/auth-service.js';
import { WithdrawalService } from '../src/application/withdrawal-service.js';
import type { ExchangeRateProvider } from '../src/fx/exchange-rate.js';
import type { FxQuote } from '../src/domain/types.js';
import { createHttpServer } from '../src/http/app.js';
import { FxUnavailableError } from '../src/domain/errors.js';
import { createNodeSqliteTestDriver } from './support/node-sqlite-driver.js';

class FakeFx implements ExchangeRateProvider {
  calls = 0;
  constructor(
    private readonly quote: FxQuote = { rate: '0.92', provider: 'fake', effectiveDate: '2026-10-16' },
    private readonly failure?: Error,
  ) {}
  async getQuote(): Promise<FxQuote> {
    this.calls++;
    if (this.failure) throw this.failure;
    return this.quote;
  }
}

interface AppOptions {
  fx?: FakeFx;
  clock?: () => Date;
  ttlMs?: number;
}

async function withApp(
  fn: (ctx: { baseUrl: string; db: AppDatabase; fx: FakeFx }) => Promise<void>,
  options: AppOptions = {},
) {
  const fx = options.fx ?? new FakeFx();
  const db = new AppDatabase(':memory:', createNodeSqliteTestDriver);
  db.seedDemoData();
  const server = createHttpServer({
    auth: new AuthService(db),
    withdrawals: new WithdrawalService(
      db,
      fx,
      { authorisationTtlMs: options.ttlMs ?? 5 * 60_000 },
      options.clock ?? (() => new Date('2026-10-17T12:00:00.000Z')),
    ),
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await fn({ baseUrl: `http://127.0.0.1:${port}`, db, fx });
  } finally {
    await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
    db.close();
  }
}

async function post(
  baseUrl: string,
  accountId: string,
  body: unknown,
  options: { token?: string; key?: string } = {},
) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (options.token !== undefined) headers.authorization = `Bearer ${options.token}`;
  if (options.key) headers['idempotency-key'] = options.key;
  return fetch(`${baseUrl}/v1/accounts/${accountId}/withdrawals`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

test('authorises a valid withdrawal by reserving funds without settling the posted balance', async () => {
  await withApp(async ({ baseUrl, db }) => {
    const response = await post(baseUrl, 'acc_1001', { amount: '125.50', target_currency: 'EUR' }, { token: 'demo-alice-token' });
    assert.equal(response.status, 201);
    const body = await response.json() as Record<string, unknown>;
    assert.equal(body.account_id, 'acc_1001');
    assert.equal(body.status, 'authorised');
    assert.equal(body.amount_usd, '125.50');
    assert.equal(body.converted_amount, '115.46');
    assert.equal(body.exchange_rate, '0.92');
    assert.equal(body.expires_at, '2026-10-17T12:05:00.000Z');
    const persisted = db.db.prepare('SELECT expires_at FROM withdrawals WHERE id = ?').get(String(body.id)) as { expires_at: string };
    assert.equal(body.expires_at, persisted.expires_at);
    assert.match(String(body.id), /^wd_[0-9a-f-]{36}$/);
    assert.match(String(body.authorisation_code), /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}(?:-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}){3}$/);

    assert.equal(db.getBalance('acc_1001'), 100_000, 'authorisation must not settle the posted balance');
    assert.equal(db.getReservedBalance('acc_1001'), 12_550);
    assert.equal(db.getAvailableBalance('acc_1001'), 87_450);
  });
});

test('requires authentication', async () => {
  await withApp(async ({ baseUrl }) => {
    const response = await post(baseUrl, 'acc_1001', { amount: '10.00', target_currency: 'EUR' });
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('www-authenticate'), 'Bearer');
  });
});

test('collapses inaccessible and nonexistent accounts to the same 404 to avoid account enumeration', async () => {
  await withApp(async ({ baseUrl }) => {
    const inaccessible = await post(baseUrl, 'acc_1001', { amount: '10.00', target_currency: 'EUR' }, { token: 'demo-bob-token' });
    const nonexistent = await post(baseUrl, 'acc_missing', { amount: '10.00', target_currency: 'EUR' }, { token: 'demo-bob-token' });
    assert.equal(inaccessible.status, 404);
    assert.equal(nonexistent.status, 404);
    const inaccessibleBody = await inaccessible.json() as any;
    const nonexistentBody = await nonexistent.json() as any;
    assert.equal(inaccessibleBody.error.code, 'account_not_found');
    assert.equal(nonexistentBody.error.code, 'account_not_found');
    assert.equal(inaccessibleBody.error.message, nonexistentBody.error.message);
  });
});

test('rejects invalid amount and currency', async () => {
  await withApp(async ({ baseUrl }) => {
    const badAmount = await post(baseUrl, 'acc_1001', { amount: '-1.00', target_currency: 'EUR' }, { token: 'demo-alice-token' });
    assert.equal(badAmount.status, 400);
    const badCurrency = await post(baseUrl, 'acc_1001', { amount: '10.00', target_currency: 'NOT' }, { token: 'demo-alice-token' });
    assert.equal(badCurrency.status, 400);
  });
});

test('revalidates authorisation at the reservation boundary', async () => {
  class RevokingFx implements ExchangeRateProvider {
    constructor(private readonly db: AppDatabase) {}
    async getQuote(): Promise<FxQuote> {
      this.db.db.prepare('DELETE FROM account_permissions WHERE subject_id = ? AND account_id = ?')
        .run('user_alice', 'acc_1001');
      return { rate: '0.92', provider: 'fake', effectiveDate: '2026-10-16' };
    }
  }

  const db = new AppDatabase(':memory:', createNodeSqliteTestDriver);
  db.seedDemoData();
  const server = createHttpServer({
    auth: new AuthService(db),
    withdrawals: new WithdrawalService(db, new RevokingFx(db), { authorisationTtlMs: 300_000 }, () => new Date('2026-10-17T12:00:00Z')),
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    const response = await post(`http://127.0.0.1:${port}`, 'acc_1001', { amount: '10.00', target_currency: 'EUR' }, { token: 'demo-alice-token' });
    assert.equal(response.status, 404);
    assert.equal(db.getBalance('acc_1001'), 100_000);
    assert.equal(db.getReservedBalance('acc_1001'), 0);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
    db.close();
  }
});

test('fast-fails insufficient available funds without calling FX', async () => {
  const fx = new FakeFx();
  await withApp(async ({ baseUrl, db }) => {
    const first = await post(baseUrl, 'acc_2001', { amount: '200.00', target_currency: 'EUR' }, { token: 'demo-bob-token', key: 'reserve-20000' });
    assert.equal(first.status, 201);
    assert.equal(db.getAvailableBalance('acc_2001'), 5_000);
    const beforeCalls = fx.calls;
    const response = await post(baseUrl, 'acc_2001', { amount: '50.01', target_currency: 'EUR' }, { token: 'demo-bob-token' });
    assert.equal(response.status, 409);
    assert.equal(fx.calls, beforeCalls);
  }, { fx });
});

test('does not reserve funds when the FX dependency is unavailable', async () => {
  const fx = new FakeFx(undefined, new FxUnavailableError());
  await withApp(async ({ baseUrl, db }) => {
    const response = await post(baseUrl, 'acc_1001', { amount: '100.00', target_currency: 'EUR' }, { token: 'demo-alice-token', key: 'fx-failure-0001' });
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('retry-after'), '2');
    assert.equal(db.getBalance('acc_1001'), 100_000);
    assert.equal(db.getReservedBalance('acc_1001'), 0);
  }, { fx });
});

test('replays the same successful operation without creating a second reservation', async () => {
  const fx = new FakeFx();
  let now = new Date('2026-10-17T12:00:00.000Z');
  await withApp(async ({ baseUrl, db }) => {
    const first = await post(baseUrl, 'acc_1001', { amount: '100.00', target_currency: 'EUR' }, { token: 'demo-alice-token', key: 'retry-key-0001' });
    const firstBody = await first.json() as any;
    now = new Date('2026-10-17T12:01:00.000Z');
    const second = await post(baseUrl, 'acc_1001', { amount: '100.00', target_currency: 'EUR' }, { token: 'demo-alice-token', key: 'retry-key-0001' });
    const secondBody = await second.json() as any;

    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    assert.equal(second.headers.get('idempotent-replayed'), 'true');
    assert.equal(secondBody.id, firstBody.id);
    assert.equal(firstBody.expires_at, '2026-10-17T12:02:03.000Z');
    assert.equal(secondBody.expires_at, firstBody.expires_at);
    assert.equal(secondBody.expires_at, db.findWithdrawalByIdempotency('user_alice', 'retry-key-0001')?.expiresAt);
    assert.equal(db.getBalance('acc_1001'), 100_000);
    assert.equal(db.getReservedBalance('acc_1001'), 10_000);
    assert.equal(fx.calls, 1);
  }, { fx, clock: () => now, ttlMs: 123_000 });
});

test('rejects reuse of an idempotency key with a different request', async () => {
  await withApp(async ({ baseUrl, db }) => {
    await post(baseUrl, 'acc_1001', { amount: '100.00', target_currency: 'EUR' }, { token: 'demo-alice-token', key: 'retry-key-0002' });
    const response = await post(baseUrl, 'acc_1001', { amount: '101.00', target_currency: 'EUR' }, { token: 'demo-alice-token', key: 'retry-key-0002' });
    assert.equal(response.status, 409);
    const body = await response.json() as any;
    assert.equal(body.error.code, 'idempotency_conflict');
    assert.equal(db.getReservedBalance('acc_1001'), 10_000);
  });
});

test('concurrent authorisations cannot over-reserve the same available funds', async () => {
  const fx = new FakeFx();
  await withApp(async ({ baseUrl, db }) => {
    db.db.prepare('UPDATE accounts SET balance_usd_cents = 15000, reserved_usd_cents = 0 WHERE id = ?').run('acc_1001');
    const responses = await Promise.all([
      post(baseUrl, 'acc_1001', { amount: '100.00', target_currency: 'EUR' }, { token: 'demo-alice-token', key: 'concurrent-0001' }),
      post(baseUrl, 'acc_1001', { amount: '100.00', target_currency: 'EUR' }, { token: 'demo-alice-token', key: 'concurrent-0002' }),
    ]);
    assert.deepEqual(responses.map(r => r.status).sort(), [201, 409]);
    assert.equal(db.getBalance('acc_1001'), 15_000);
    assert.equal(db.getReservedBalance('acc_1001'), 10_000);
    assert.equal(db.getAvailableBalance('acc_1001'), 5_000);
  }, { fx });
});

test('concurrent retries with the same idempotency key create one reservation', async () => {
  const fx = new FakeFx();
  await withApp(async ({ baseUrl, db }) => {
    const responses = await Promise.all([
      post(baseUrl, 'acc_1001', { amount: '100.00', target_currency: 'EUR' }, { token: 'demo-alice-token', key: 'same-operation-0001' }),
      post(baseUrl, 'acc_1001', { amount: '100.00', target_currency: 'EUR' }, { token: 'demo-alice-token', key: 'same-operation-0001' }),
    ]);
    assert.deepEqual(responses.map(r => r.status).sort(), [201, 201]);
    const bodies = await Promise.all(responses.map(r => r.json() as Promise<any>));
    assert.equal(bodies[0].id, bodies[1].id);
    assert.equal(bodies[0].expires_at, bodies[1].expires_at);
    assert.equal(bodies[0].expires_at, db.findWithdrawalByIdempotency('user_alice', 'same-operation-0001')?.expiresAt);
    assert.equal(db.getBalance('acc_1001'), 100_000);
    assert.equal(db.getReservedBalance('acc_1001'), 10_000);
    assert.equal(responses.map(r => r.headers.get('idempotent-replayed')).filter(v => v === 'true').length, 1);
  }, { fx });
});

test('expired authorisations release reserved funds lazily before the next decision', async () => {
  let now = new Date('2026-10-17T12:00:00.000Z');
  const clock = () => now;
  await withApp(async ({ baseUrl, db }) => {
    const first = await post(baseUrl, 'acc_2001', { amount: '200.00', target_currency: 'EUR' }, { token: 'demo-bob-token', key: 'expiring-0001' });
    assert.equal(first.status, 201);
    assert.equal(db.getAvailableBalance('acc_2001'), 5_000);

    now = new Date('2026-10-17T12:05:01.000Z');
    const second = await post(baseUrl, 'acc_2001', { amount: '200.00', target_currency: 'EUR' }, { token: 'demo-bob-token', key: 'after-expiry-0001' });
    assert.equal(second.status, 201);
    assert.equal(db.getBalance('acc_2001'), 25_000);
    assert.equal(db.getReservedBalance('acc_2001'), 20_000, 'old hold should release before new hold is applied');
  }, { clock, ttlMs: 5 * 60_000 });
});

test('rounds converted amounts deterministically to the target currency minor unit', async () => {
  await withApp(async ({ baseUrl }) => {
    const response = await post(baseUrl, 'acc_1001', { amount: '10.01', target_currency: 'JPY' }, { token: 'demo-alice-token' });
    assert.equal(response.status, 201);
    const body = await response.json() as any;
    assert.equal(body.converted_amount, '9'); // rate .92, JPY has zero minor units, half-up exercise policy
  }, { fx: new FakeFx({ rate: '0.92', provider: 'fake', effectiveDate: '2026-10-16' }) });
});


test('FX failure with expired holds on multiple accounts performs no database writes', async () => {
  class FailingAfterSetupFx extends FakeFx {
    fail = false;
    override async getQuote(): Promise<FxQuote> {
      if (this.fail) { this.calls++; throw new FxUnavailableError(); }
      return super.getQuote();
    }
  }
  const fx = new FailingAfterSetupFx();
  let now = new Date('2026-10-17T12:00:00.000Z');
  await withApp(async ({ baseUrl, db }) => {
    for (const accountId of ['acc_1001', 'acc_1002']) {
      const response = await post(baseUrl, accountId, { amount: '400.00', target_currency: 'EUR' }, { token: 'demo-alice-token', key: `expired-${accountId}` });
      assert.equal(response.status, 201);
      await response.json();
    }
    now = new Date('2026-10-17T12:05:00.000Z');
    fx.fail = true;
    const before = db.db.prepare('SELECT total_changes() AS changes').get();
    const response = await post(baseUrl, 'acc_1001', { amount: '900.00', target_currency: 'EUR' }, { token: 'demo-alice-token', key: 'failed-after-expiry' });
    assert.equal(response.status, 503, 'projected expired funds must pass precheck and reach FX');
    assert.equal(fx.calls, 3);
    assert.deepEqual(db.db.prepare('SELECT total_changes() AS changes').get(), before);
    assert.equal(db.findWithdrawalByIdempotency('user_alice', 'failed-after-expiry'), null);
    for (const accountId of ['acc_1001', 'acc_1002']) {
      assert.equal(db.getReservedBalance(accountId), 40_000);
      const release = db.db.prepare('SELECT reservation_released_at FROM withdrawals WHERE account_id = ?').get(accountId) as { reservation_released_at: string | null };
      assert.equal(release.reservation_released_at, null);
    }
    assert.equal(db.getBalance('acc_1001'), 100_000);
    assert.equal(db.getBalance('acc_1002'), 50_000);

    // Replay preserves the original expired success without cleanup or another FX call.
    const replay = await post(baseUrl, 'acc_1001', { amount: '400.00', target_currency: 'EUR' }, { token: 'demo-alice-token', key: 'expired-acc_1001' });
    assert.equal(replay.status, 201);
    assert.equal(replay.headers.get('idempotent-replayed'), 'true');
    assert.equal((await replay.json() as any).expires_at, now.toISOString());
    assert.equal(fx.calls, 3);
    assert.deepEqual(db.db.prepare('SELECT total_changes() AS changes').get(), before);
  }, { fx, clock: () => now });
});


test('concurrent authorisations competing for expired funds cannot over-reserve', async () => {
  let now = new Date('2026-10-17T12:00:00.000Z');
  await withApp(async ({ baseUrl, db }) => {
    const old = await post(baseUrl, 'acc_1001', { amount: '900.00', target_currency: 'EUR' }, { token: 'demo-alice-token', key: 'old-concurrent-hold' });
    assert.equal(old.status, 201);
    await old.json();
    now = new Date('2026-10-17T12:05:00.000Z');
    const responses = await Promise.all(['expired-race-1', 'expired-race-2'].map(key =>
      post(baseUrl, 'acc_1001', { amount: '900.00', target_currency: 'EUR' }, { token: 'demo-alice-token', key }),
    ));
    assert.deepEqual(responses.map(response => response.status).sort(), [201, 409]);
    await Promise.all(responses.map(response => response.json()));
    assert.equal(db.getBalance('acc_1001'), 100_000);
    assert.equal(db.getReservedBalance('acc_1001'), 90_000);
    assert.equal(db.getAccessibleAvailableBalance('user_alice', 'acc_1001', now.toISOString()), 10_000);
  }, { clock: () => now });
});


test('slow FX does not consume authorisation TTL and cleanup uses the post-FX time', async () => {
  let now = new Date('2026-10-17T12:00:00.000Z');
  class SlowFx extends FakeFx {
    delay = false;
    override async getQuote(): Promise<FxQuote> {
      if (this.delay) now = new Date('2026-10-17T12:10:00.000Z');
      return super.getQuote();
    }
  }
  const fx = new SlowFx();
  await withApp(async ({ baseUrl, db }) => {
    const old = await post(baseUrl, 'acc_1001', { amount: '100.00', target_currency: 'EUR' }, { token: 'demo-alice-token', key: 'ttl-old-hold' });
    assert.equal(old.status, 201);
    await old.json();
    now = new Date('2026-10-17T12:00:01.000Z');
    fx.delay = true;
    const response = await post(baseUrl, 'acc_1001', { amount: '100.00', target_currency: 'EUR' }, { token: 'demo-alice-token', key: 'ttl-slow-fx' });
    assert.equal(response.status, 201);
    const body = await response.json() as any;
    assert.equal(body.created_at, '2026-10-17T12:10:00.000Z');
    assert.equal(body.expires_at, '2026-10-17T12:10:30.000Z');
    assert.equal(db.findWithdrawalByIdempotency('user_alice', 'ttl-slow-fx')?.expiresAt, body.expires_at);
    assert.equal(db.getReservedBalance('acc_1001'), 10_000, 'hold that expired during FX must be released');
    assert.equal(db.getBalance('acc_1001'), 100_000);
    now = new Date('2026-10-17T12:10:10.000Z');
    const replay = await post(baseUrl, 'acc_1001', { amount: '100.00', target_currency: 'EUR' }, { token: 'demo-alice-token', key: 'ttl-slow-fx' });
    assert.equal(replay.status, 201);
    const replayBody = await replay.json() as any;
    assert.equal(replayBody.created_at, body.created_at);
    assert.equal(replayBody.expires_at, body.expires_at);
    assert.equal(fx.calls, 2);
  }, { fx, clock: () => now, ttlMs: 30_000 });
});
