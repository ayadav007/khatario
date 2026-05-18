'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, ExternalLink, ArrowRight } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useLayoutData } from '@/contexts/LayoutDataContext';
import { useAuth } from '@/contexts/AuthContext';
import type { Promotion } from '@/contexts/LayoutDataContext';

export function PromotionModal() {
  const router = useRouter();
  const { business } = useAuth();
  const { promotions, refreshPromotion } = useLayoutData();
  const [promo, setPromo] = useState<Promotion | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [dontShowAgain, setDontShowAgain] = useState(false);
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
    const timer = setTimeout(() => {
      void refreshPromotion('modal');
    }, 2000);
    return () => clearTimeout(timer);
  }, [business?.id, refreshPromotion]);

  useEffect(() => {
    const p = promotions.modal;
    if (!p) {
      setPromo(null);
      setIsOpen(false);
      return;
    }
    const dismissed = localStorage.getItem(`promo_modal_dismissed_${p.id}`);
    if (dismissed) {
      setPromo(null);
      setIsOpen(false);
      return;
    }
    setPromo(p);
    setIsOpen(true);
    if (viewTrackedId.current !== p.id) {
      viewTrackedId.current = p.id;
      void trackInteraction(p.id, 'view');
    }
  }, [promotions.modal, trackInteraction]);

  const handleClose = () => {
    if (!promo) return;

    setIsOpen(false);
    void trackInteraction(promo.id, 'dismiss');

    if (dontShowAgain || promo.show_once_per_business) {
      localStorage.setItem(`promo_modal_dismissed_${promo.id}`, 'true');
    }
  };

  const handleClick = () => {
    if (!promo) return;

    void trackInteraction(promo.id, 'click');
    setIsOpen(false);

    if (dontShowAgain || promo.show_once_per_business) {
      localStorage.setItem(`promo_modal_dismissed_${promo.id}`, 'true');
    }

    if (promo.button_action === 'link' && promo.button_url) {
      window.open(promo.button_url, '_blank');
    } else if (promo.button_action === 'route' && promo.button_url) {
      router.push(promo.button_url);
    } else if (promo.button_action === 'upgrade_modal') {
      router.push('/settings');
    }
  };

  if (!isOpen || !promo) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black bg-opacity-60 backdrop-blur-sm animate-in fade-in duration-300"
        onClick={handleClose}
        role="presentation"
      />

      <div className="relative bg-white rounded-3xl overflow-hidden shadow-2xl w-full max-w-lg animate-in zoom-in-95 duration-300">
        {promo.image_url ? (
          <div className="relative h-56 md:h-64 w-full">
            <img src={promo.image_url} alt={promo.title} className="w-full h-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
            <h3 className="absolute bottom-6 left-6 right-6 text-2xl font-black text-white leading-tight">
              {promo.title}
            </h3>
          </div>
        ) : (
          <div className="p-8 pb-4" style={{ backgroundColor: promo.background_color }}>
            <h3 className="text-2xl font-black text-white leading-tight">{promo.title}</h3>
          </div>
        )}

        <button
          type="button"
          onClick={handleClose}
          className="absolute top-4 right-4 p-2 bg-black/20 hover:bg-black/40 text-white rounded-full transition-all z-10"
          aria-label="Close"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="p-8 pt-6 space-y-6">
          {promo.description && <p className="text-gray-600 leading-relaxed">{promo.description}</p>}

          <div className="space-y-4">
            {promo.button_text && (
              <button
                type="button"
                onClick={handleClick}
                className="w-full py-4 bg-primary-600 hover:bg-primary-700 text-white rounded-2xl font-bold text-lg shadow-lg shadow-primary-200 transition-all flex items-center justify-center gap-2"
                style={{ backgroundColor: promo.background_color, color: promo.text_color }}
              >
                {promo.button_text}
                {promo.button_action === 'link' ? (
                  <ExternalLink className="w-5 h-5" />
                ) : (
                  <ArrowRight className="w-5 h-5" />
                )}
              </button>
            )}

            <div className="flex items-center justify-between pt-2">
              <label className="flex items-center gap-2 cursor-pointer group">
                <div className="relative flex items-center">
                  <input
                    type="checkbox"
                    checked={dontShowAgain}
                    onChange={(e) => setDontShowAgain(e.target.checked)}
                    className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500 cursor-pointer"
                  />
                </div>
                <span className="text-sm text-gray-500 group-hover:text-gray-700 transition-colors">
                  Don&apos;t show again
                </span>
              </label>

              <button
                type="button"
                onClick={handleClose}
                className="text-sm font-semibold text-gray-400 hover:text-gray-600 transition-colors"
              >
                Maybe later
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
