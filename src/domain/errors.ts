export type DomainErrorCode =
  | 'unauthenticated' | 'invalid_request' | 'account_not_found'
  | 'insufficient_funds' | 'idempotency_conflict' | 'fx_pair_unsupported' | 'fx_unavailable';

export class DomainError extends Error {
  constructor(
    public readonly code: DomainErrorCode,
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class AuthenticationError extends DomainError {
  constructor() { super('unauthenticated', 'A valid bearer token is required.'); }
}
export class ValidationError extends DomainError {
  constructor(message: string) { super('invalid_request', message); }
}
export class AccountNotFoundError extends DomainError {
  constructor() { super('account_not_found', 'Account was not found.'); }
}
export class InsufficientFundsError extends DomainError {
  constructor() { super('insufficient_funds', 'The account does not have enough available funds.'); }
}
export class IdempotencyConflictError extends DomainError {
  constructor() { super('idempotency_conflict', 'The idempotency key was already used with a different request.'); }
}
export class FxPairUnsupportedError extends DomainError {
  constructor() { super('fx_pair_unsupported', 'The requested currency pair is not supported by the exchange-rate provider.'); }
}
export class FxUnavailableError extends DomainError {
  constructor(message = 'The exchange-rate service is temporarily unavailable.') {
    super('fx_unavailable', message);
  }
}
