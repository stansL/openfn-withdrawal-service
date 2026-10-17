import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { WithdrawalRecord } from '../domain/types.js';
import type { AuthenticationStore, WithdrawalStore } from '../application/ports.js';
import { AccountNotFoundError, IdempotencyConflictError, InsufficientFundsError } from '../domain/errors.js';

export type SqlParameter = string | number | bigint | null;

export interface SqlRunResult { changes: number }
export interface SqlStatement {
  run(...params: SqlParameter[]): SqlRunResult;
  get(...params: SqlParameter[]): unknown;
}
export interface SqlDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqlStatement;
  close(): void;
}
export type SqlDriverFactory = (path: string) => SqlDatabase;

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export class AppDatabase implements AuthenticationStore, WithdrawalStore {
  readonly db: SqlDatabase;

  constructor(path: string, driverFactory: SqlDriverFactory) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = driverFactory(path);
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec('PRAGMA busy_timeout = 5000;');
    if (path !== ':memory:') this.db.exec('PRAGMA journal_mode = WAL;');
    this.migrate();
  }

  migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        balance_usd_cents INTEGER NOT NULL CHECK (balance_usd_cents >= 0),
        reserved_usd_cents INTEGER NOT NULL DEFAULT 0 CHECK (reserved_usd_cents >= 0),
        created_at TEXT NOT NULL,
        CHECK (reserved_usd_cents <= balance_usd_cents)
      );

      CREATE TABLE IF NOT EXISTS api_tokens (
        token_hash TEXT PRIMARY KEY,
        subject_id TEXT NOT NULL,
        revoked_at TEXT
      );

      CREATE TABLE IF NOT EXISTS account_permissions (
        subject_id TEXT NOT NULL,
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        can_withdraw INTEGER NOT NULL CHECK (can_withdraw IN (0,1)),
        PRIMARY KEY (subject_id, account_id)
      );

      CREATE TABLE IF NOT EXISTS withdrawals (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES accounts(id),
        subject_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status = 'authorised'),
        authorisation_code TEXT NOT NULL UNIQUE,
        amount_usd_cents INTEGER NOT NULL CHECK (amount_usd_cents > 0),
        target_currency TEXT NOT NULL,
        converted_amount TEXT NOT NULL,
        exchange_rate TEXT NOT NULL,
        fx_provider TEXT NOT NULL,
        fx_effective_date TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        reservation_released_at TEXT,
        idempotency_key TEXT,
        request_hash TEXT
      );

      CREATE UNIQUE INDEX IF NOT EXISTS ux_withdrawal_idempotency
      ON withdrawals(subject_id, idempotency_key)
      WHERE idempotency_key IS NOT NULL;

      CREATE INDEX IF NOT EXISTS ix_withdrawal_expiry
      ON withdrawals(expires_at)
      WHERE reservation_released_at IS NULL;
    `);

    // Fail loudly if a developer points this version at the earlier exercise schema.
    // A real production service would use versioned migrations; for this take-home,
    // silently guessing how to reinterpret already-debited balances as reservations
    // would be less safe than requiring a fresh local exercise database.
    const reservedColumn = this.db.prepare(`
      SELECT 1 AS present FROM pragma_table_info('accounts') WHERE name = 'reserved_usd_cents'
    `).get() as { present: number } | undefined;
    const expiryColumn = this.db.prepare(`
      SELECT 1 AS present FROM pragma_table_info('withdrawals') WHERE name = 'expires_at'
    `).get() as { present: number } | undefined;
    if (!reservedColumn || !expiryColumn) {
      throw new Error('Incompatible exercise database schema. Use a fresh DATABASE_PATH for this version.');
    }
  }

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
  seedDemoData(): void {
    const now = new Date().toISOString();
    const insertAccount = this.db.prepare(`
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

    const insertToken = this.db.prepare(`
      INSERT OR IGNORE INTO api_tokens(token_hash, subject_id, revoked_at) VALUES (?, ?, ?)
    `);
    insertToken.run(hashToken('demo-alice-token'), 'user_alice', null);
    insertToken.run(hashToken('demo-bob-token'), 'user_bob', null);
    insertToken.run(hashToken('demo-carol-token'), 'user_carol', null);
    insertToken.run(hashToken('demo-dave-token'), 'user_dave', null);
    insertToken.run(hashToken('demo-revoked-token'), 'user_revoked', now);

    const grant = this.db.prepare(`
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

  authenticateToken(token: string): string | null {
    const row = this.db.prepare(`
      SELECT subject_id FROM api_tokens WHERE token_hash = ? AND revoked_at IS NULL
    `).get(hashToken(token)) as { subject_id: string } | undefined;
    return row?.subject_id ?? null;
  }

  getAccessibleAvailableBalance(subjectId: string, accountId: string, nowIso: string): number | null {
    // Project the same availability as expiry cleanup, without writing before FX.
    // The reservation transaction rechecks funds and applies cleanup atomically.
    const row = this.db.prepare(`
      SELECT a.balance_usd_cents - MAX(0, a.reserved_usd_cents - COALESCE((
        SELECT SUM(w.amount_usd_cents)
        FROM withdrawals w
        WHERE w.account_id = a.id
          AND w.reservation_released_at IS NULL
          AND w.expires_at <= ?
      ), 0)) AS available
      FROM accounts a
      JOIN account_permissions p ON p.account_id = a.id
      WHERE a.id = ? AND p.subject_id = ? AND p.can_withdraw = 1
    `).get(nowIso, accountId, subjectId) as { available: number } | undefined;
    return row?.available ?? null;
  }

  getBalance(accountId: string): number | null {
    const row = this.db.prepare(`SELECT balance_usd_cents AS balance FROM accounts WHERE id = ?`)
      .get(accountId) as { balance: number } | undefined;
    return row?.balance ?? null;
  }

  getReservedBalance(accountId: string): number | null {
    const row = this.db.prepare(`SELECT reserved_usd_cents AS reserved FROM accounts WHERE id = ?`)
      .get(accountId) as { reserved: number } | undefined;
    return row?.reserved ?? null;
  }

  getAvailableBalance(accountId: string): number | null {
    const row = this.db.prepare(`
      SELECT (balance_usd_cents - reserved_usd_cents) AS available FROM accounts WHERE id = ?
    `).get(accountId) as { available: number } | undefined;
    return row?.available ?? null;
  }

  findWithdrawalByIdempotency(subjectId: string, key: string): WithdrawalRecord | null {
    const row = this.db.prepare(`
      SELECT * FROM withdrawals WHERE subject_id = ? AND idempotency_key = ?
    `).get(subjectId, key) as Record<string, unknown> | undefined;
    return row ? this.mapWithdrawal(row) : null;
  }

  /**
   * Atomically reserves funds and persists the authorisation. Posted balance is
   * intentionally unchanged: this endpoint authorises a future withdrawal; it
   * does not implement capture/settlement.
   */
  commitAuthorisation(record: WithdrawalRecord): { record: WithdrawalRecord; replayed: boolean } {
    this.db.exec('BEGIN IMMEDIATE;');
    try {
      if (record.idempotencyKey) {
        const existing = this.findWithdrawalByIdempotency(record.subjectId, record.idempotencyKey);
        if (existing) {
          if (existing.requestHash !== record.requestHash) throw new IdempotencyConflictError();
          this.db.exec('COMMIT;');
          return { record: existing, replayed: true };
        }
      }

      this.releaseExpiredReservations(record.createdAt);

      const reserve = this.db.prepare(`
        UPDATE accounts
        SET reserved_usd_cents = reserved_usd_cents + ?
        WHERE id = ?
          AND (balance_usd_cents - reserved_usd_cents) >= ?
          AND EXISTS (
            SELECT 1 FROM account_permissions p
            WHERE p.account_id = accounts.id
              AND p.subject_id = ?
              AND p.can_withdraw = 1
          )
      `).run(record.amountUsdCents, record.accountId, record.amountUsdCents, record.subjectId);

      if (reserve.changes !== 1) {
        const permission = this.db.prepare(`
          SELECT 1 AS allowed FROM account_permissions
          WHERE account_id = ? AND subject_id = ? AND can_withdraw = 1
        `).get(record.accountId, record.subjectId) as { allowed: number } | undefined;
        // Deliberately collapse missing and inaccessible accounts to the same
        // external 404 semantics so this endpoint cannot enumerate account IDs.
        if (!permission) throw new AccountNotFoundError();
        throw new InsufficientFundsError();
      }

      this.db.prepare(`
        INSERT INTO withdrawals(
          id, account_id, subject_id, status, authorisation_code,
          amount_usd_cents, target_currency, converted_amount, exchange_rate,
          fx_provider, fx_effective_date, created_at, expires_at,
          reservation_released_at, idempotency_key, request_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
      `).run(
        record.id, record.accountId, record.subjectId, record.status, record.authorisationCode,
        record.amountUsdCents, record.targetCurrency, record.convertedAmount, record.exchangeRate,
        record.fxProvider, record.fxEffectiveDate, record.createdAt, record.expiresAt,
        record.idempotencyKey ?? null, record.requestHash ?? null,
      );

      this.db.exec('COMMIT;');
      return { record, replayed: false };
    } catch (error) {
      try { this.db.exec('ROLLBACK;'); } catch { /* transaction may already be closed */ }
      throw error;
    }
  }

  isReady(): boolean {
    try {
      const row = this.db.prepare('SELECT 1 AS ok').get() as { ok: number } | undefined;
      return row?.ok === 1;
    } catch {
      return false;
    }
  }

  close(): void { this.db.close(); }

  private releaseExpiredReservations(nowIso: string): void {
    // The minimal SQL adapter exposes get rather than all(), so release through
    // a correlated update, then mark the same expired authorisations released
    // inside this transaction.
    this.db.prepare(`
      UPDATE accounts
      SET reserved_usd_cents = MAX(0, reserved_usd_cents - COALESCE((
        SELECT SUM(w.amount_usd_cents)
        FROM withdrawals w
        WHERE w.account_id = accounts.id
          AND w.reservation_released_at IS NULL
          AND w.expires_at <= ?
      ), 0))
      WHERE EXISTS (
        SELECT 1 FROM withdrawals w
        WHERE w.account_id = accounts.id
          AND w.reservation_released_at IS NULL
          AND w.expires_at <= ?
      )
    `).run(nowIso, nowIso);
    this.db.prepare(`
      UPDATE withdrawals
      SET reservation_released_at = ?
      WHERE reservation_released_at IS NULL AND expires_at <= ?
    `).run(nowIso, nowIso);
  }

  private mapWithdrawal(row: Record<string, unknown>): WithdrawalRecord {
    const result: WithdrawalRecord = {
      id: String(row.id),
      accountId: String(row.account_id),
      subjectId: String(row.subject_id),
      status: 'authorised',
      authorisationCode: String(row.authorisation_code),
      amountUsdCents: Number(row.amount_usd_cents),
      targetCurrency: String(row.target_currency),
      convertedAmount: String(row.converted_amount),
      exchangeRate: String(row.exchange_rate),
      fxProvider: String(row.fx_provider),
      fxEffectiveDate: String(row.fx_effective_date),
      createdAt: String(row.created_at),
      expiresAt: String(row.expires_at),
    };
    if (row.idempotency_key != null) result.idempotencyKey = String(row.idempotency_key);
    if (row.request_hash != null) result.requestHash = String(row.request_hash);
    return result;
  }
}
