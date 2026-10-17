import { MIMEType } from 'node:util';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AuthService } from '../auth/auth-service.js';
import type { WithdrawalService } from '../application/withdrawal-service.js';
import { toApiResponse } from './withdrawal-response.js';
import { normalizeCurrency, parseUsdCents } from '../domain/money.js';
import { ValidationError } from '../domain/errors.js';
import { PayloadTooLargeError, UnsupportedMediaTypeError } from './errors.js';
import type { Logger } from '../observability/logger.js';
import { healthContract, readinessContract, withdrawalContract, validateWithdrawalBody, type RouteContract } from './contracts.js';

export interface ReadinessStatus {
  ready: boolean;
  checks: Record<string, string>;
}

export interface RouteDependencies {
  auth: AuthService;
  withdrawals: WithdrawalService;
  readiness: () => ReadinessStatus;
  logger: Logger;
}

export interface RouteContext {
  req: IncomingMessage;
  res: ServerResponse;
  requestId: string;
  params: Record<string, string>;
  sendJson(status: number, payload: unknown): void;
}

export interface HttpRoute {
  contract: RouteContract;
  match(pathname: string): Record<string, string> | null;
  handle(context: RouteContext): Promise<void> | void;
}

export function createRoutes(deps: RouteDependencies): HttpRoute[] {
  return [
    {
      contract: healthContract,
      match: exact('/healthz'),
      handle: ({ sendJson }) => sendJson(200, { status: 'ok' }),
    },
    {
      contract: readinessContract,
      match: exact('/readyz'),
      handle: ({ sendJson }) => {
        const status = deps.readiness();
        sendJson(status.ready ? 200 : 503, {
          status: status.ready ? 'ready' : 'not_ready',
          checks: status.checks,
        });
      },
    },
    {
      contract: withdrawalContract,
      match: (pathname) => {
        const match = pathname.match(/^\/v1\/accounts\/([^/]+)\/withdrawals$/);
        if (!match?.[1]) return null;
        return { account_id: match[1] };
      },
      handle: async ({ req, res, requestId, params, sendJson }) => {
        let accountId: string;
        try {
          accountId = decodeURIComponent(params.account_id!);
        } catch {
          throw new ValidationError('account_id must be valid URL path text.');
        }
        const principal = deps.auth.authenticate(header(req, 'authorization'));
        const payload = await readJsonBody(req);
        const validated = validateWithdrawalBody(payload);
        const amountUsdCents = parseUsdCents(validated.amount);
        const targetCurrency = normalizeCurrency(validated.targetCurrency);
        const idempotencyKey = parseIdempotencyKey(header(req, 'idempotency-key'));

        const result = await deps.withdrawals.authorise(principal, {
          accountId,
          amountUsdCents,
          targetCurrency,
          ...(idempotencyKey ? { idempotencyKey } : {}),
        });

        if (result.replayed) res.setHeader('Idempotent-Replayed', 'true');
        deps.logger.info({
          event: 'withdrawal_authorised',
          requestId,
          subjectId: principal.subjectId,
          accountId,
          withdrawalId: result.withdrawal.id,
          replayed: result.replayed,
        });
        sendJson(201, toApiResponse(result.withdrawal));
      },
    },
  ];
}

export function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const contentType = header(req, 'content-type');
  try {
    const mediaType = new MIMEType(contentType ?? '');
    const charset = mediaType.params.get('charset');
    if (mediaType.essence !== 'application/json' || (charset != null && charset.toLowerCase() !== 'utf-8')) {
      throw new UnsupportedMediaTypeError();
    }
  } catch {
    throw new UnsupportedMediaTypeError();
  }

  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 64 * 1024) throw new PayloadTooLargeError();
    chunks.push(buffer);
  }

  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not object');
    return parsed as Record<string, unknown>;
  } catch {
    throw new ValidationError('Request body must be valid JSON.');
  }
}

function parseIdempotencyKey(value: string | undefined): string | undefined {
  if (value == null) return undefined;
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(value)) throw new ValidationError('Idempotency-Key must be 8-128 safe ASCII characters.');
  return value;
}

function exact(expected: string): (pathname: string) => Record<string, string> | null {
  return (pathname) => pathname === expected ? {} : null;
}
