import { DomainError, type DomainErrorCode } from '../domain/errors.js';

export class HttpError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly headers: Readonly<Record<string, string>> = {},
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class MethodNotAllowedError extends HttpError {
  constructor(allowedMethods: string[]) {
    super('method_not_allowed', 'Method is not supported for this route.', 405, { Allow: allowedMethods.join(', ') });
  }
}
export class UnsupportedMediaTypeError extends HttpError {
  constructor() { super('unsupported_media_type', 'Content-Type must be application/json with UTF-8 encoding.', 415); }
}
export class PayloadTooLargeError extends HttpError {
  constructor() { super('payload_too_large', 'Request body exceeds the 64 KiB limit.', 413); }
}

// Exhaustive mapping: adding a domain failure requires an explicit HTTP decision.
const domainResponses: Record<DomainErrorCode, { status: number; headers?: Record<string, string> }> = {
  unauthenticated: { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } },
  invalid_request: { status: 400 },
  account_not_found: { status: 404 },
  insufficient_funds: { status: 409 },
  idempotency_conflict: { status: 409 },
  fx_pair_unsupported: { status: 422 },
  fx_unavailable: { status: 503, headers: { 'Retry-After': '2' } },
};

export function toHttpError(error: unknown): HttpError | undefined {
  if (error instanceof HttpError) return error;
  if (error instanceof DomainError) {
    const response = domainResponses[error.code];
    return new HttpError(error.code, error.message, response.status, response.headers);
  }
  return undefined;
}
