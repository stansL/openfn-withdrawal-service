import { createServer, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { AuthService } from '../auth/auth-service.js';
import type { WithdrawalService } from '../application/withdrawal-service.js';
import { MethodNotAllowedError, toHttpError } from './errors.js';
import { noopLogger, type Logger } from '../observability/logger.js';
import { buildOpenApiDocument } from './contracts.js';
import { createRoutes, header, type ReadinessStatus } from './routes.js';
import { landingPageHtml, landingPagePolicy } from './landing-page.js';

export interface AppDependencies {
  auth: AuthService;
  withdrawals: WithdrawalService;
  readiness?: () => ReadinessStatus;
  logger?: Logger;
}

export function createHttpServer(deps: AppDependencies) {
  const logger = deps.logger ?? noopLogger;
  const readiness = deps.readiness ?? (() => ({ ready: true, checks: { lifecycle: 'accepting_traffic' } }));
  const routes = createRoutes({ auth: deps.auth, withdrawals: deps.withdrawals, readiness, logger });
  const openApiDocument = buildOpenApiDocument(routes.map((route) => route.contract));

  return createServer(async (req, res) => {
    const startedAt = process.hrtime.bigint();
    const pathname = safePathname(req.url);
    const requestId = validRequestId(header(req, 'x-request-id')) ?? randomUUID();
    res.setHeader('X-Request-Id', requestId);
    setSecurityHeaders(res);

    res.once('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      logger.info({
        event: 'http_request_completed',
        requestId,
        method: req.method,
        path: pathname,
        status: res.statusCode,
        durationMs: Number(durationMs.toFixed(2)),
      });
    });

    try {
      if (pathname === '/' || pathname === '/openapi.json' || pathname === '/docs') {
        if (req.method !== 'GET') throw new MethodNotAllowedError(['GET']);
        if (pathname === '/') return html(res, 200, landingPageHtml(), landingPagePolicy);
        return pathname === '/openapi.json' ? json(res, 200, openApiDocument) : html(res, 200, swaggerHtml());
      }

      // Match only route structure: method discovery must not query account state.
      const matchingRoutes = routes.filter((candidate) => candidate.match(pathname) != null);
      if (matchingRoutes.length === 0) return json(res, 404, errorPayload('not_found', 'Route not found.', requestId));
      const route = matchingRoutes.find((candidate) => candidate.contract.method === req.method);
      if (!route) throw new MethodNotAllowedError([...new Set(matchingRoutes.map((candidate) => candidate.contract.method))]);

      const params = route.match(pathname)!;
      return await route.handle({
        req,
        res,
        requestId,
        params,
        sendJson: (status, payload) => json(res, status, payload),
      });
    } catch (error) {
      const httpError = toHttpError(error);
      if (httpError) {
        for (const [name, value] of Object.entries(httpError.headers)) res.setHeader(name, value);
        if (httpError.status === 413) {
          // Finish the structured response, then close rather than retain an oversized upload.
          res.setHeader('Connection', 'close');
          req.resume();
        }
        logger.info({ event: 'request_rejected', requestId, code: httpError.code, status: httpError.status });
        return json(res, httpError.status, errorPayload(httpError.code, httpError.message, requestId));
      }

      logger.error({ event: 'unhandled_error', requestId, error: error instanceof Error ? error.message : String(error) });
      return json(res, 500, errorPayload('internal_error', 'An unexpected error occurred.', requestId));
    }
  });
}

function safePathname(url: string | undefined): string {
  try {
    return new URL(url ?? '/', 'http://localhost').pathname;
  } catch {
    return '/';
  }
}

function validRequestId(value: string | undefined): string | undefined {
  if (value == null) return undefined;
  return /^[A-Za-z0-9._:-]{1,128}$/.test(value) ? value : undefined;
}

function errorPayload(code: string, message: string, requestId: string) {
  return { error: { code, message, request_id: requestId } };
}

function setSecurityHeaders(res: ServerResponse): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-store');
}

function json(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', Buffer.byteLength(body));
  res.end(body);
}

function html(res: ServerResponse, status: number, body: string, policy?: string): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Length', Buffer.byteLength(body));
  res.setHeader(
    'Content-Security-Policy',
    policy ?? "default-src 'none'; style-src 'unsafe-inline' https://unpkg.com; script-src 'unsafe-inline' https://unpkg.com; connect-src 'self'; img-src 'self' data: https://validator.swagger.io",
  );
  res.end(body);
}

function swaggerHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>OpenFn Withdrawal Service API</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.32.0/swagger-ui.css" />
</head>
<body>
  <div id="swagger-ui"></div>
  <noscript><p>Swagger UI requires JavaScript. The OpenAPI document is available at <a href="/openapi.json">/openapi.json</a>.</p></noscript>
  <script src="https://unpkg.com/swagger-ui-dist@5.32.0/swagger-ui-bundle.js"></script>
  <script>
    window.onload = () => SwaggerUIBundle({ url: '/openapi.json', dom_id: '#swagger-ui', deepLinking: true });
  </script>
</body>
</html>`;
}
