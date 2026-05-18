'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, ExternalLink, ArrowRight, Sparkles } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useLayoutData } from '@/contexts/LayoutDataContext';
import { useAuth } from '@/contexts/AuthContext';
import type { Promotion } from '@/contexts/LayoutDataContext';

/** Canva/exports often use MP4; `<img>` cannot play video. */
function isLikelyVideoUrl(url: string): boolean {
  const s = url.trim();
  if (!s) return false;
  try {
    const u = new URL(s, 'https://example.com');
    return /\.(mp4|webm|ogg|ogv|mov)(?:$|[?#])/i.test(u.pathname);
  } catch {
    return /\.(mp4|webm|ogg|ogv|mov)(?:$|[?#])/i.test(s);
  }
}

function PromoMedia({ url, className }: { url: string; className: string }) {
  if (isLikelyVideoUrl(url)) {
    return (
      <video
        src={url}
        className={className}
        muted
        loop
        playsInline
        autoPlay
        preload="metadata"
        aria-hidden
      />
    );
  }
  return <img src={url} alt="" className={className} draggable={false} />;
}

export function PromotionSidebar({ collapsed = false }: { collapsed?: boolean }) {
  const router = useRouter();
  const { business } = useAuth();
  const { promotions, refreshPromotion } = useLayoutData();
  const [promo, setPromo] = useState<Promotion | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const viewTrackedId = useRef<string | null>(null);

  const trackInteraction = useCallback(
    async (promoId: string, action: 'view' | 'click' | 'dismiss') => {
      if (!business?.id) return;
      try {
        await fetch('/api/promotions/track', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            promotion_id: promoId,
            business_id: business.id,
            action,
          }),
        });
      } catch {
        // Silent error
      }
    },
    [business?.id]
  );

  useEffect(() => {
    if (!business?.id) return;
    void refreshPromotion('sidebar');
  }, [business?.id, refreshPromotion]);

  useEffect(() => {
    const p = promotions.sidebar;
    if (!p) {
      setPromo(null);
      setIsVisible(false);
      return;
    }
    const dismissed = localStorage.getItem(`promo_sidebar_dismissed_${p.id}`);
    if (dismissed) {
      setPromo(null);
      setIsVisible(false);
      return;
    }
    setPromo(p);
    setIsVisible(true);
    if (viewTrackedId.current !== p.id) {
      viewTrackedId.current = p.id;
      void trackInteraction(p.id, 'view');
    }
  }, [promotions.sidebar, trackInteraction]);

  const handleDismiss = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!promo) return;
    setIsVisible(false);
    setPromo(null);
    localStorage.setItem(`promo_sidebar_dismissed_${promo.id}`, 'true');
    void trackInteraction(promo.id, 'dismiss');
  };

  const handleClick = () => {
    if (!promo) return;
    void trackInteraction(promo.id, 'click');
    if (promo.button_action === 'link' && promo.button_url) {
      window.open(promo.button_url, '_blank');
    } else if (promo.button_action === 'route' && promo.button_url) {
      router.push(promo.button_url);
    } else if (promo.button_action === 'upgrade_modal') {
      router.push('/settings');
    }
  };

  if (!isVisible || !promo) return null;

  const imageUrl = promo.image_url?.trim() || '';

  if (collapsed) {
    return (
      <div className="px-2 py-1.5">
        <button
          type="button"
          onClick={handleClick}
          className="w-10 h-10 rounded-xl overflow-hidden flex items-center justify-center transition-all shadow-md ring-1 ring-black/5 dark:ring-white/10"
          style={
            imageUrl
              ? undefined
              : { backgroundColor: promo.background_color, color: promo.text_color }
          }
          title={promo.title}
        >
          {imageUrl ? (
            <PromoMedia url={imageUrl} className="h-full w-full object-cover" />
          ) : (
            <Sparkles className="w-5 h-5" />
          )}
        </button>
      </div>
    );
  }

  return (
    <div className="px-2 py-2 sm:px-3 sm:py-2.5">
      <div
        className="relative rounded-2xl overflow-hidden group cursor-pointer shadow-lg ring-1 ring-black/5 dark:ring-white/10 transition-all hover:-translate-y-0.5"
        onClick={handleClick}
        role="presentation"
      >
        {imageUrl ? (
          <div className="relative h-20 w-full overflow-hidden bg-black/5 dark:bg-white/5">
            <PromoMedia url={imageUrl} className="h-full w-full object-cover" />
            {promo.dismissible && (
              <button
                type="button"
                onClick={handleDismiss}
                className="absolute top-1.5 right-1.5 p-1 rounded-md bg-black/40 hover:bg-black/55 text-white z-[1] backdrop-blur-sm"
                aria-label="Dismiss"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        ) : null}

        <div
          className="relative p-3 sm:p-4"
          style={{ backgroundColor: promo.background_color, color: promo.text_color }}
        >
          {!imageUrl && <div className="absolute top-0 right-0 -mr-8 -mt-8 w-24 h-24 bg-white opacity-10 rounded-full blur-2xl group-hover:opacity-20 transition-opacity" />}

          <div className="relative space-y-2">
            <div className="flex items-start justify-between gap-1">
              <h4 className="font-black text-base uppercase tracking-wide leading-snug pr-1">
                {promo.title}
              </h4>
              {promo.dismissible && !imageUrl && (
                <button
                  type="button"
                  onClick={handleDismiss}
                  className="p-1 hover:bg-black/10 rounded-lg transition-colors shrink-0"
                  aria-label="Dismiss"
                >
                  <X className="w-3.5 h-3.5 opacity-60" />
                </button>
              )}
            </div>

            {promo.description && (
              <p className="text-sm font-medium opacity-90 line-clamp-3 leading-relaxed">{promo.description}</p>
            )}

            {promo.button_text && (
              <div className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wide pt-0.5">
                {promo.button_text}
                {promo.button_action === 'link' ? (
                  <ExternalLink className="w-3 h-3" />
                ) : (
                  <ArrowRight className="w-3 h-3" />
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
