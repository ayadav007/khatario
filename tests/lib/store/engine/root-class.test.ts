import { engineRootClass, isDarkHex } from '@/lib/store/engine/root-class';
import { lockedThemeSettings } from '@/lib/store/engine/theme-settings-schema';

const classes = (s: string) => s.split(/\s+/).filter(Boolean);

describe('engineRootClass', () => {
  it('quick always has the phone kit and the old Quick scope', () => {
    const r = engineRootClass({ preset: 'quick', phoneKit: false, editor: false, schemeBackground: '#f3f5f7' });
    expect(r.kit).toBe(true);
    expect(r.quick).toBe(true);
    expect(classes(r.className)).toEqual(expect.arrayContaining(['eng-preset-quick', 'store-quick', 'phone-kit']));
  });

  it('keeps the base classes on every preset', () => {
    const r = engineRootClass({ preset: 'khatario', phoneKit: true, editor: false, schemeBackground: '#f4f5f7' });
    expect(classes(r.className)).toEqual(
      expect.arrayContaining(['st-root', 'store-studio', 'st-cq', 'eng-root', 'eng-preset-khatario', 'phone-kit']),
    );
    expect(r.quick).toBe(false);
  });

  it('grocery follows the phone kit setting', () => {
    const off = engineRootClass({ preset: 'grocery', phoneKit: false, editor: false, schemeBackground: '#f6f7f4' });
    expect(off.kit).toBe(false);
    expect(classes(off.className)).not.toContain('phone-kit');
    const on = engineRootClass({ preset: 'grocery', phoneKit: true, editor: false, schemeBackground: '#f6f7f4' });
    expect(on.kit).toBe(true);
    expect(classes(on.className)).toContain('phone-kit');
  });

  it('studio in the editor', () => {
    const r = engineRootClass({ preset: 'studio', phoneKit: false, editor: true, schemeBackground: undefined });
    const c = classes(r.className);
    expect(c).toEqual(expect.arrayContaining(['eng-editor', 'eng-preset-studio']));
    expect(c).not.toContain('store-quick');
    expect(c).not.toContain('phone-kit');
    expect(c).not.toContain('is-dark');
  });

  it('marks a dark page', () => {
    expect(classes(engineRootClass({ preset: 'grocery', phoneKit: true, editor: false, schemeBackground: '#131210' }).className)).toContain('is-dark');
    expect(classes(engineRootClass({ preset: 'grocery', phoneKit: true, editor: false, schemeBackground: '#f6f7f4' }).className)).not.toContain('is-dark');
  });

  it('never puts an unknown preset into the class list', () => {
    const r = engineRootClass({ preset: 'x y<' as never, phoneKit: false, editor: false, schemeBackground: undefined });
    expect(classes(r.className)).toContain('eng-preset-studio');
    expect(r.className).not.toContain('<');
  });
});

describe('isDarkHex', () => {
  it('uses luminance < 0.4; non-hex is light', () => {
    expect(isDarkHex('#131210')).toBe(true);
    expect(isDarkHex('#000')).toBe(true);
    expect(isDarkHex('#ffffff')).toBe(false);
    expect(isDarkHex('#f6f7f4')).toBe(false);
    expect(isDarkHex('black')).toBe(false);
    expect(isDarkHex('')).toBe(false);
    expect(isDarkHex('#12')).toBe(false);
  });
});

describe('lockedThemeSettings', () => {
  it('locks the phone kit on quick only', () => {
    expect(lockedThemeSettings('quick')).toHaveProperty('phone_kit', 'Always on in the Quick theme');
    expect(lockedThemeSettings('grocery')).toEqual({});
    expect(lockedThemeSettings('studio')).toEqual({});
    expect(lockedThemeSettings(undefined)).toEqual({});
  });
});
