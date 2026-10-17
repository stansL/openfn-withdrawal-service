import type { SqlDatabase } from './sql-driver.js';

export function initializeSchema(db: SqlDatabase): void {
  db.exec(`
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
  const reservedColumn = db.prepare(`
    SELECT 1 AS present FROM pragma_table_info('accounts') WHERE name = 'reserved_usd_cents'
  `).get() as { present: number } | undefined;
  const expiryColumn = db.prepare(`
    SELECT 1 AS present FROM pragma_table_info('withdrawals') WHERE name = 'expires_at'
  `).get() as { present: number } | undefined;
  if (!reservedColumn || !expiryColumn) {
    throw new Error('Incompatible exercise database schema. Use a fresh DATABASE_PATH for this version.');
  }
}
