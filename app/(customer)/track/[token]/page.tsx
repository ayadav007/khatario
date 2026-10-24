import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { ExternalLink, MapPin, Phone, Store, Truck } from 'lucide-react';
import { OrderTimeline } from '@/components/orders/OrderTimeline';
import { loadPublicTracking } from '@/lib/fulfilment/public';
import { FULFILMENT_STATUS_LABEL } from '@/lib/fulfilment/rules';
import { checkRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Track your order',
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
};

const inr = (n: number) => `₹${(Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

function clientIp(): string {
  const h = headers();
  return h.get('x-forwarded-for')?.split(',')[0].trim() || h.get('x-real-ip') || 'unknown';
}

export default async function TrackOrderPage({ params }: { params: { token: string } }) {
  const rl = checkRateLimit(`public-track:${clientIp()}`, 60, 60_000);
  if (!rl.allowed) {
    return (
      <main className="mx-auto max-w-md p-6 text-center text-sm text-slate-600">
        Too many requests. Please try again in a minute.
      </main>
    );
  }

  const t = await loadPublicTracking(params.token);
  if (!t) notFound();

  const pickup = t.method === 'pickup';
  const shopTel = t.shop.phone?.replace(/[^\d+]/g, '');

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-900">
      <div className="mx-auto max-w-md space-y-4">
        <header className="flex items-center gap-3">
          {t.shop.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={t.shop.logoUrl} alt="" className="h-10 w-10 rounded-lg object-contain" />
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-200">
              <Store className="h-5 w-5 text-slate-500" />
            </div>
          )}
          <div>
            <div className="font-semibold">{t.shop.name}</div>
            {t.shop.city ? <div className="text-xs text-slate-500">{t.shop.city}</div> : null}
          </div>
        </header>

        <section className="rounded-2xl bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">{t.buyerFirstName ? `Hi ${t.buyerFirstName}, your order` : 'Your order'}</p>
          <div className="mt-0.5 flex items-baseline justify-between gap-2">
            <h1 className="text-xl font-semibold">{t.orderNumber}</h1>
            <span className="text-sm font-medium">{inr(t.amount)}</span>
          </div>
          <p className="mt-3 text-lg font-semibold text-emerald-700">{FULFILMENT_STATUS_LABEL[t.status]}</p>

          {t.pickupCode ? (
            <div className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
              Show this code when you collect: <span className="ml-1 font-mono text-lg font-bold tracking-widest">{t.pickupCode}</span>
            </div>
          ) : null}
          {t.failureReason ? (
            <div className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-800">Delivery attempt failed: {t.failureReason}</div>
          ) : null}
          {t.codDue > 0 ? (
            <div className="mt-3 text-sm text-slate-700">Pay {inr(t.codDue)} on delivery.</div>
          ) : t.paid ? (
            <div className="mt-3 text-sm text-emerald-700">Paid</div>
          ) : null}

          {t.partnerName || t.awb || t.trackingUrl ? (
            <div className="mt-4 space-y-1 border-t border-slate-100 pt-3 text-sm">
              <div className="flex items-center gap-2">
                <Truck className="h-4 w-4 text-slate-400" />
                {t.partnerName ?? 'Courier'}
                {t.awb ? <span className="font-mono text-slate-600">{t.awb}</span> : null}
              </div>
              {t.trackingUrl ? (
                <a
                  href={t.trackingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-medium text-blue-700 hover:underline"
                >
                  Live courier tracking <ExternalLink className="h-3.5 w-3.5" />
                </a>
              ) : null}
              {t.trackingNeedsAwb ? <p className="text-xs text-slate-500">Enter the tracking number above on the courier page.</p> : null}
            </div>
          ) : null}
          {t.riderName || t.riderPhone ? (
            <div className="mt-3 flex items-center gap-2 text-sm">
              <Phone className="h-4 w-4 text-slate-400" />
              {t.riderName ?? 'Delivery partner'}
              {t.riderPhone ? (
                <a href={`tel:${t.riderPhone.replace(/[^\d+]/g, '')}`} className="font-medium text-blue-700 hover:underline">
                  {t.riderPhone}
                </a>
              ) : null}
            </div>
          ) : null}
        </section>

        <section className="rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold">Progress</h2>
          <OrderTimeline events={t.events} current={t.status} pickup={pickup} />
        </section>

        {t.items.length > 0 ? (
          <section className="rounded-2xl bg-white p-5 shadow-sm">
            <h2 className="mb-2 text-sm font-semibold">Items</h2>
            <ul className="divide-y divide-slate-100 text-sm">
              {t.items.map((l, i) => (
                <li key={i} className="flex justify-between gap-3 py-2">
                  <span>
                    {l.name} <span className="text-slate-500">× {l.quantity}</span>
                  </span>
                  <span>{inr(l.amount)}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {shopTel ? (
          <section className="flex items-center justify-between rounded-2xl bg-white p-4 text-sm shadow-sm">
            <span className="flex items-center gap-2 text-slate-600">
              <MapPin className="h-4 w-4" /> Questions about this order?
            </span>
            <span className="flex gap-3">
              <a href={`tel:${shopTel}`} className="font-medium text-blue-700 hover:underline">Call</a>
              <a
                href={`https://wa.me/${shopTel.replace(/\D/g, '').length === 10 ? `91${shopTel.replace(/\D/g, '')}` : shopTel.replace(/\D/g, '')}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-emerald-700 hover:underline"
              >
                WhatsApp
              </a>
            </span>
          </section>
        ) : null}
      </div>
    </main>
  );
}
