import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalAmount, currencyMinorUnits, formatUsdCents, multiplyDecimalByCents, parseUsdCents } from '../src/domain/money.js';
import { ValidationError } from '../src/domain/errors.js';

test('USD parsing and formatting preserve cents through the maximum supported amount', () => {
  for (const [input, cents, canonical] of [
    ['0.01', 1, '0.01'], ['1', 100, '1.00'], ['001.2', 120, '1.20'],
    ['90071992547409.91', Number.MAX_SAFE_INTEGER, '90071992547409.91'],
  ] as const) {
    assert.equal(parseUsdCents(input), cents);
    assert.equal(formatUsdCents(cents), canonical);
    assert.equal(canonicalAmount(cents), canonical);
    assert.equal(parseUsdCents(formatUsdCents(cents)), cents);
  }
  assert.equal(multiplyDecimalByCents(Number.MAX_SAFE_INTEGER, '2'), '180143985094819.82');
});

test('USD parsing rejects out-of-range, fractional-cent and non-decimal inputs', () => {
  for (const input of ['90071992547409.92', '0', '0.00', '-1', '1.001', '1e2', 'NaN', 'Infinity', ' 1.00', 1, null]) {
    assert.throws(() => parseUsdCents(input), ValidationError);
  }
});

test('FX conversion rounds exact half-up ties and adjacent values at ISO currency precisions', () => {
  for (const [currency, precision] of [['JPY', 0], ['USD', 2], ['KWD', 3]] as const) {
    assert.equal(currencyMinorUnits(currency), precision);
  }
  for (const [amount, rate, currency, expected] of [
    [100, '0.4999', 'JPY', '0'], [100, '0.5', 'JPY', '1'], [100, '0.5001', 'JPY', '1'],
    [100, '0.0049', 'USD', '0.00'], [100, '0.005', 'USD', '0.01'], [100, '0.0051', 'USD', '0.01'],
    [1, '0.0499', 'KWD', '0.000'], [1, '0.05', 'KWD', '0.001'], [1, '0.0501', 'KWD', '0.001'],
    [199, '1', 'USD', '1.99'], [12550, '0.92', 'USD', '115.46'],
  ] as const) {
    assert.equal(multiplyDecimalByCents(amount, rate, currencyMinorUnits(currency)), expected);
  }
});
