import { DEFAULT_COLOR_SCHEMES, sanitizeColorSchemes, schemeCssVars } from '@/lib/store/engine/color-schemes';

describe('color schemes', () => {
  it('has six default schemes with fixed ids', () => {
    expect(DEFAULT_COLOR_SCHEMES.map((s) => s.id)).toEqual(['scheme-1', 'scheme-2', 'scheme-3', 'scheme-4', 'scheme-5', 'scheme-6']);
    expect(DEFAULT_COLOR_SCHEMES.map((s) => s.name)).toEqual(['Light', 'Soft (tinted)', 'Dark', 'Accent', 'Cream', 'Ink']);
  });

  it('returns defaults for missing input', () => {
    expect(sanitizeColorSchemes(undefined)).toEqual(DEFAULT_COLOR_SCHEMES);
  });

  it('falls back per field for invalid colours', () => {
    const out = sanitizeColorSchemes([{ id: 'scheme-1', background: 'red', text: '#111111' }]);
    expect(out[0].background).toBe(DEFAULT_COLOR_SCHEMES[0].background);
    expect(out[0].text).toBe('#111111');
  });

  it('caps at six entries', () => {
    const raw = Array.from({ length: 8 }, (_, i) => ({ id: `x${i}`, background: '#ffffff' }));
    const out = sanitizeColorSchemes(raw);
    expect(out).toHaveLength(6);
    expect(out.map((s) => s.id)).toEqual(['scheme-1', 'scheme-2', 'scheme-3', 'scheme-4', 'scheme-5', 'scheme-6']);
  });

  it('applies the accent override to scheme-1 accent and button', () => {
    const out = sanitizeColorSchemes(undefined, '#e11d48');
    expect(out[0].accent).toBe('#e11d48');
    expect(out[0].button).toBe('#e11d48');
    expect(out[1].accent).toBe(DEFAULT_COLOR_SCHEMES[1].accent);
  });

  it('builds css vars', () => {
    const s = DEFAULT_COLOR_SCHEMES[0];
    const primary = schemeCssVars(s, true);
    expect(Object.keys(primary).sort()).toEqual(['--c-accent', '--c-bg', '--c-border', '--c-btn', '--c-btn-text', '--c-card', '--c-text', '--primary']);
    expect(primary['--primary']).toBe(s.accent);
    expect(primary['--c-bg']).toBe(s.background);
    expect(schemeCssVars(s, false)['--primary']).toBeUndefined();
  });
});
