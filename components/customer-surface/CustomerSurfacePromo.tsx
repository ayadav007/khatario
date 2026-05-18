'use client';

import type { CustomerSurfacePromo } from '@/lib/customer-surface/types';

export function CustomerSurfacePromoBanner({ promo }: { promo: CustomerSurfacePromo }) {
  if (!promo?.enabled) return null;

  const wa = promo.cta_whatsapp?.replace(/\D/g, '');
  const phone = promo.cta_phone?.replace(/\s/g, '');

  return (
    <section className="rounded-lg border border-border bg-white p-4 shadow-sm">
      {promo.image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={promo.image_url}
          alt=""
          className="mb-3 max-h-32 w-full rounded-md object-cover"
        />
      ) : null}
      {promo.title ? (
        <h2 className="text-base font-semibold text-text-primary">{promo.title}</h2>
      ) : null}
      {promo.body ? (
        <p className="mt-1 text-sm text-text-secondary">{promo.body}</p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {promo.cta_url ? (
          <a
            href={promo.cta_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center rounded-md border border-border bg-gray-50 px-3 py-1.5 text-sm font-medium text-text-primary hover:bg-gray-100"
          >
            {promo.cta_label || 'Learn more'}
          </a>
        ) : null}
        {wa ? (
          <a
            href={`https://wa.me/${wa}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center rounded-md border border-border bg-gray-50 px-3 py-1.5 text-sm font-medium text-text-primary hover:bg-gray-100"
          >
            WhatsApp
          </a>
        ) : null}
        {phone ? (
          <a
            href={`tel:${phone}`}
            className="inline-flex items-center rounded-md border border-border bg-gray-50 px-3 py-1.5 text-sm font-medium text-text-primary hover:bg-gray-100"
          >
            Call
          </a>
        ) : null}
      </div>
    </section>
  );
}
