import { header } from '@/lib/store/engine/sections/header';
import { headerLayoutClasses, logoWidthStyle, stickyHeaderState } from '@/lib/store/engine/header-layout';

const base = { logoPosition: 'left', logoPositionMobile: 'left', menuLayout: 'below', separator: true } as const;
const idle = { hidden: false, shrunk: false };

describe('header schema layout settings', () => {
  const byId = (id: string) => header.settings.find((s) => s.id === id)!;

  it('keeps today\'s look as the defaults', () => {
    expect(byId('logo_position').default).toBe('left');
    expect(byId('logo_position_mobile').default).toBe('left');
    expect(byId('logo_width').default).toBe(0);
    expect(byId('logo_width_mobile').default).toBe(0);
    expect(byId('sticky').default).toBe('always');
    expect(byId('separator').default).toBe(true);
  });

  it('explains the settings whose effect depends on another choice', () => {
    expect(byId('separator').info).toBe('The line between the logo row and the menu row (when the menu is below the logo)');
    expect(byId('sticky').info).toBe('Quick stores keep their logo size');
    expect(byId('logo_position').info).toBe('With a centred logo the icons sit on the right');
    // Labels and values are unchanged.
    expect(byId('separator').label).toBe('Line under the header');
    expect(byId('sticky').label).toBe('Stay at top while scrolling');
    expect(byId('logo_position').label).toBe('Logo position');
  });

  it('uses the agreed ranges and options', () => {
    expect(byId('logo_width')).toMatchObject({ type: 'range', min: 0, max: 300, step: 10 });
    expect(byId('logo_width_mobile')).toMatchObject({ type: 'range', min: 0, max: 200, step: 10 });
    expect((byId('logo_position') as any).options.map((o: any) => o.value)).toEqual(['left', 'center']);
    expect((byId('logo_position_mobile') as any).options.map((o: any) => o.value)).toEqual(['left', 'center']);
    expect((byId('sticky') as any).options.map((o: any) => o.value)).toEqual(['none', 'scroll_up', 'always', 'always_shrink']);
  });

  it('puts the layout group after menu_caps', () => {
    const ids = header.settings.map((s) => s.id);
    const i = ids.indexOf('layout_header');
    expect(i).toBeGreaterThan(ids.indexOf('menu_caps'));
    expect(byId('layout_header').type).toBe('header');
    expect(ids.slice(i + 1, i + 7)).toEqual(['logo_position', 'logo_position_mobile', 'logo_width', 'logo_width_mobile', 'sticky', 'separator']);
  });
});

describe('headerLayoutClasses', () => {
  it('is empty for the defaults', () => {
    expect(headerLayoutClasses(base)).toBe('');
  });

  it('covers every desktop x phone combination', () => {
    for (const logoPosition of ['left', 'center'] as const) {
      for (const logoPositionMobile of ['left', 'center'] as const) {
        const want = [logoPosition === 'center' && 'hdr-logo-center', logoPositionMobile === 'center' && 'hdr-mlogo-center']
          .filter(Boolean)
          .join(' ');
        expect(headerLayoutClasses({ ...base, logoPosition, logoPositionMobile })).toBe(want);
      }
    }
  });

  it('adds hdr-inline for the one-line menu and hdr-noline when the separator is off', () => {
    expect(headerLayoutClasses({ ...base, menuLayout: 'inline' })).toBe('hdr-inline');
    expect(headerLayoutClasses({ ...base, separator: false })).toBe('hdr-noline');
    expect(
      headerLayoutClasses({ logoPosition: 'center', logoPositionMobile: 'center', menuLayout: 'inline', separator: false }),
    ).toBe('hdr-logo-center hdr-mlogo-center hdr-inline hdr-noline');
  });
});

describe('logoWidthStyle', () => {
  it('is empty for 0 so the automatic logo size stays', () => {
    expect(logoWidthStyle(0, 0)).toEqual({});
  });

  it('sets only the non-zero variables', () => {
    expect(logoWidthStyle(120, 0)).toEqual({ '--logo-w': '120px' });
    expect(logoWidthStyle(0, 80)).toEqual({ '--logo-w-m': '80px' });
    expect(logoWidthStyle(120, 80)).toEqual({ '--logo-w': '120px', '--logo-w-m': '80px' });
  });
});

describe('stickyHeaderState', () => {
  const H = 80;

  it('never hides or shrinks for always and none', () => {
    expect(stickyHeaderState('always', 500, 100, H, idle)).toEqual(idle);
    expect(stickyHeaderState('none', 500, 100, H, idle)).toEqual(idle);
    expect(stickyHeaderState('always', 500, 100, H, { hidden: true, shrunk: true })).toEqual(idle);
  });

  it('scroll_up hides when scrolling down past the header height', () => {
    expect(stickyHeaderState('scroll_up', 300, 200, H, idle)).toEqual({ hidden: true, shrunk: false });
  });

  it('scroll_up shows on any upward scroll', () => {
    expect(stickyHeaderState('scroll_up', 290, 300, H, { hidden: true, shrunk: false })).toEqual(idle);
  });

  it('scroll_up always shows near the top of the page', () => {
    expect(stickyHeaderState('scroll_up', 40, 10, H, idle)).toEqual(idle);
    expect(stickyHeaderState('scroll_up', 79, 50, H, { hidden: true, shrunk: false })).toEqual(idle);
    expect(stickyHeaderState('scroll_up', 0, 200, H, { hidden: true, shrunk: false })).toEqual(idle);
  });

  it('keeps the previous state for a movement under 4px', () => {
    const hidden = { hidden: true, shrunk: false };
    expect(stickyHeaderState('scroll_up', 302, 300, H, hidden)).toEqual(hidden);
    expect(stickyHeaderState('scroll_up', 298, 300, H, hidden)).toEqual(hidden);
    expect(stickyHeaderState('scroll_up', 303, 300, H, idle)).toEqual(idle);
  });

  it('always_shrink sets shrunk past 24px and clears it at 24px or less, never hiding', () => {
    expect(stickyHeaderState('always_shrink', 25, 0, H, idle)).toEqual({ hidden: false, shrunk: true });
    expect(stickyHeaderState('always_shrink', 500, 100, H, idle)).toEqual({ hidden: false, shrunk: true });
    expect(stickyHeaderState('always_shrink', 24, 100, H, { hidden: false, shrunk: true })).toEqual(idle);
    expect(stickyHeaderState('always_shrink', 0, 100, H, { hidden: false, shrunk: true })).toEqual(idle);
  });

  it('shrunk is false for every other mode', () => {
    for (const mode of ['none', 'scroll_up', 'always'] as const) {
      expect(stickyHeaderState(mode, 500, 100, H, { hidden: false, shrunk: true }).shrunk).toBe(false);
    }
  });
});
