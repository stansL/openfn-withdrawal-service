import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';
import { createJsonLogger } from '../src/observability/logger.js';

test('configuration fails fast instead of silently accepting invalid values', () => {
  assert.throws(() => loadConfig({ PORT: 'banana' }), /PORT must be an integer/);
  assert.throws(() => loadConfig({ FX_BASE_URL: 'file:\/\/tmp\/rates' }), /must use http or https/);
  assert.throws(() => loadConfig({ FX_MAX_ATTEMPTS: '99' }), /FX_MAX_ATTEMPTS must be an integer/);
  assert.throws(() => loadConfig({ AUTHORISATION_TTL_SECONDS: '5' }), /AUTHORISATION_TTL_SECONDS must be an integer/);
});

test('configuration applies validated defaults', () => {
  const config = loadConfig({});
  assert.equal(config.port, 3000);
  assert.equal(config.fxMaxAttempts, 3);
  assert.equal(config.shutdownGraceMs, 10_000);
  assert.equal(config.authorisationTtlSeconds, 300);
});

test('structured logger redacts credential-like keys', () => {
  const lines: string[] = [];
  const logger = createJsonLogger({
    log: (message?: any) => { lines.push(String(message)); },
    warn: (message?: any) => { lines.push(String(message)); },
    error: (message?: any) => { lines.push(String(message)); },
  });

  logger.info({ event: 'test', authorization: 'Bearer super-secret', nested: { apiKey: 'abc123', safe: 'visible' } });
  const output = JSON.parse(lines[0]!) as any;
  assert.equal(output.authorization, '[REDACTED]');
  assert.equal(output.nested.apiKey, '[REDACTED]');
  assert.equal(output.nested.safe, 'visible');
});
