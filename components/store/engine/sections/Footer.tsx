import { menuFooterColumns, pickMenu, resolveMenu } from '@/lib/store/engine/menus';
import { StudioFooter, type StudioLink } from '../../studio-theme/StudioSections';
import type { EngineSectionProps } from '../registry';
import { menuCategories, str, withDefaults } from './shared';

const PAYMENT_METHODS = ['UPI', 'Visa', 'Mastercard', 'RuPay'] as const;

const SOCIAL_LABELS = { instagram: 'Instagram', whatsapp: 'WhatsApp', facebook: 'Facebook', youtube: 'YouTube' } as const;

/** A menu entry for the footer: a heading without a link (href '') is plain text. */
function footerLink(l: { label: string; href: string }): StudioLink {
  return l.href ? { label: l.label, href: l.href } : { label: l.label };
}

export function Footer({ section, data, store, theme }: EngineSectionProps) {
  const v = withDefaults(section);
  const items = resolveMenu(pickMenu(theme.settings.menus ?? [], v.menu, 'footer'), menuCategories(data));
  // Top items with links under them are columns; top items that are only a link gather in one column without a
  // heading (an automatic categories item in a store with no categories lands there as its /catalog link).
  const columns: { heading: string; href?: string; links: StudioLink[] }[] = [];
  const loose: StudioLink[] = [];
  for (const col of menuFooterColumns(items)) {
    if (col.links.length) {
      columns.push({ heading: col.heading, href: col.href || undefined, links: col.links.map(footerLink) });
    } else if (col.href) {
      loose.push({ label: col.heading, href: col.href });
    }
  }
  if (loose.length) columns.push({ heading: '', links: loose });
  const links: StudioLink[] = [];
  if (v.show_social !== false) {
    for (const key of Object.keys(SOCIAL_LABELS) as (keyof typeof SOCIAL_LABELS)[]) {
      const href = theme.settings.social?.[key];
      if (href) links.push({ label: SOCIAL_LABELS[key], href });
    }
  }
  const showBadge = v.badge !== false && !store.store_hide_khatario_badge;
  return (
    <>
      <StudioFooter
        s={{ brand: store.name, tagline: str(v.about) || store.store_tagline || '' }}
        columns={columns}
        links={links}
        badge={showBadge ? 'Powered by Khatario' : undefined}
      />
      {v.show_payment_icons === true ? (
        <ul className="eng-pay" aria-label="Payment methods">
          {PAYMENT_METHODS.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      ) : null}
    </>
  );
}
