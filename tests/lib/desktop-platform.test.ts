import { desktopVersionFromCookie, nextDesktopZoom } from '@/lib/desktop/platform';

describe('desktop client cookie', () => {
  it('reads the version the Windows app sets', () => {
    expect(desktopVersionFromCookie('desktop-0.1.0')).toBe('0.1.0');
  });

  it('ignores browsers and anything malformed', () => {
    expect(desktopVersionFromCookie(undefined)).toBeNull();
    expect(desktopVersionFromCookie('web')).toBeNull();
    expect(desktopVersionFromCookie('desktop-<script>')).toBeNull();
  });
});

describe('desktop screen size steps', () => {
  it('moves in 10% steps between 70% and 130%', () => {
    expect(nextDesktopZoom(0.8, 'in')).toBe(0.9);
    expect(nextDesktopZoom(0.8, 'out')).toBe(0.7);
    expect(nextDesktopZoom(0.7, 'out')).toBe(0.7);
    expect(nextDesktopZoom(1.3, 'in')).toBe(1.3);
  });

  it('resets to 80%', () => {
    expect(nextDesktopZoom(1.2, 'reset')).toBe(0.8);
  });
});
