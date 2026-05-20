'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, ExternalLink, ArrowRight } from 'lucide-react';
import { useRouter, usePathname } from 'next/navigation';
import { useLayoutData } from '@/contexts/LayoutDataContext';
import { useAuth } from '@/contexts/AuthContext';
import { shouldHideGlobalBanners } from '@/lib/mobile-navigation';
import type { Promotion } from '@/contexts/LayoutDataContext';

export function PromotionBanner() {
  const router = useRouter();
  const pathname = usePathname();
  const { business } = useAuth();

  if (shouldHideGlobalBanners(pathname)) return null;
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
    void refreshPromotion('banner');
  }, [business?.id, refreshPromotion]);

  useEffect(() => {
    const p = promotions.banner;
    if (!p) {
      setPromo(null);
      setIsVisible(false);
      return;
    }
    const dismissed = localStorage.getItem(`promo_dismissed_${p.id}`);
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
  }, [promotions.banner, trackInteraction]);

  const handleDismiss = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!promo) return;

    setIsVisible(false);
    localStorage.setItem(`promo_dismissed_${promo.id}`, 'true');
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

  return (
    <div
      className="relative w-full z-40 transition-all animate-in slide-in-from-top duration-500"
      style={{
        backgroundColor: promo.background_color || '#3b82f6',
        color: promo.text_color || '#ffffff',
      }}
    >
      <div className="max-w-[1600px] mx-auto px-4 py-3 md:py-2">
        <div className="flex flex-col md:flex-row items-center justify-center gap-2 md:gap-6 text-center md:text-left">
          <div className="flex-1">
            <span className="font-bold text-sm md:text-base">{promo.title}</span>
            {promo.description && (
              <span className="hidden md:inline ml-2 opacity-90 text-sm">{promo.description}</span>
            )}
          </div>

          <div className="flex items-center gap-4">
            {promo.button_text && (
              <button
                type="button"
                onClick={handleClick}
                className="px-4 py-1 bg-white text-gray-900 rounded-full text-xs font-bold hover:bg-opacity-90 transition-all flex items-center gap-1 shadow-sm"
                style={{ color: promo.background_color }}
              >
                {promo.button_text}
                {promo.button_action === 'link' ? (
                  <ExternalLink className="w-3 h-3" />
                ) : (
                  <ArrowRight className="w-3 h-3" />
                )}
              </button>
            )}

            {promo.dismissible && (
              <button
                type="button"
                onClick={handleDismiss}
                className="p-1 hover:bg-black hover:bg-opacity-10 rounded-full transition-colors"
                aria-label="Dismiss"
              >
                <X className="w-4 h-4 opacity-80" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
