import { isSettingsLinkLocked, settingsLinkFeatureKey } from '@/lib/settings-link-lock';

describe('settings link lock', () => {
  it('prefers the link featureKey', () => {
    expect(settingsLinkFeatureKey({ href: '/settings/backup', featureKey: 'custom_key' })).toBe('custom_key');
  });

  it('falls back to the plan path gate, ignoring query and hash', () => {
    expect(settingsLinkFeatureKey({ href: '/settings/backup' })).toBe('settings_backup');
    expect(settingsLinkFeatureKey({ href: '/settings/whatsapp/inbox?tab=1#top' })).toBe('settings_whatsapp');
  });

  it('has no key for ungated routes', () => {
    expect(settingsLinkFeatureKey({ href: '/settings/financial-years' })).toBeNull();
  });

  it('locks only when the plan denies the key', () => {
    const allow = () => true;
    const deny = () => false;
    expect(isSettingsLinkLocked({ href: '/settings/backup' }, allow)).toBe(false);
    expect(isSettingsLinkLocked({ href: '/settings/backup' }, deny)).toBe(true);
    expect(isSettingsLinkLocked({ href: '/settings/financial-years' }, deny)).toBe(false);
  });
});
