export interface Logger {
  info(data: Record<string, unknown>): void;
  warn(data: Record<string, unknown>): void;
  error(data: Record<string, unknown>): void;
}

const sensitiveKey = /authorization|token|secret|password|credential|api[-_]?key/i;

export function createJsonLogger(output: Pick<Console, 'log' | 'warn' | 'error'> = console): Logger {
  return {
    info: (data) => output.log(JSON.stringify(envelope('info', data))),
    warn: (data) => output.warn(JSON.stringify(envelope('warn', data))),
    error: (data) => output.error(JSON.stringify(envelope('error', data))),
  };
}

export const noopLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

function envelope(level: string, data: Record<string, unknown>): Record<string, unknown> {
  return {
    level,
    ts: new Date().toISOString(),
    ...(redact(data) as Record<string, unknown>),
  };
}

function redact(value: unknown, key = ''): unknown {
  if (sensitiveKey.test(key)) return '[REDACTED]';
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([childKey, childValue]) => [childKey, redact(childValue, childKey)]),
    );
  }
  return value;
}
