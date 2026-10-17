import { FxPairUnsupportedError, FxUnavailableError } from '../domain/errors.js';
import type { FxQuote } from '../domain/types.js';
import type { ExchangeRateProvider } from '../application/ports.js';

export interface RawFxClient {
  fetchRate(from: string, to: string, signal: AbortSignal): Promise<FxQuote>;
}

type ProviderErrorKind = 'unsupported_pair' | 'dependency';

export class ProviderRequestError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
    public readonly kind: ProviderErrorKind = 'dependency',
  ) {
    super(message);
    this.name = 'ProviderRequestError';
  }
}

export class FrankfurterClient implements RawFxClient {
  constructor(private readonly baseUrl = 'https://api.frankfurter.dev') {}

  async fetchRate(from: string, to: string, signal: AbortSignal): Promise<FxQuote> {
    if (from === to) {
      return { rate: '1', provider: 'identity', effectiveDate: new Date().toISOString().slice(0, 10) };
    }

    let response: Response;
    try {
      response = await fetch(
        `${this.baseUrl}/v2/rate/${encodeURIComponent(from.toLowerCase())}/${encodeURIComponent(to.toLowerCase())}`,
        { signal },
      );
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new ProviderRequestError('FX provider timed out.', true);
      }
      throw new ProviderRequestError('FX provider network failure.', true);
    }

    if (!response.ok) {
      if (response.status === 422) {
        throw new ProviderRequestError('FX provider does not support the requested currency pair.', false, 'unsupported_pair');
      }
      const retryable = response.status === 429 || response.status >= 500;
      throw new ProviderRequestError(`FX provider returned HTTP ${response.status}.`, retryable);
    }

    const body = await response.text();
    const parsed = parseFrankfurterV2Rate(body, from, to);
    if (!parsed) throw new ProviderRequestError('FX provider returned a malformed response.', true);

    return { rate: parsed.rate, provider: 'frankfurter-v2', effectiveDate: parsed.effectiveDate };
  }
}

interface ParsedRate { rate: string; effectiveDate: string }

/**
 * Preserve the original decimal token and validate the provider's pair/date.
 * This avoids routing money math through binary floating point and keeps rate provenance auditable.
 */
export function parseFrankfurterV2Rate(json: string, from: string, to: string): ParsedRate | null {
  let rateToken: string | null = null;
  const parse = JSON.parse as unknown as (
    input: string,
    reviver: (key: string, value: unknown, context?: { source?: string }) => unknown,
  ) => unknown;

  try {
    const result = parse(json, (key, value, context) => {
      if (key === 'rate' && typeof value === 'number' && context?.source) rateToken = context.source;
      return value;
    }) as { date?: unknown; base?: unknown; quote?: unknown; rate?: unknown };

    if (!rateToken || typeof result !== 'object' || result == null) return null;
    if (typeof result.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(result.date)) return null;
    if (typeof result.base !== 'string' || result.base.toUpperCase() !== from.toUpperCase()) return null;
    if (typeof result.quote !== 'string' || result.quote.toUpperCase() !== to.toUpperCase()) return null;
    return { rate: rateToken, effectiveDate: result.date };
  } catch {
    return null;
  }
}

interface ResilienceOptions {
  timeoutMs: number;
  maxAttempts: number;
  initialBackoffMs: number;
  failureThreshold: number;
  cooldownMs: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

export class ResilientExchangeRateProvider implements ExchangeRateProvider {
  private consecutiveFailures = 0;
  private openedAt: number | null = null;
  private halfOpenProbeInFlight = false;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;

  constructor(private readonly client: RawFxClient, private readonly options: ResilienceOptions) {
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? ((ms) => new Promise(resolve => setTimeout(resolve, ms)));
    this.random = options.random ?? Math.random;
  }

  async getQuote(from: string, to: string): Promise<FxQuote> {
    if (from === to) return { rate: '1', provider: 'identity', effectiveDate: new Date().toISOString().slice(0, 10) };

    const circuitState = this.circuitState();
    if (circuitState === 'open') throw new FxUnavailableError('FX provider circuit is open; retry later.');
    if (circuitState === 'half-open') {
      if (this.halfOpenProbeInFlight) throw new FxUnavailableError('FX provider recovery probe is already in progress.');
      this.halfOpenProbeInFlight = true;
    }

    try {
      let lastError: unknown;
      for (let attempt = 1; attempt <= this.options.maxAttempts; attempt++) {
        try {
          const quote = await this.withTimeout((signal) => this.client.fetchRate(from, to, signal));
          this.consecutiveFailures = 0;
          this.openedAt = null;
          return quote;
        } catch (error) {
          lastError = error;
          if (error instanceof ProviderRequestError && error.kind === 'unsupported_pair') {
            throw new FxPairUnsupportedError();
          }
          const retryable = error instanceof ProviderRequestError ? error.retryable : true;
          if (!retryable || attempt === this.options.maxAttempts) break;
          // Full jitter reduces synchronised retry waves across horizontally scaled instances.
          const ceiling = this.options.initialBackoffMs * 2 ** (attempt - 1);
          await this.sleep(Math.max(1, Math.floor(this.random() * ceiling)));
        }
      }

      if (lastError instanceof ProviderRequestError && !lastError.retryable) {
        // Non-retryable provider contract failures must not poison health for unrelated requests.
        throw new FxUnavailableError(lastError.message);
      }
      this.recordFailure();
      throw new FxUnavailableError();
    } finally {
      if (circuitState === 'half-open') this.halfOpenProbeInFlight = false;
    }
  }

  private circuitState(): 'closed' | 'open' | 'half-open' {
    if (this.openedAt == null) return 'closed';
    return this.now() - this.openedAt >= this.options.cooldownMs ? 'half-open' : 'open';
  }

  private recordFailure(): void {
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.options.failureThreshold) this.openedAt = this.now();
  }

  private async withTimeout<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try { return await work(controller.signal); }
    finally { clearTimeout(timer); }
  }
}
