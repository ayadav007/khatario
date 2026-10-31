import { footerColumns } from '@/lib/store/engine/studio-adapter';
import { StudioFooter, type StudioLink } from '../../studio-theme/StudioSections';
import type { EngineSectionProps } from '../registry';
import { str, withDefaults } from './shared';

const PAYMENT_METHODS = ['UPI', 'Visa', 'Mastercard', 'RuPay'] as const;

const SOCIAL_LABELS = { instagram: 'Instagram', whatsapp: 'WhatsApp', facebook: 'Facebook', youtube: 'YouTube' } as const;

export function Footer({ section, store, theme }: EngineSectionProps) {
  const v = withDefaults(section);
  const columns = footerColumns(section);
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
