'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useStore } from '@/lib/store/store-context';
import {
  isStorePromoActive,
  shouldShowStorePromo,
  storePromoStorageKey,
  type StorePromoSheetConfig,
} from '@/lib/store/promo-sheet';

function remember(key: string, frequency: StorePromoSheetConfig['frequency']) {
  try {
    if (frequency === 'once_per_session') sessionStorage.setItem(key, 'session');
    else localStorage.setItem(key, String(Date.now()));
  } catch {
    /* ignore */
  }
}

function readStored(key: string, frequency: StorePromoSheetConfig['frequency']): string | null {
  try {
    if (frequency === 'once_per_session') return sessionStorage.getItem(key);
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function StorePromoSheet() {
  const { store } = useStore();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const promo = store?.store_promo_sheet;

  useEffect(() => {
    if (!store || !promo || !isStorePromoActive(promo)) {
      setOpen(false);
      return;
    }
    const key = storePromoStorageKey(store.store_subdomain, promo.version);
    if (!shouldShowStorePromo({ frequency: promo.frequency, stored: readStored(key, promo.frequency) })) {
      return;
    }
    const t = window.setTimeout(() => setOpen(true), promo.delay_ms);
    return () => window.clearTimeout(t);
  }, [store, promo]);

  if (!store || !promo || !open || !isStorePromoActive(promo)) return null;

  const close = () => {
    setOpen(false);
    remember(storePromoStorageKey(store.store_subdomain, promo.version), promo.frequency);
  };

  const runCta = () => {
    if (promo.coupon_code) {
      try {
        sessionStorage.setItem(`khatario-store-coupon:${store.store_subdomain}`, promo.coupon_code);
      } catch {
        /* ignore */
      }
    }
    close();
    if (promo.cta_action === 'none') return;
    if (promo.cta_action === 'cart') {
      router.push('/cart');
      return;
    }
    if (promo.cta_action === 'checkout') {
      router.push('/checkout');
      return;
    }
    if (promo.cta_action === 'whatsapp' && store.phone) {
      const text = encodeURIComponent(promo.title || store.name);
      window.open(`https://wa.me/${store.phone.replace(/\D/g, '')}?text=${text}`, '_blank');
      return;
    }
    const url = promo.cta_url.trim();
    if (!url) {
      router.push('/');
      return;
    }
    if (url.startsWith('/')) {
      router.push(url);
      return;
    }
    if (/^https?:\/\//i.test(url)) {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center sm:items-center">
      <button
        type="button"
        className="absolute inset-0 bg-black/45"
        aria-label="Dismiss promotion"
        onClick={() => {
          if (promo.dismissible) close();
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="store-promo-title"
        className="relative z-[81] w-full max-w-md animate-[slideUp_280ms_ease-out] rounded-t-3xl px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3 shadow-2xl sm:mb-8 sm:rounded-3xl"
        style={{ backgroundColor: promo.background_color, color: promo.text_color }}
      >
        <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-black/15" />
        {promo.dismissible ? (
          <button
            type="button"
            onClick={close}
            className="absolute right-3 top-3 rounded-full p-1.5 opacity-70 hover:opacity-100"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
        {promo.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={promo.image_url}
            alt=""
            className="mb-4 h-40 w-full rounded-2xl object-cover"
          />
        ) : null}
        {promo.title ? (
          <h2 id="store-promo-title" className="pr-8 text-xl font-semibold">
            {promo.title}
          </h2>
        ) : null}
        {promo.body ? (
          <p className="mt-2 whitespace-pre-wrap text-sm opacity-90">{promo.body}</p>
        ) : null}
        {promo.coupon_code ? (
          <p className="mt-3 rounded-lg bg-black/5 px-3 py-2 text-center text-sm font-semibold tracking-wide">
            {promo.coupon_code}
          </p>
        ) : null}
        {promo.cta_action !== 'none' ? (
          <button
            type="button"
            onClick={runCta}
            className="mt-5 w-full rounded-xl py-3 text-sm font-semibold"
            style={{
              backgroundColor: promo.button_color,
              color: promo.button_text_color,
            }}
          >
            {promo.cta_label}
          </button>
        ) : null}
      </div>
      <style>{`
        @keyframes slideUp {
          from { transform: translateY(100%); opacity: 0.6; }
          to { transform: translateY(0); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
