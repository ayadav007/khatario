import { looksLikePhone, parseAmount, parseDate, isAmbiguousDate, parsePhone, looksLikeGstin, parseTaxRate, resolveUnit, normaliseKey, UNIT_CODES } from '@/lib/import/parse-values';
import { GST_UQC_CODES } from '@/lib/gst/uqc';
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
  expect(parsePhone('9876543210')).toBe('9876543210');
  expect(parsePhone('+91 98765 43210')).toBe('9876543210');
  expect(parsePhone('9876543210, 9123456780')).toBe(parsePhone('9876543210'));
  expect(parsePhone('n/a')).toBeNull();
  expect(looksLikeGstin('27AAAPA1234A1Z5')).toBe(true);
  expect(looksLikeGstin('27AAAPA1234A1Z')).toBe(false);
  expect(parseTaxRate('18%')).toBe(18);
  expect(parseTaxRate('GST 5')).toBe(5);
  expect(parseTaxRate('exempt')).toBe(0);
  expect(resolveUnit('Nos.')).toBe('NOS');
  expect(resolveUnit('Bndl')).toBeNull();
  expect(normaliseKey('GSTIN/UIN ')).toBe('gstinuin');
  expect(resolveState('maharashtra')).toEqual({ state: 'Maharashtra', state_code: '27' });
  expect(resolveState('MH')).toEqual({ state: 'Maharashtra', state_code: '27' });
  expect(resolveState('27')).toEqual({ state: 'Maharashtra', state_code: '27' });
  expect(resolveState('Atlantis')).toBeNull();
});

test('tax rates keep fractions', () => {
  expect(parseTaxRate('0.25%')).toBe(0.25);
  expect(parseTaxRate('0.1')).toBe(0.1);
  expect(parseTaxRate('1.5 %')).toBe(1.5);
  expect(parseTaxRate('0')).toBe(0);
  expect(parseTaxRate('0%')).toBe(0);
  expect(parseTaxRate('nil')).toBe(0);
  expect(parseTaxRate('exempt')).toBe(0);
});
test('state spellings and aliases', () => {
  const code = (t: string) => resolveState(t)?.state_code;
  expect(resolveState('Jammu & Kashmir')).toEqual({ state: 'Jammu and Kashmir', state_code: '01' });
  expect(code('Andaman & Nicobar Islands')).toBe('35');
  expect(code('Dadra & Nagar Haveli & Daman & Diu')).toBe('26');
  expect(resolveState('Orissa')).toEqual({ state: 'Odisha', state_code: '21' });
  expect(resolveState('Pondicherry')).toEqual({ state: 'Puducherry', state_code: '34' });
  expect(resolveState('New Delhi')).toEqual({ state: 'Delhi', state_code: '07' });
  expect(resolveState('Uttaranchal')).toEqual({ state: 'Uttarakhand', state_code: '05' });
  expect(code('7')).toBe('07');
  expect(resolveState('25')).toBeNull();
  expect(resolveState('97')).toBeNull();
});
test('looksLikePhone is strict', () => {
  expect(looksLikePhone('27AAAPA1234A1Z5')).toBe(false);
  expect(looksLikePhone('01/04/2026')).toBe(false);
  expect(looksLikePhone('1,25,00,000')).toBe(false);
  expect(looksLikePhone('9876543210')).toBe(true);
  expect(looksLikePhone('+91 98765 43210')).toBe(true);
  expect(looksLikePhone('098765 43210')).toBe(true);
});

describe('units follow the GST unit quantity codes', () => {
  test('every code resolves to itself, PRS included', () => {
    expect([...UNIT_CODES].sort()).toEqual([...GST_UQC_CODES].sort());
    for (const code of UNIT_CODES) expect([code, resolveUnit(code)]).toEqual([code, code]);
    expect(resolveUnit('PRS')).toBe('PRS');
    expect(resolveUnit('prs')).toBe('PRS');
  });

  test('hours and service units ask for a choice instead of becoming NA', () => {
    expect(resolveUnit('Hrs')).toBeNull();
    expect(resolveUnit('Hours')).toBeNull();
    expect(resolveUnit('Service')).toBeNull();
    expect(resolveUnit('NA')).toBe('NA');
  });

  test("Tally's Nos stays NOS, apart from PCS", () => {
    expect(resolveUnit('Nos')).toBe('NOS');
    expect(resolveUnit('no')).toBe('NOS');
    expect(resolveUnit('Pcs')).toBe('PCS');
    expect(resolveUnit('piece')).toBe('PCS');
  });

  test('common short forms resolve without a choice', () => {
    expect(resolveUnit('Btl')).toBe('BTL');
    expect(resolveUnit('Ctn')).toBe('CTN');
    expect(resolveUnit('kg')).toBe('KGS');
    expect(resolveUnit('Kgs.')).toBe('KGS');
    expect(resolveUnit('gm')).toBe('GMS');
    expect(resolveUnit('ml')).toBe('MLT');
    expect(resolveUnit('Litre')).toBe('LTR');
    expect(resolveUnit('pkt')).toBe('PAC');
    expect(resolveUnit('dz')).toBe('DOZ');
    expect(resolveUnit('dozen')).toBe('DOZ');
    expect(resolveUnit('boxes')).toBe('BOX');
    expect(resolveUnit('bags')).toBe('BAG');
    expect(resolveUnit('sets')).toBe('SET');
    expect(resolveUnit('pair')).toBe('PRS');
    expect(resolveUnit('pr')).toBe('PRS');
    expect(resolveUnit('Sq. ft')).toBe('SQF');
  });

  test('an unknown unit still needs a choice', () => {
    expect(resolveUnit('Bndl')).toBeNull();
    expect(resolveUnit('')).toBeNull();
    expect(resolveUnit('furlong')).toBeNull();
  });
});

describe('phone prefixes', () => {
  test('a landline keeps its leading 0; a mobile loses it', () => {
    expect(parsePhone('022-12345678')).toBe('02212345678');
    expect(parsePhone('09876543210')).toBe('9876543210');
    expect(looksLikePhone('09876543210')).toBe(true);
    expect(looksLikePhone('022-12345678')).toBe(false);
  });

  test('91 is dropped from 12 digits only when a mobile number remains', () => {
    expect(parsePhone('919876543210')).toBe('9876543210');
    expect(parsePhone('+91 98765 43210')).toBe('9876543210');
    expect(parsePhone('911234567890')).toBe('911234567890');
    expect(looksLikePhone('911234567890')).toBe(false);
  });
});
