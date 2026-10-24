import { normalizePan, panFromGstin, tdsRateWithoutPan } from '@/lib/tax/pan';

describe('PAN helpers', () => {
  it('normalizes valid PANs and rejects invalid ones', () => {
    expect(normalizePan(' abcde1234f ')).toBe('ABCDE1234F');
    expect(normalizePan('ABCDE12345')).toBeNull();
    expect(normalizePan(undefined)).toBeNull();
  });

  it('derives PAN from a GSTIN', () => {
    expect(panFromGstin('27abcde1234f1z5')).toBe('ABCDE1234F');
    expect(panFromGstin('27ABCDE1234F1Z')).toBeNull();
    expect(panFromGstin(null)).toBeNull();
  });

  it('applies the s.206AA higher rate', () => {
    expect(tdsRateWithoutPan('194C', 2)).toBe(20);
    expect(tdsRateWithoutPan('194J', 10)).toBe(20);
    expect(tdsRateWithoutPan('194Q', 0.1)).toBe(5);
    expect(tdsRateWithoutPan('194O', 1)).toBe(5);
    expect(tdsRateWithoutPan('195', 30)).toBe(30);
  });
});
