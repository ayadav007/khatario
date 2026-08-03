import { MessageCircle, Shield, Smartphone, WifiOff } from 'lucide-react';

const TRUST_ITEMS = [
  { icon: Shield, label: 'GST-ready billing' },
  { icon: MessageCircle, label: 'WhatsApp share' },
  { icon: WifiOff, label: 'Works offline' },
  { icon: Smartphone, label: 'Phone & desktop' },
] as const;

export function LandingTrustBar() {
  return (
    <div
      className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-slate-200/80 pt-5"
      aria-label="Product highlights"
    >
      {TRUST_ITEMS.map(({ icon: Icon, label }) => (
        <span
          key={label}
          className="inline-flex items-center gap-2 text-sm font-medium text-slate-600"
        >
          <Icon className="h-4 w-4 shrink-0 text-slate-500" strokeWidth={1.75} aria-hidden />
          {label}
        </span>
      ))}
    </div>
  );
}
