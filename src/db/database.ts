import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { WithdrawalRecord } from '../domain/types.js';
import type { AuthenticationStore, WithdrawalStore } from '../application/ports.js';
import { initializeSchema } from './schema.js';
import { hashToken } from '../auth/token-hash.js';
import type { SqlDatabase, SqlDriverFactory } from './sql-driver.js';
import { AccountNotFoundError, IdempotencyConflictError, InsufficientFundsError } from '../domain/errors.js';

export class AppDatabase implements AuthenticationStore, WithdrawalStore {
  readonly db: SqlDatabase;

  constructor(path: string, driverFactory: SqlDriverFactory) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = driverFactory(path);
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec('PRAGMA busy_timeout = 5000;');
    if (path !== ':memory:') this.db.exec('PRAGMA journal_mode = WAL;');
    initializeSchema(this.db);
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
