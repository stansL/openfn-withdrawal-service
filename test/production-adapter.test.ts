import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AppDatabase } from '../src/db/database.js';
import type { WithdrawalRecord } from '../src/domain/types.js';

function record(): WithdrawalRecord {
  return {
    id: 'wd_00000000-0000-4000-8000-000000000099',
    accountId: 'acc_1001',
    subjectId: 'user_alice',
    status: 'authorised',
    authorisationCode: 'WXYZ-2345-6789-ABCD',
    amountUsdCents: 10_000,
    targetCurrency: 'EUR',
    convertedAmount: '92.00',
    exchangeRate: '0.92',
    fxProvider: 'fake',
    fxEffectiveDate: '2026-10-16',
    createdAt: '2026-10-17T12:00:00.000Z',
    expiresAt: '2026-10-17T12:05:00.000Z',
    idempotencyKey: 'prod-adapter-0001',
    requestHash: 'hash-prod-1',
  };
}

test('production better-sqlite3 adapter enforces reservation and idempotency invariants', async (t) => {
  let createBetterSqliteDriver: typeof import('../src/db/better-sqlite-driver.js').createBetterSqliteDriver;
  try {
    ({ createBetterSqliteDriver } = await import('../src/db/better-sqlite-driver.js'));
  } catch (error) {
    // In a normal `npm ci` environment this dependency is present and this test runs.
    // The skip only supports constrained sandboxes where native npm dependencies cannot be installed.
    t.skip(`better-sqlite3 unavailable in this runtime: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  const dir = mkdtempSync(join(tmpdir(), 'openfn-withdrawal-'));
  const path = join(dir, 'service.sqlite');
  const db = new AppDatabase(path, createBetterSqliteDriver);
  try {
    db.seedDemoData();
    const first = db.commitAuthorisation(record());
    assert.equal(first.replayed, false);
    assert.equal(db.getBalance('acc_1001'), 100_000);
    assert.equal(db.getReservedBalance('acc_1001'), 10_000);

    const second = db.commitAuthorisation({ ...record(), id: 'wd_00000000-0000-4000-8000-000000000100' });
    assert.equal(second.replayed, true);
    assert.equal(second.record.id, first.record.id);
    assert.equal(second.record.expiresAt, first.record.expiresAt);
    assert.equal(db.findWithdrawalByIdempotency('user_alice', 'prod-adapter-0001')?.expiresAt, record().expiresAt);
    assert.equal(db.getReservedBalance('acc_1001'), 10_000);

    // A distinct operation with the same code must fail after reserve UPDATE and roll back.
    assert.throws(() => db.commitAuthorisation({
      ...record(), id: 'wd_collision', idempotencyKey: 'prod-collision-0001', requestHash: 'collision',
    }), /UNIQUE constraint failed: withdrawals.authorisation_code/);
    assert.equal(db.getBalance('acc_1001'), 100_000);
    assert.equal(db.getReservedBalance('acc_1001'), 10_000);
    assert.equal(db.findWithdrawalByIdempotency('user_alice', 'prod-collision-0001'), null);

    const now = record().expiresAt;
    const before = db.db.prepare('SELECT total_changes() AS changes').get();
    assert.equal(db.getAccessibleAvailableBalance('user_alice', 'acc_1001', now), 100_000);
    assert.deepEqual(db.db.prepare('SELECT total_changes() AS changes').get(), before);
    assert.equal(db.getReservedBalance('acc_1001'), 10_000);
    const next = {
      ...record(), id: 'wd_after_expiry', idempotencyKey: 'prod-expiry-0001', requestHash: 'expiry',
      createdAt: now, expiresAt: '2026-10-17T12:10:00.000Z', amountUsdCents: 95_000,
    };
    assert.throws(() => db.commitAuthorisation(next), /UNIQUE constraint failed: withdrawals.authorisation_code/);
    assert.equal(db.getReservedBalance('acc_1001'), 10_000, 'failed persistence rolls expiry cleanup back');
    assert.equal((db.db.prepare('SELECT reservation_released_at FROM withdrawals WHERE id = ?').get(record().id) as { reservation_released_at: string | null }).reservation_released_at, null);
    db.commitAuthorisation({ ...next, authorisationCode: 'NEXT-2345-6789-ABCD' });
    assert.equal(db.getReservedBalance('acc_1001'), 95_000);
    assert.equal(db.getBalance('acc_1001'), 100_000);
    assert.equal((db.db.prepare('SELECT reservation_released_at FROM withdrawals WHERE id = ?').get(record().id) as { reservation_released_at: string | null }).reservation_released_at, now);
    assert.equal(db.getAccessibleAvailableBalance('user_alice', 'acc_1001', now), 5_000);

  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
