import { ValidationError } from './errors.js';

export function parseUsdCents(input: unknown): number {
  if (typeof input !== 'string' || !/^\d+(?:\.\d{1,2})?$/.test(input)) {
    throw new ValidationError('amount must be a positive USD decimal string with at most two fractional digits.');
  }
  const [whole, fraction = ''] = input.split('.');
  const cents = BigInt(whole!) * 100n + BigInt((fraction + '00').slice(0, 2));
  if (cents <= 0n || cents > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ValidationError('amount must be greater than zero and within the supported range.');
  }
  return Number(cents);
}

export function formatUsdCents(cents: number): string {
  const whole = Math.trunc(cents / 100);
  const fraction = cents % 100;
  return `${whole}.${fraction.toString().padStart(2, '0')}`;
}

export function normalizeCurrency(input: unknown): string {
  if (typeof input !== 'string') throw new ValidationError('target_currency must be an ISO 4217 currency code.');
  const code = input.toUpperCase();
  const supported = new Set(Intl.supportedValuesOf('currency'));
  if (!supported.has(code)) throw new ValidationError('target_currency must be an ISO 4217 currency code.');
  return code;
}

export function canonicalAmount(cents: number): string {
  return formatUsdCents(cents);
}

export function currencyMinorUnits(code: string): number {
  return new Intl.NumberFormat('en', { style: 'currency', currency: code }).resolvedOptions().maximumFractionDigits ?? 2;
}

// The account balance is always integer cents. FX conversion uses exact decimal-string arithmetic.
export function multiplyDecimalByCents(amountCents: number, rate: string, outputScale = 2): string {
  if (!/^\d+(?:\.\d+)?$/.test(rate)) throw new Error(`Invalid decimal rate: ${rate}`);
  const [whole, frac = ''] = rate.split('.');
  const scale = frac.length;
  const numerator = BigInt(whole! + frac) * BigInt(amountCents);
  const denominator = 100n * 10n ** BigInt(scale);
  const target = 10n ** BigInt(outputScale);
  const scaledNumerator = numerator * target;
  let q = scaledNumerator / denominator;
  const r = scaledNumerator % denominator;
  if (r * 2n >= denominator) q += 1n; // half-up for this exercise; production policy may differ by currency.
  const s = q.toString().padStart(outputScale + 1, '0');
  return outputScale === 0 ? s : `${s.slice(0, -outputScale)}.${s.slice(-outputScale)}`;
}
