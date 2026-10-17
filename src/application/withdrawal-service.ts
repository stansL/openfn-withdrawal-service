import { createHash, randomInt, randomUUID } from 'node:crypto';
import type { ExchangeRateProvider, WithdrawalStore } from './ports.js';
import { AccountNotFoundError, IdempotencyConflictError, InsufficientFundsError } from '../domain/errors.js';
import { canonicalAmount, currencyMinorUnits, multiplyDecimalByCents } from '../domain/money.js';
import type { Principal, WithdrawalRecord } from '../domain/types.js';

export interface AuthoriseWithdrawalCommand {
  accountId: string;
  amountUsdCents: number;
  targetCurrency: string;
  idempotencyKey?: string;
}

export interface AuthoriseWithdrawalResult {
  withdrawal: WithdrawalRecord;
  replayed: boolean;
}

export interface WithdrawalServiceOptions {
  authorisationTtlMs: number;
}

export class WithdrawalService {
  constructor(
    private readonly store: WithdrawalStore,
    private readonly fx: ExchangeRateProvider,
    private readonly options: WithdrawalServiceOptions = { authorisationTtlMs: 5 * 60_000 },
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async authorise(principal: Principal, command: AuthoriseWithdrawalCommand): Promise<AuthoriseWithdrawalResult> {
    const now = this.clock();
    const availableBalance = this.store.getAccessibleAvailableBalance(
      principal.subjectId,
      command.accountId,
      now.toISOString(),
    );
    if (availableBalance == null) throw new AccountNotFoundError();

    const requestHash = hashRequest(command.accountId, command.amountUsdCents, command.targetCurrency);

    if (command.idempotencyKey) {
      const existing = this.store.findWithdrawalByIdempotency(principal.subjectId, command.idempotencyKey);
      if (existing) {
        if (existing.requestHash !== requestHash) throw new IdempotencyConflictError();
        return { withdrawal: existing, replayed: true };
      }
    }

    // Fast-fail only. The persistence transaction remains authoritative for
    // available funds and account authorisation at the reservation boundary.
    if (availableBalance < command.amountUsdCents) throw new InsufficientFundsError();

    const quote = await this.fx.getQuote('USD', command.targetCurrency);
    const convertedAmount = multiplyDecimalByCents(
      command.amountUsdCents,
      quote.rate,
      currencyMinorUnits(command.targetCurrency),
    );
    // Start the reservation lifetime after FX work, not at request/precheck time.
    const authorisedAt = this.clock();
    const createdAt = authorisedAt.toISOString();
    const expiresAt = new Date(authorisedAt.getTime() + this.options.authorisationTtlMs).toISOString();

    const withdrawal: WithdrawalRecord = {
      id: `wd_${randomUUID()}`,
      accountId: command.accountId,
      subjectId: principal.subjectId,
      status: 'authorised',
      authorisationCode: generateAuthorisationCode(),
      amountUsdCents: command.amountUsdCents,
      targetCurrency: command.targetCurrency,
      convertedAmount,
      exchangeRate: quote.rate,
      fxProvider: quote.provider,
      fxEffectiveDate: quote.effectiveDate,
      createdAt,
      expiresAt,
      requestHash,
    };
    if (command.idempotencyKey) withdrawal.idempotencyKey = command.idempotencyKey;

    const committed = this.store.commitAuthorisation(withdrawal);
    return { withdrawal: committed.record, replayed: committed.replayed };
  }
}

function hashRequest(accountId: string, amountUsdCents: number, targetCurrency: string): string {
  const canonical = `${accountId}|${canonicalAmount(amountUsdCents)}|${targetCurrency}`;
  return createHash('sha256').update(canonical).digest('hex');
}

function generateAuthorisationCode(): string {
  // 16 characters from a 32-symbol alphabet ~= 80 bits before formatting.
  // The DB uniqueness constraint remains the final collision guard.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 16; i++) code += alphabet[randomInt(0, alphabet.length)];
  return `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8, 12)}-${code.slice(12, 16)}`;
}
