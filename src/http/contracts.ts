import { ValidationError } from '../domain/errors.js';

export interface RouteContract {
  method: 'GET' | 'POST';
  path: string;
  operationId: string;
  summary: string;
  tags: string[];
  security?: Array<Record<string, string[]>>;
  parameters?: unknown[];
  requestBody?: unknown;
  responses: Record<string, unknown>;
}

export const withdrawalRequestSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['amount', 'target_currency'],
  properties: {
    amount: {
      type: 'string',
      pattern: '^\\d+(?:\\.\\d{1,2})?$',
      example: '125.50',
      description: 'USD amount as a decimal string with at most two fractional digits.',
    },
    target_currency: {
      type: 'string',
      minLength: 3,
      maxLength: 3,
      example: 'EUR',
      description: 'ISO 4217 target currency code.',
    },
  },
} as const;

export const withdrawalResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'account_id', 'status', 'authorisation_code', 'amount_usd', 'target_currency', 'converted_amount', 'exchange_rate', 'created_at', 'expires_at'],
  properties: {
    id: { type: 'string', example: 'wd_8f3k2' },
    account_id: { type: 'string', example: 'acc_1001' },
    status: { type: 'string', enum: ['authorised'] },
    authorisation_code: { type: 'string', example: 'ABCD-EFGH-JKLM-NPQR', pattern: '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}(?:-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}){3}$', description: 'Opaque server-side authorisation identifier; does not establish caller identity or account authority. Validity ends at expires_at.' },
    amount_usd: { type: 'string', example: '125.50' },
    target_currency: { type: 'string', example: 'EUR' },
    converted_amount: { type: 'string', example: '115.46' },
    exchange_rate: { type: 'string', example: '0.92' },
    created_at: { type: 'string', format: 'date-time', example: '2026-10-17T12:00:00.000Z' },
    expires_at: { type: 'string', format: 'date-time', example: '2026-10-17T12:05:00.000Z', description: 'Persisted UTC expiry of the original authorisation, unchanged on idempotent replay.' },
  },
} as const;

export const errorResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['error'],
  properties: {
    error: {
      type: 'object',
      additionalProperties: false,
      required: ['code', 'message', 'request_id'],
      properties: {
        code: { type: 'string', example: 'insufficient_funds' },
        message: { type: 'string', example: 'The account does not have enough funds.' },
        request_id: { type: 'string', example: 'ab4b7cb0-5c69-4ea3-9044-91a226807ad0' },
      },
    },
  },
} as const;

export const withdrawalContract: RouteContract = {
  method: 'POST',
  path: '/v1/accounts/{account_id}/withdrawals',
  operationId: 'authoriseWithdrawal',
  summary: 'Authorise a withdrawal from a USD-denominated account',
  tags: ['Withdrawals'],
  security: [{ bearerAuth: [] }],
  parameters: [
    {
      in: 'path',
      name: 'account_id',
      required: true,
      schema: { type: 'string', minLength: 1 },
      example: 'acc_1001',
    },
    {
      in: 'header',
      name: 'Idempotency-Key',
      required: false,
      schema: { type: 'string', minLength: 8, maxLength: 128, pattern: '^[A-Za-z0-9._:-]+$' },
      description: 'Optional stable operation identity. Reusing the same key with the same request replays the original success.',
    },
    {
      in: 'header',
      name: 'X-Request-Id',
      required: false,
      schema: { type: 'string', maxLength: 128 },
      description: 'Optional caller correlation ID. Unsafe/oversized values are replaced by the server.',
    },
  ],
  requestBody: {
    required: true,
    content: {
      'application/json': { schema: withdrawalRequestSchema },
    },
  },
  responses: {
    '201': {
      description: 'Withdrawal authorised and funds reserved; posted account balance is not settled by this endpoint.',
      headers: {
        'X-Request-Id': { schema: { type: 'string' }, description: 'Correlation ID for this request.' },
        'Idempotent-Replayed': { schema: { type: 'string', enum: ['true'] }, description: 'Present when an existing successful operation was replayed.' },
      },
      content: { 'application/json': { schema: withdrawalResponseSchema } },
    },
    '400': errorResponse('Invalid request.'),
    '401': errorResponse('Missing or invalid bearer token.'),
    '404': errorResponse('Account does not exist or is not visible to the authenticated caller.'),
    '405': { ...errorResponse('Unsupported method for this route.'), headers: { Allow: { schema: { type: 'string', enum: ['POST'] } } } },
    '413': errorResponse('Request body exceeds 64 KiB.'),
    '415': errorResponse('Content-Type must be application/json with UTF-8 encoding; charset=utf-8 is optional.'),
    '500': errorResponse('Unexpected internal failure.'),
    '409': errorResponse('Insufficient funds or idempotency conflict.'),
    '422': errorResponse('The requested ISO currency pair is not supported by the configured FX provider.'),
    '503': errorResponse('FX provider temporarily unavailable.'),
  },
};

