'use client';

import { useStore } from '@/lib/store/store-context';
import { chowkInkOn, isChowkPack, sanitizeStoreTheme } from '@/lib/store/store-theme';
import { Truck, ShieldCheck, Headphones, MapPin } from 'lucide-react';

export function StoreTrustSection() {
  const { store } = useStore();
  const theme = sanitizeStoreTheme(store?.store_theme);
  const chowk = isChowkPack(theme);
  const items = [
    { icon: Truck, title: 'Fast delivery', body: 'From your local store' },
    { icon: ShieldCheck, title: 'Secure payments', body: store?.online_pay_enabled ? 'UPI & cards via Razorpay' : 'Pay on delivery available' },
    { icon: Headphones, title: 'Easy support', body: store?.phone ? `Call ${store.phone}` : 'Contact the store' },
    { icon: MapPin, title: 'Local business', body: store?.name ?? 'Shop nearby' },
  ];

  if (chowk) {
    const ink = chowkInkOn(theme.background);
    const line = [
      'From your local store',
      store?.online_pay_enabled ? 'UPI & cards' : 'Pay on delivery',
      store?.phone ? store.phone : null,
    ].filter(Boolean) as string[];

    if (line.length === 0) return null;

    return (
      <section
        className="mt-8 border-t py-4 text-[12px] leading-relaxed md:mt-10"
        style={{ borderColor: `color-mix(in srgb, ${ink} 12%, transparent)`, color: ink, opacity: 0.55 }}
      >
        {line.join('  ·  ')}
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
