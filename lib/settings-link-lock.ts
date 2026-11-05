import { featureIdForPath } from '@/lib/subscription/plan-path-gate';

/**
 * The plan feature that gates a settings link: its own featureKey, else the route's
 * feature from the plan path gate (the rule the desktop sidebar uses for its Upgrade
 * badges). Hub, sidebar and mobile settings sheet all use this, so a link is locked
 * on every surface or on none.
 */
export function settingsLinkFeatureKey(link: { href: string; featureKey?: string | null }): string | null {
  if (link.featureKey) return link.featureKey;
  const path = link.href.split('#')[0].split('?')[0];
  return featureIdForPath(path);
}

export function isSettingsLinkLocked(
  link: { href: string; featureKey?: string | null },
  hasCapability: (resource: string, action?: string) => boolean,
): boolean {
  const key = settingsLinkFeatureKey(link);
  return key != null && !hasCapability(key, 'view');
}