export const healthContract: RouteContract = {
  method: 'GET',
  path: '/healthz',
  operationId: 'liveness',
  summary: 'Liveness probe',
  tags: ['Operations'],
  responses: {
    '200': {
      description: 'Process is alive.',
      content: { 'application/json': { schema: { type: 'object', required: ['status'], properties: { status: { type: 'string', enum: ['ok'] } } } } },
    },
  },
};

export const readinessContract: RouteContract = {
  method: 'GET',
  path: '/readyz',
  operationId: 'readiness',
  summary: 'Readiness probe',
  tags: ['Operations'],
  responses: {
    '200': {
      description: 'Service can accept withdrawal traffic.',
      content: { 'application/json': { schema: readinessSchema() } },
    },
    '503': {
      description: 'Service is alive but not ready (for example database unavailable or graceful shutdown in progress).',
      content: { 'application/json': { schema: readinessSchema() } },
    },
  },
};

export const routeContracts: RouteContract[] = [withdrawalContract, healthContract, readinessContract];

export function validateWithdrawalBody(payload: Record<string, unknown>): { amount: unknown; targetCurrency: unknown } {
  // Structural validation derives from the same contract object exported to OpenAPI.
  // Semantic validation (positive USD amount, supported ISO currency) remains in the domain helpers.
  const allowed = new Set(Object.keys(withdrawalRequestSchema.properties));
  if (Object.keys(payload).some((key) => !allowed.has(key))) {
    throw new ValidationError('Request body contains unsupported fields.');
  }
  for (const required of withdrawalRequestSchema.required) {
    if (!Object.hasOwn(payload, required)) throw new ValidationError('amount and target_currency are required.');
  }
  return { amount: payload.amount, targetCurrency: payload.target_currency };
}

export function buildOpenApiDocument(contracts: RouteContract[] = routeContracts): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const contract of contracts) {
    const operations = paths[contract.path] ?? {};
    operations[contract.method.toLowerCase()] = {
      operationId: contract.operationId,
      summary: contract.summary,
      tags: contract.tags,
      ...(contract.security ? { security: contract.security } : {}),
      ...(contract.parameters ? { parameters: contract.parameters } : {}),
      ...(contract.requestBody ? { requestBody: contract.requestBody } : {}),
      responses: contract.responses,
    };
    paths[contract.path] = operations;
  }

  return {
    openapi: '3.0.3',
    info: {
      title: 'OpenFn Withdrawal Service',
      version: '1.3.0',
      description: 'Technical-assessment API. Successful authorisation reserves available USD funds for a configurable time window; capture/settlement is intentionally out of scope. This document is generated from the same route contracts used by the HTTP router.',
    },
    servers: [{ url: '/' }],
    paths,
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer' },
      },
    },
  };
}

function errorResponse(description: string): Record<string, unknown> {
  return {
    description,
    content: { 'application/json': { schema: errorResponseSchema } },
  };
}

function readinessSchema(): Record<string, unknown> {
  return {
    type: 'object',
    required: ['status', 'checks'],
    properties: {
      status: { type: 'string', enum: ['ready', 'not_ready'] },
      checks: {
        type: 'object',
        additionalProperties: { type: 'string' },
        example: { database: 'ok', lifecycle: 'accepting_traffic' },
      },
    },
  };
}
