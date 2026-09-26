import { sanitizeStoreTheme } from '@/lib/store/store-theme';
import { signThemeDraft, readThemeDraft } from '@/lib/store/theme-draft';

describe('theme draft preview tokens', () => {
  it('stores a short id and returns the theme for the same business', () => {
    const theme = sanitizeStoreTheme({ pack: 'noir', accent: '#111111' });
    const token = signThemeDraft('biz-1', theme);
    expect(token).toMatch(/^[0-9a-f]{16}$/);
    expect(readThemeDraft(token, 'biz-1')?.pack).toBe('noir');
    expect(readThemeDraft(token, 'other')).toBeNull();
  });
});
