import type { SqlDatabase } from './sql-driver.js';
import { hashToken } from '../auth/token-hash.js';

/**
 * Explicit development/test fixture provisioning. Normal server startup never
 * creates accounts or credentials implicitly.
 *
 * Matrix:
 * - Alice: multiple accounts (including a shared account)
 * - Bob: exactly one account
 * - Carol: authenticated principal with no account access
 * - Dave: multiple accounts and shared ownership, exercising many-to-many grants
 * - acc_unassigned: valid account with no user grants
 * - demo-revoked-token: known but revoked credential
 */
export function seedDemoData(db: SqlDatabase): void {
  const now = new Date().toISOString();
  const insertAccount = db.prepare(`
    INSERT OR IGNORE INTO accounts(id, balance_usd_cents, reserved_usd_cents, created_at)
    VALUES (?, ?, 0, ?)
  `);
  for (const [id, cents] of [
    ['acc_1001', 100_000],
    ['acc_1002', 50_000],
    ['acc_2001', 25_000],
    ['acc_shared', 75_000],
    ['acc_unassigned', 90_000],
  ] as const) insertAccount.run(id, cents, now);

  const insertToken = db.prepare(`
    INSERT OR IGNORE INTO api_tokens(token_hash, subject_id, revoked_at) VALUES (?, ?, ?)
  `);
  insertToken.run(hashToken('demo-alice-token'), 'user_alice', null);
  insertToken.run(hashToken('demo-bob-token'), 'user_bob', null);
  insertToken.run(hashToken('demo-carol-token'), 'user_carol', null);
  insertToken.run(hashToken('demo-dave-token'), 'user_dave', null);
  insertToken.run(hashToken('demo-revoked-token'), 'user_revoked', now);

  const grant = db.prepare(`
    INSERT OR IGNORE INTO account_permissions(subject_id, account_id, can_withdraw)
    VALUES (?, ?, 1)
  `);
  for (const [subject, account] of [
    ['user_alice', 'acc_1001'],
    ['user_alice', 'acc_1002'],
    ['user_alice', 'acc_shared'],
    ['user_bob', 'acc_2001'],
    ['user_dave', 'acc_2001'],
    ['user_dave', 'acc_shared'],
  ] as const) grant.run(subject, account);
}
