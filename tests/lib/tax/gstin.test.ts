import { checkGstin, gstinCheckChar, resolveGstinAndState } from '@/lib/tax/gstin';

describe('GSTIN checksum', () => {
  it('accepts a GSTIN with a valid mod-36 check character', () => {
    const r = checkGstin('27AAPFU0939F1ZV');
    expect(r.valid).toBe(true);
    if (r.valid) {
      expect(r.stateCode).toBe('27');
      expect(r.pan).toBe('AAPFU0939F');
    }
  });

  it('rejects a GSTIN whose check character is wrong', () => {
    const r = checkGstin('27AAPFU0939F1ZX');
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.code).toBe('CHECKSUM');
  });

  it('computes the check character from the first 14 characters', () => {
    expect(gstinCheckChar('27AAPFU0939F1Z')).toBe('V');
  });

  it('rejects an unknown state code', () => {
    const r = checkGstin('99AAPFU0939F1ZV');
    expect(r.valid).toBe(false);
  });

  it('fills state from the GSTIN and rejects a conflicting state', () => {
    const ok = resolveGstinAndState({ gstin: '27AAPFU0939F1ZV', state: '' });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.state_code).toBe('27');

    const bad = resolveGstinAndState({ gstin: '27AAPFU0939F1ZV', state: 'Karnataka' });
    expect(bad.ok).toBe(false);
  });
});
