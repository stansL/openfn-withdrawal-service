import { AppDatabase } from './db/database.js';
import { createBetterSqliteDriver } from './db/better-sqlite-driver.js';
import { AuthService } from './auth/auth-service.js';
import { WithdrawalService } from './application/withdrawal-service.js';
import { FrankfurterClient, ResilientExchangeRateProvider } from './fx/exchange-rate.js';
import { createHttpServer } from './http/app.js';
import { loadConfig, type AppConfig } from './config.js';
import { createJsonLogger } from './observability/logger.js';

const logger = createJsonLogger();
let config: AppConfig;
try {
  config = loadConfig();
} catch (error) {
  logger.error({ event: 'configuration_invalid', error: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
  throw error;
}

const database = new AppDatabase(config.databasePath, createBetterSqliteDriver);
const fx = new ResilientExchangeRateProvider(new FrankfurterClient(config.fxBaseUrl), {
  timeoutMs: config.fxTimeoutMs,
  maxAttempts: config.fxMaxAttempts,
  initialBackoffMs: 100,
  failureThreshold: config.fxCircuitFailureThreshold,
  cooldownMs: config.fxCircuitCooldownMs,
});

let draining = false;
const readiness = () => {
  const databaseReady = database.isReady();
  return {
    ready: !draining && databaseReady,
    checks: {
      database: databaseReady ? 'ok' : 'unavailable',
      lifecycle: draining ? 'draining' : 'accepting_traffic',
    },
  };
};

const server = createHttpServer({
  auth: new AuthService(database),
  withdrawals: new WithdrawalService(database, fx, { authorisationTtlMs: config.authorisationTtlSeconds * 1000 }),
  readiness,
  logger,
});

server.listen(config.port, () => {
  logger.info({
    event: 'server_started',
    port: config.port,
    databasePath: config.databasePath,
    docs: `http://localhost:${config.port}/docs`,
    openapi: `http://localhost:${config.port}/openapi.json`,
  });
});

function shutdown(signal: string): void {
  if (draining) return;
  draining = true;
  logger.info({ event: 'shutdown_started', signal, graceMs: config.shutdownGraceMs });

  const hardStop = setTimeout(() => {
    logger.error({ event: 'shutdown_timeout', signal });
    server.closeAllConnections?.();
    try { database.close(); } catch { /* best effort during forced shutdown */ }
    process.exit(1);
  }, config.shutdownGraceMs);
  hardStop.unref();

  // close() stops accepting new connections and lets in-flight requests finish.
  server.close((error) => {
    clearTimeout(hardStop);
    if (error) {
      logger.error({ event: 'shutdown_failed', signal, error: error.message });
      process.exitCode = 1;
    }
    database.close();
    logger.info({ event: 'shutdown_completed', signal });
  });

  server.closeIdleConnections?.();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
