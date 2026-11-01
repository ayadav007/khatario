import { isSafeHref } from '@/lib/marketing-builder/safe-url';

/** The green bar above the site header. Edited in the Site Builder's page settings (root props). */
export type SiteAnnouncement = {
  show: boolean;
  badge: string;
  title: string;
  text: string;
  linkLabel: string;
  href: string;
};

export const DEFAULT_ANNOUNCEMENT: SiteAnnouncement = {
  show: true,
  badge: 'New',
  title: 'Online store themes are live.',
  text: 'Put your shop online and get orders as bills.',
  linkLabel: 'Explore',
  href: '/themes',
};

/** Root-prop names the editor stores the announcement under. */
export const ANNOUNCEMENT_ROOT_KEYS = {
  show: 'announcementShow',
  badge: 'announcementBadge',
  title: 'announcementTitle',
  text: 'announcementText',
  linkLabel: 'announcementLinkLabel',
  href: 'announcementHref',
} as const satisfies Record<keyof SiteAnnouncement, string>;

/**
 * Reads the announcement from a Site Builder document's root props. Missing keys keep the default
 * (pages published before the bar was editable), and an unsafe link is dropped.
 */
export function announcementFromRootProps(props: Record<string, unknown> | null | undefined): SiteAnnouncement {
  const p = props ?? {};
  const str = (key: string, fallback: string) => (typeof p[key] === 'string' ? (p[key] as string).trim() : fallback);
  const show = p[ANNOUNCEMENT_ROOT_KEYS.show];
  const href = str(ANNOUNCEMENT_ROOT_KEYS.href, DEFAULT_ANNOUNCEMENT.href);
  return {
    show: typeof show === 'boolean' ? show : DEFAULT_ANNOUNCEMENT.show,
    badge: str(ANNOUNCEMENT_ROOT_KEYS.badge, DEFAULT_ANNOUNCEMENT.badge),
    title: str(ANNOUNCEMENT_ROOT_KEYS.title, DEFAULT_ANNOUNCEMENT.title),
    text: str(ANNOUNCEMENT_ROOT_KEYS.text, DEFAULT_ANNOUNCEMENT.text),
    linkLabel: str(ANNOUNCEMENT_ROOT_KEYS.linkLabel, DEFAULT_ANNOUNCEMENT.linkLabel),
    href: isSafeHref(href) ? href : '',
  };
}
