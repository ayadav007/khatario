import { MarketingIcon } from '@/components/marketing/builder/icons';

export type TrustBarItem = { icon: string; label: string };

export const DEFAULT_TRUST_ITEMS: TrustBarItem[] = [
  { icon: 'shield', label: 'GST-ready billing' },
  { icon: 'message', label: 'WhatsApp share' },
  { icon: 'offline', label: 'Works offline' },
  { icon: 'smartphone', label: 'Phone & desktop' },
];

export function LandingTrustBar({ items = DEFAULT_TRUST_ITEMS }: { items?: TrustBarItem[] }) {
  if (items.length === 0) return null;
  return (
    <div
      className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-slate-200/80 pt-5"
      aria-label="Product highlights"
    >
      {items.map(({ icon, label }) => (
        <span
          key={label}
          className="inline-flex items-center gap-2 text-sm font-medium text-slate-600"
        >
          <MarketingIcon name={icon} className="h-4 w-4 shrink-0 text-slate-500" />
          {label}
        </span>
      ))}
    </div>
  );
}
