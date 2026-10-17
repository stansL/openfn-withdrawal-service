export interface AppConfig {
  port: number;
  databasePath: string;
  fxBaseUrl: string;
  fxTimeoutMs: number;
  fxMaxAttempts: number;
  fxCircuitFailureThreshold: number;
  fxCircuitCooldownMs: number;
  shutdownGraceMs: number;
  authorisationTtlSeconds: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const config: AppConfig = {
    port: intEnv(env, 'PORT', 3000, 1, 65_535),
    databasePath: nonEmptyEnv(env, 'DATABASE_PATH', './data/openfn.sqlite'),
    fxBaseUrl: httpUrlEnv(env, 'FX_BASE_URL', 'https://api.frankfurter.dev'),
    fxTimeoutMs: intEnv(env, 'FX_TIMEOUT_MS', 1800, 100, 30_000),
    fxMaxAttempts: intEnv(env, 'FX_MAX_ATTEMPTS', 3, 1, 5),
    fxCircuitFailureThreshold: intEnv(env, 'FX_CIRCUIT_FAILURE_THRESHOLD', 3, 1, 100),
    fxCircuitCooldownMs: intEnv(env, 'FX_CIRCUIT_COOLDOWN_MS', 10_000, 100, 300_000),
    shutdownGraceMs: intEnv(env, 'SHUTDOWN_GRACE_MS', 10_000, 1000, 120_000),
    authorisationTtlSeconds: intEnv(env, 'AUTHORISATION_TTL_SECONDS', 300, 30, 86_400),
  };

  return config;
}

function intEnv(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = env[name];
  if (raw == null || raw === '') return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  }
  return parsed;
}

function nonEmptyEnv(env: NodeJS.ProcessEnv, name: string, fallback: string): string {
  const raw = env[name];
  if (raw == null) return fallback;
  const value = raw.trim();
  if (!value) throw new Error(`${name} must not be empty.`);
  return value;
}

function httpUrlEnv(env: NodeJS.ProcessEnv, name: string, fallback: string): string {
  const value = nonEmptyEnv(env, name, fallback);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid absolute HTTP(S) URL.`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${name} must use http or https.`);
  }
  return url.toString().replace(/\/$/, '');
}
