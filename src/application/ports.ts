import type { FxQuote, WithdrawalRecord } from '../domain/types.js';

export interface AuthenticationStore {
  authenticateToken(token: string): string | null;
}

export interface WithdrawalStore {
  /**
   * Read-only projection of available USD funds, discounting unreleased holds
   * expired at nowIso without changing balances or withdrawal records. Returns
   * null for missing/inaccessible accounts. commitAuthorisation remains authoritative.
   */
  getAccessibleAvailableBalance(subjectId: string, accountId: string, nowIso: string): number | null;

  findWithdrawalByIdempotency(subjectId: string, key: string): WithdrawalRecord | null;

  /**
   * Atomically revalidates account access, releases expired reservations,
   * reserves available funds, and persists the withdrawal authorisation.
   */
  commitAuthorisation(record: WithdrawalRecord): { record: WithdrawalRecord; replayed: boolean };
}

export interface ExchangeRateProvider {
  getQuote(from: string, to: string): Promise<FxQuote>;
}
