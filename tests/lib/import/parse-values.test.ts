import { parseAmount, parseDate, isAmbiguousDate, parsePhone, looksLikeGstin, parseTaxRate, resolveUnit, normaliseKey } from '@/lib/import/parse-values';
import { resolveState } from '@/lib/tax/state-names';

test('amounts', () => {
  expect(parseAmount('80,000.00 Dr')).toEqual({ amount: 80000, side: 'debit' });
  expect(parseAmount('80000 Cr')).toEqual({ amount: 80000, side: 'credit' });
  expect(parseAmount('-1,250.50')).toEqual({ amount: 1250.5, side: 'credit' });
  expect(parseAmount('(1,250.50)')).toEqual({ amount: 1250.5, side: 'credit' });
  expect(parseAmount('₹ 1,00,000')).toEqual({ amount: 100000, side: null });
  expect(parseAmount('')).toEqual({ amount: 0, side: null });
  expect(parseAmount('abc')).toBeNull();
});
test('dates', () => {
  expect(parseDate('01-04-2026', 'dmy')).toBe('2026-04-01');
  expect(parseDate('1/4/26', 'dmy')).toBe('2026-04-01');
  expect(parseDate('1/4/26', 'mdy')).toBe('2026-01-04');
  expect(parseDate('1-Apr-2026', 'dmy')).toBe('2026-04-01');
  expect(parseDate('2026-04-01', 'mdy')).toBe('2026-04-01');
  expect(parseDate('31/02/2026', 'dmy')).toBeNull();
  expect(isAmbiguousDate('01-04-2026')).toBe(true);
  expect(isAmbiguousDate('13-04-2026')).toBe(false);
  expect(isAmbiguousDate('1-Apr-2026')).toBe(false);
});
test('phone, gstin, tax, unit, state', () => {
  expect(parsePhone('+91 98765 43210')).toBe(parsePhone('9876543210'));
  expect(parsePhone('9876543210, 9123456780')).toBe(parsePhone('9876543210'));
  expect(parsePhone('n/a')).toBeNull();
  expect(looksLikeGstin('27AAAPA1234A1Z5')).toBe(true);
  expect(looksLikeGstin('27AAAPA1234A1Z')).toBe(false);
  expect(parseTaxRate('18%')).toBe(18);
  expect(parseTaxRate('GST 5')).toBe(5);
  expect(parseTaxRate('exempt')).toBe(0);
  expect(resolveUnit('Nos.')).toBe('PCS');
  expect(resolveUnit('Bndl')).toBeNull();
  expect(normaliseKey('GSTIN/UIN ')).toBe('gstinuin');
  expect(resolveState('maharashtra')).toEqual({ state: 'Maharashtra', state_code: '27' });
  expect(resolveState('MH')).toEqual({ state: 'Maharashtra', state_code: '27' });
  expect(resolveState('27')).toEqual({ state: 'Maharashtra', state_code: '27' });
  expect(resolveState('Atlantis')).toBeNull();
});
