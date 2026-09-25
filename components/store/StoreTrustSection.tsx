'use client';

import { useStore } from '@/lib/store/store-context';
import { chowkInkOn, isAtelierPack, isChowkPack, sanitizeStoreTheme, storeCanvas } from '@/lib/store/store-theme';
import { Truck, ShieldCheck, Headphones, MapPin } from 'lucide-react';

export function StoreTrustSection() {
  const { store } = useStore();
  const theme = sanitizeStoreTheme(store?.store_theme);
  const paper = storeCanvas(theme);
  const chowk = isChowkPack(theme);
  const atelier = isAtelierPack(theme);
  const items = [
    { icon: Truck, title: 'Fast delivery', body: 'From your local store' },
    { icon: ShieldCheck, title: 'Secure payments', body: store?.online_pay_enabled ? 'UPI & cards via Razorpay' : 'Pay on delivery available' },
    { icon: Headphones, title: 'Easy support', body: store?.phone ? `Call ${store.phone}` : 'Contact the store' },
    { icon: MapPin, title: 'Local business', body: store?.name ?? 'Shop nearby' },
  ];

  if (atelier) {
    const ink = chowkInkOn(paper);
    const line = [
      { icon: ShieldCheck, title: 'Secure checkout' },
      { icon: Truck, title: '30-day returns' },
      { icon: MapPin, title: 'From your local atelier' },
    ];
    return (
      <section className="mx-auto max-w-6xl px-4 pt-10">
        <blockquote
          className="rounded-[1.75rem] px-6 py-8 text-center"
          style={{ backgroundColor: `color-mix(in srgb, ${ink} 4%, ${paper})` }}
        >
          <p className="font-atelier-display text-[1.35rem] leading-snug" style={{ color: ink }}>
            “Simplicity is the keynote of all true elegance.”
          </p>
          <p className="mt-3 text-[10px] font-medium uppercase tracking-[0.18em]" style={{ opacity: 0.4 }}>
            {store?.name || 'Atelier'} design ethos
          </p>
        </blockquote>
        <div className="mt-5 grid grid-cols-3 gap-2">
          {line.map(({ icon: Icon, title }) => (
            <div key={title} className="flex flex-col items-center gap-1.5 px-1 py-2 text-center">
              <Icon className="h-4 w-4" strokeWidth={1.5} style={{ opacity: 0.55 }} />
              <p className="text-[10px] leading-tight" style={{ color: ink, opacity: 0.55 }}>
                {title}
              </p>
            </div>
          ))}
        </div>
      </section>
    );
  }

  if (chowk) {
    const ink = chowkInkOn(paper);
    const pills = [
      { icon: Truck, title: 'Free delivery', body: 'From your local store' },
      { icon: ShieldCheck, title: 'Fresh products', body: store?.online_pay_enabled ? 'UPI & cards' : 'Pay on delivery' },
      { icon: Headphones, title: 'Easy support', body: store?.phone ? store.phone : 'Contact the store' },
      { icon: MapPin, title: 'Local store', body: 'Best prices nearby' },
    ];
    return (
      <section className="mx-auto grid max-w-6xl grid-cols-2 gap-2 px-4 pt-5 md:grid-cols-4 md:gap-3">
        {pills.map(({ icon: Icon, title, body }) => (
          <div key={title} className="flex items-start gap-2.5 rounded-2xl bg-white px-3 py-3 shadow-sm">
            <Icon className="mt-0.5 h-4 w-4 shrink-0" style={{ color: theme.accent }} strokeWidth={1.75} />
            <div>
              <p className="text-[12px] font-semibold leading-tight" style={{ color: ink }}>
                {title}
              </p>
              <p className="mt-0.5 text-[11px] leading-snug" style={{ color: ink, opacity: 0.5 }}>
                {body}
              </p>
            </div>
          </div>
        ))}
      </section>
    );
  }

  return (
    <section className="mt-10 grid grid-cols-2 gap-3 lg:grid-cols-4">
      {items.map(({ icon: Icon, title, body }) => (
        <div key={title} className="rounded-2xl border border-gray-100 bg-white p-4">
          <Icon className="h-5 w-5 text-gray-500" />
          <p className="mt-2 text-sm font-semibold text-gray-900">{title}</p>
          <p className="mt-0.5 text-xs text-gray-500">{body}</p>
        </div>
      ))}
    </section>
  );
}
