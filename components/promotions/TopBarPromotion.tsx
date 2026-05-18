'use client';

import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useLayoutData } from '@/contexts/LayoutDataContext';
import type { Promotion } from '@/contexts/LayoutDataContext';
import { clsx } from 'clsx';

function parseImageUrls(promo: Promotion & Record<string, unknown>): string[] {
  const raw = promo.topbar_image_urls;
  if (Array.isArray(raw)) {
    return raw.filter((u) => typeof u === 'string' && u.trim().length > 0).map((u) => u.trim());
  }
  if (typeof raw === 'string' && raw) {
    try {
      const p = JSON.parse(raw) as unknown;
      if (Array.isArray(p)) {
        return p.filter((u): u is string => typeof u === 'string' && u.trim().length > 0).map((u) => u.trim());
      }
    } catch {
      /* ignore */
    }
  }
  if (promo.image_url && typeof promo.image_url === 'string') {
    return [promo.image_url.trim()];
  }
  return [];
}

export function TopBarPromotion({ businessId }: { businessId: string }) {
  const router = useRouter();
  const { promotions, refreshPromotion } = useLayoutData();
  const promo = promotions.topbar;
  const [index, setIndex] = useState(0);
  const trackedViewId = useRef<string | null>(null);

  const urls = useMemo(() => (promo ? parseImageUrls(promo) : []), [promo]);
  const mode = (promo as Record<string, unknown> | null)?.topbar_mode as string | undefined;
  const intervalMs = Number(
    (promo as Record<string, unknown> | null)?.topbar_carousel_interval_ms
  );
  const useCarousel = mode === 'vertical_carousel' && urls.length >= 2;
  const tick =
    useCarousel && Number.isFinite(intervalMs) && intervalMs! >= 2000
      ? intervalMs!
      : 5000;

  useEffect(() => {
    setIndex(0);
  }, [promo?.id, urls.join('|')]);

  useEffect(() => {
    trackedViewId.current = null;
  }, [promo?.id]);

  useEffect(() => {
    refreshPromotion('topbar');
  }, [refreshPromotion, businessId]);

  useEffect(() => {
    if (!useCarousel || urls.length < 2) return;
    const t = setInterval(() => {
      setIndex((i) => (i + 1) % urls.length);
    }, tick);
    return () => clearInterval(t);
  }, [useCarousel, urls.length, tick]);

  const track = useCallback(
    async (action: 'view' | 'click') => {
      if (!promo?.id) return;
      try {
        await fetch('/api/promotions/track', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            promotion_id: promo.id,
            business_id: businessId,
            action,
          }),
        });
      } catch {
        /* ignore */
      }
    },
    [promo?.id, businessId]
  );

  useEffect(() => {
    if (!promo?.id) return;
    if (trackedViewId.current === promo.id) return;
    trackedViewId.current = promo.id;
    track('view');
  }, [promo?.id, track]);

  const handleClick = () => {
    if (!promo) return;
    track('click');
    const p = promo as Promotion;
    if (p.button_action === 'link' && p.button_url) {
      window.open(p.button_url, '_blank', 'noopener,noreferrer');
    } else if (p.button_action === 'route' && p.button_url) {
      router.push(p.button_url);
    } else if (p.button_action === 'upgrade_modal') {
      router.push('/settings?tab=subscription');
    }
  };

  if (!promo || urls.length === 0) {
    return null;
  }

  return (
    <div
      className={clsx(
        'flex h-full min-h-0 w-full min-w-0',
        (promo as Promotion).button_url && 'cursor-pointer'
      )}
      role={promo.button_url ? 'link' : undefined}
      onClick={promo.button_url ? handleClick : undefined}
      onKeyDown={
        promo.button_url
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleClick();
              }
            }
          : undefined
      }
      tabIndex={promo.button_url ? 0 : undefined}
    >
      {useCarousel ? (
        <div className="h-16 w-full min-h-16 min-w-0 overflow-hidden">
          <div
            className="flex flex-col transition-transform duration-500 ease-in-out will-change-transform"
            style={{
              height: `${urls.length * 4}rem`,
              transform: `translateY(-${index * 4}rem)`,
            }}
            aria-label={promo.title}
          >
            {urls.map((src, i) => (
              <div key={`${src}-${i}`} className="h-16 w-full shrink-0">
                <img
                  src={src}
                  alt=""
                  className="h-full w-full min-h-0 min-w-0 object-cover object-center [transform:translateZ(0)]"
                  draggable={false}
                />
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="h-16 w-full min-h-16 min-w-0 overflow-hidden">
          <img
            src={urls[0]}
            alt=""
            className="h-full w-full min-h-0 min-w-0 object-cover object-center [transform:translateZ(0)]"
            draggable={false}
          />
        </div>
      )}
    </div>
  );
}
