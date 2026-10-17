export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class AuthenticationError extends AppError {
  constructor() { super('unauthenticated', 'A valid bearer token is required.', 401); }
}
export class ValidationError extends AppError {
  constructor(message: string) { super('invalid_request', message, 400); }
}
export class AccountNotFoundError extends AppError {
  constructor() { super('account_not_found', 'Account was not found.', 404); }
}
export class InsufficientFundsError extends AppError {
  constructor() { super('insufficient_funds', 'The account does not have enough available funds.', 409); }
}
export class IdempotencyConflictError extends AppError {
  constructor() { super('idempotency_conflict', 'The idempotency key was already used with a different request.', 409); }
}
export class FxPairUnsupportedError extends AppError {
  constructor() { super('fx_pair_unsupported', 'The requested currency pair is not supported by the exchange-rate provider.', 422); }
}
export class FxUnavailableError extends AppError {
  constructor(message = 'The exchange-rate service is temporarily unavailable.') {
    super('fx_unavailable', message, 503, true);
  }
}

export class MethodNotAllowedError extends AppError {
  constructor(public readonly allowedMethods: string[]) {
    super('method_not_allowed', 'Method is not supported for this route.', 405);
  }
}
export class UnsupportedMediaTypeError extends AppError {
  constructor() { super('unsupported_media_type', 'Content-Type must be application/json with UTF-8 encoding.', 415); }
}
export class PayloadTooLargeError extends AppError {
  constructor() { super('payload_too_large', 'Request body exceeds the 64 KiB limit.', 413); }
}
