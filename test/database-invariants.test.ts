import test from 'node:test';
import assert from 'node:assert/strict';
import { AppDatabase } from '../src/db/database.js';
import type { WithdrawalRecord } from '../src/domain/types.js';
import { createNodeSqliteTestDriver } from './support/node-sqlite-driver.js';

function record(overrides: Partial<WithdrawalRecord> = {}): WithdrawalRecord {
  return {
    id: 'wd_00000000-0000-4000-8000-000000000001',
    accountId: 'acc_1001',
    subjectId: 'user_alice',
    status: 'authorised',
    authorisationCode: 'ABCD-EFGH-JKLM-NPQR',
    amountUsdCents: 1_000,
    targetCurrency: 'EUR',
    convertedAmount: '9.20',
    exchangeRate: '0.92',
    fxProvider: 'fake',
    fxEffectiveDate: '2026-10-16',
    createdAt: '2026-10-17T00:00:00.000Z',
    expiresAt: '2026-10-17T00:05:00.000Z',
    requestHash: 'hash-1',
    ...overrides,
  };
}

test('rolls back the reservation if the withdrawal audit record cannot be persisted', () => {
  const db = new AppDatabase(':memory:', createNodeSqliteTestDriver);
  db.seedDemoData();
  try {
    db.commitAuthorisation(record());
    assert.equal(db.getBalance('acc_1001'), 100_000);
    assert.equal(db.getReservedBalance('acc_1001'), 1_000);

    assert.throws(() => db.commitAuthorisation(record({
      id: 'wd_00000000-0000-4000-8000-000000000002',
      amountUsdCents: 2_000,
      requestHash: 'hash-2',
      authorisationCode: 'ABCD-EFGH-JKLM-NPQR', // force unique constraint failure after reserve UPDATE
    })));

    assert.equal(db.getBalance('acc_1001'), 100_000, 'posted balance is never settled by authorisation');
    assert.equal(db.getReservedBalance('acc_1001'), 1_000, 'failed audit insert must roll the second reservation back');
  } finally {
    db.close();
  }
});


test('availability projects expired funds without writes and failed persistence rolls cleanup back', () => {
  const db = new AppDatabase(':memory:', createNodeSqliteTestDriver);
  db.seedDemoData();
  try {
    db.commitAuthorisation(record({ amountUsdCents: 90_000 }));
    db.commitAuthorisation(record({
      id: 'wd_active', authorisationCode: 'ACTIVE', amountUsdCents: 5_000,
      expiresAt: '2026-10-17T00:10:00.000Z',
    }));
    const now = '2026-10-17T00:05:00.000Z'; // expiry is inclusive
    const before = db.db.prepare('SELECT total_changes() AS changes').get();
    assert.equal(db.getAccessibleAvailableBalance('user_alice', 'acc_1001', now), 95_000);
    assert.equal(db.getAccessibleAvailableBalance('user_bob', 'acc_1001', now), null);
    assert.equal(db.getAccessibleAvailableBalance('user_alice', 'missing', now), null);
    assert.deepEqual(db.db.prepare('SELECT total_changes() AS changes').get(), before);
    assert.equal(db.getReservedBalance('acc_1001'), 95_000);

    // Cleanup and the new reserve fit, but duplicate code forces persistence failure.
    assert.throws(() => db.commitAuthorisation(record({
      id: 'wd_failed', createdAt: now, expiresAt: '2026-10-17T00:15:00.000Z', amountUsdCents: 90_000,
    })), /UNIQUE constraint failed: withdrawals.authorisation_code/);
    assert.equal(db.getReservedBalance('acc_1001'), 95_000);
    assert.equal((db.db.prepare('SELECT reservation_released_at FROM withdrawals WHERE id = ?').get(record().id) as { reservation_released_at: string | null }).reservation_released_at, null);
    assert.equal(db.db.prepare('SELECT id FROM withdrawals WHERE id = ?').get('wd_failed'), undefined);

    db.commitAuthorisation(record({
      id: 'wd_success', authorisationCode: 'SUCCESS', createdAt: now,
      expiresAt: '2026-10-17T00:15:00.000Z', amountUsdCents: 90_000,
    }));
    assert.equal(db.getReservedBalance('acc_1001'), 95_000);
    assert.equal(db.getBalance('acc_1001'), 100_000);
    assert.equal((db.db.prepare('SELECT reservation_released_at FROM withdrawals WHERE id = ?').get(record().id) as { reservation_released_at: string | null }).reservation_released_at, now);
    assert.equal(db.getAccessibleAvailableBalance('user_alice', 'acc_1001', now), 5_000, 'released holds must not be discounted twice');
  } finally { db.close(); }
});
