import { seedDemoData } from '../src/db/demo-seed.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { AppDatabase } from '../src/db/database.js';
import { createNodeSqliteTestDriver } from './support/node-sqlite-driver.js';

test('fresh database does not implicitly provision demo credentials', () => {
  const db = new AppDatabase(':memory:', createNodeSqliteTestDriver);
  try {
    assert.equal(db.authenticateToken('demo-alice-token'), null);
    assert.equal(db.getBalance('acc_1001'), null);
  } finally {
    db.close();
  }
});

test('demo seed covers multiple, single, zero, shared, unassigned and revoked access scenarios', () => {
  const db = new AppDatabase(':memory:', createNodeSqliteTestDriver);
  seedDemoData(db.db);
  try {
    assert.equal(db.authenticateToken('demo-alice-token'), 'user_alice');
    assert.equal(db.authenticateToken('demo-bob-token'), 'user_bob');
    assert.equal(db.authenticateToken('demo-carol-token'), 'user_carol');
    assert.equal(db.authenticateToken('demo-dave-token'), 'user_dave');
    assert.equal(db.authenticateToken('demo-revoked-token'), null);

    const now = '2026-10-17T12:00:00.000Z';
    assert.equal(db.getAccessibleAvailableBalance('user_alice', 'acc_1001', now), 100_000);
    assert.equal(db.getAccessibleAvailableBalance('user_alice', 'acc_1002', now), 50_000);
    assert.equal(db.getAccessibleAvailableBalance('user_alice', 'acc_shared', now), 75_000);

    assert.equal(db.getAccessibleAvailableBalance('user_bob', 'acc_2001', now), 25_000);
    assert.equal(db.getAccessibleAvailableBalance('user_bob', 'acc_1001', now), null);

    assert.equal(db.getAccessibleAvailableBalance('user_carol', 'acc_1001', now), null);
    assert.equal(db.getAccessibleAvailableBalance('user_carol', 'acc_unassigned', now), null);

    assert.equal(db.getAccessibleAvailableBalance('user_dave', 'acc_shared', now), 75_000);
    assert.equal(db.getAccessibleAvailableBalance('user_dave', 'acc_2001', now), 25_000);

    assert.equal(db.getAccessibleAvailableBalance('user_alice', 'acc_unassigned', now), null);
  } finally {
    db.close();
  }
});


test('explicit reseeding preserves existing balances, revoked credentials and denied grants', () => {
  const db = new AppDatabase(':memory:', createNodeSqliteTestDriver);
  try {
    seedDemoData(db.db);
    const accounts = db.db.prepare('SELECT COUNT(*) AS count FROM accounts').get();
    const tokens = db.db.prepare('SELECT COUNT(*) AS count FROM api_tokens').get();
    db.db.prepare('UPDATE accounts SET balance_usd_cents = 99000 WHERE id = ?').run('acc_1001');
    db.db.prepare('UPDATE api_tokens SET revoked_at = ? WHERE subject_id = ?').run('2026-10-17T12:00:00.000Z', 'user_alice');
    db.db.prepare('UPDATE account_permissions SET can_withdraw = 0 WHERE subject_id = ? AND account_id = ?').run('user_bob', 'acc_2001');
    seedDemoData(db.db);
    assert.equal(db.getBalance('acc_1001'), 99_000);
    assert.equal(db.authenticateToken('demo-alice-token'), null);
    assert.equal(db.getAccessibleAvailableBalance('user_bob', 'acc_2001', '2026-10-17T12:01:00.000Z'), null);
    assert.deepEqual(db.db.prepare('SELECT COUNT(*) AS count FROM accounts').get(), accounts);
    assert.deepEqual(db.db.prepare('SELECT COUNT(*) AS count FROM api_tokens').get(), tokens);
  } finally { db.close(); }
});
