'use client';

import { Truck, ShieldCheck, Headphones, MapPin } from 'lucide-react';
import { useStore } from '@/lib/store/store-context';

export function StoreTrustSection() {
  const { store } = useStore();
  return (
    <section className="mt-10 grid grid-cols-2 gap-3 lg:grid-cols-4">
      {[
        { icon: Truck, title: 'Fast delivery', body: 'From your local store' },
        { icon: ShieldCheck, title: 'Secure payments', body: store?.online_pay_enabled ? 'UPI & cards via Razorpay' : 'Pay on delivery available' },
        { icon: Headphones, title: 'Easy support', body: store?.phone ? `Call ${store.phone}` : 'Contact the store' },
        { icon: MapPin, title: 'Local business', body: store?.name ?? 'Shop nearby' },
      ].map(({ icon: Icon, title, body }) => (
        <div key={title} className="rounded-2xl border border-gray-100 bg-white p-4">
          <Icon className="h-5 w-5 text-gray-500" />
          <p className="mt-2 text-sm font-semibold text-gray-900">{title}</p>
          <p className="mt-0.5 text-xs text-gray-500">{body}</p>
        </div>
      ))}
    </section>
  );
}
