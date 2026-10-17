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
  db.seedDemoData();
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
