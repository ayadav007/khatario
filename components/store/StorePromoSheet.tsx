'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useRouter, usePathname } from 'next/navigation';
import { storeDraftToken, useStore } from '@/lib/store/store-context';
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
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const promo = store?.store_promo_sheet;

  useEffect(() => {
    if (storeDraftToken()) {
      setOpen(false);
      return;
    }
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
    if (promo.cta_action === 'shop') {
      const onHome = pathname === '/' || pathname === '/store';
      if (onHome) {
        document.getElementById('all-products')?.scrollIntoView({ behavior: 'smooth' });
      } else {
        router.push('/#all-products');
      }
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

  const hasImage = Boolean(promo.image_url);

  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-end sm:justify-center">
      <button
        type="button"
        className="absolute inset-0 bg-black/70"
        aria-label="Dismiss promotion"
        onClick={() => {
          if (promo.dismissible) close();
        }}
      />

      {promo.dismissible ? (
        <button
          type="button"
          onClick={close}
          className="relative z-[82] mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-black/80 text-white"
          aria-label="Close"
        >
          <X className="h-5 w-5" />
        </button>
      ) : null}

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="store-promo-title"
        className="relative z-[81] w-full max-w-lg overflow-hidden rounded-t-[1.75rem] sm:mb-8 sm:rounded-[1.75rem]"
        style={{
          backgroundColor: promo.background_color,
          color: promo.text_color,
          height: 'min(78vh, 640px)',
          minHeight: '52vh',
        }}
      >
        {hasImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={promo.image_url}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : null}

        <div
          className={
            hasImage
              ? 'absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/45 to-transparent px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-24'
              : 'flex h-full flex-col justify-end px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-8'
          }
          style={hasImage ? { color: '#fff' } : undefined}
        >
          {promo.title ? (
            <h2 id="store-promo-title" className="text-2xl font-bold leading-tight sm:text-3xl">
              {promo.title}
            </h2>
          ) : (
            <h2 id="store-promo-title" className="sr-only">
              Promotion
            </h2>
          )}
          {promo.body ? (
            <p className="mt-2 whitespace-pre-wrap text-sm opacity-90 sm:text-base">{promo.body}</p>
          ) : null}
          {promo.coupon_code ? (
            <p className="mt-3 rounded-lg bg-white/15 px-3 py-2 text-center text-sm font-semibold tracking-wide">
              {promo.coupon_code}
            </p>
          ) : null}
          {promo.cta_action !== 'none' ? (
            <button
              type="button"
              onClick={runCta}
              className="mt-4 w-full rounded-xl py-3.5 text-sm font-semibold"
              style={{
                backgroundColor: promo.button_color,
                color: promo.button_text_color,
              }}
            >
              {promo.cta_label}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
