'use client';



import React, { useState, useEffect, useCallback, useMemo } from 'react';

import { ChevronLeft, ChevronRight, ExternalLink, ArrowRight } from 'lucide-react';

import { useAuth } from '@/contexts/AuthContext';

import { useRouter } from 'next/navigation';



interface Promotion {

  id: string;

  title: string;

  description?: string;

  image_url?: string;

  button_text?: string;

  button_url?: string;

  button_action?: 'link' | 'upgrade_modal' | 'route';

  background_color: string;

  text_color: string;

  carousel_image_urls?: string[] | unknown;

  carousel_advance_ms?: number;

}



/** One row in platform_promotions can list several image URLs; expand into one slide per URL (same copy/CTA/colors). */

function expandCarouselPromos(promos: Promotion[]): Promotion[] {

  const out: Promotion[] = [];

  for (const p of promos) {

    const extra = p.carousel_image_urls;

    const arr: string[] = Array.isArray(extra)

      ? extra

          .filter((u): u is string => typeof u === 'string' && u.trim().length > 0)

          .map((u) => u.trim())

      : [];

    const primary = p.image_url?.trim();

    if (arr.length > 0) {

      for (const url of arr) {

        out.push({ ...p, image_url: url });

      }

    } else if (primary) {

      out.push({ ...p, image_url: primary });

    } else {

      out.push({ ...p });

    }

  }

  return out;

}



export function PromotionCarousel() {

  const { business } = useAuth();

  const router = useRouter();

  const [promos, setPromos] = useState<Promotion[]>([]);

  const [currentIndex, setCurrentSetIndex] = useState(0);

  const [loading, setLoading] = useState(true);



  const slides = useMemo(() => expandCarouselPromos(promos), [promos]);



  useEffect(() => {

    if (slides.length > 0 && currentIndex >= slides.length) {

      setCurrentSetIndex(0);

    }

  }, [slides.length, currentIndex]);



  useEffect(() => {

    async function fetchCarouselPromos() {

      if (!business?.id) {

        setLoading(false);

        return;

      }



      try {

        const res = await fetch(`/api/promotions/active?business_id=${business.id}&type=carousel`);

        if (res.ok) {

          const data = await res.json();

          const list: Promotion[] = data.promotions || [];

          setPromos(list);



          const expanded = expandCarouselPromos(list);

          if (expanded.length > 0) {

            trackInteraction(expanded[0].id, 'view');

          }

        }

      } catch (err) {

        console.error('Failed to fetch carousel promotions', err);

      } finally {

        setLoading(false);

      }

    }



    fetchCarouselPromos();

  }, [business?.id]);



  const trackInteraction = async (promoId: string, action: 'view' | 'click' | 'dismiss') => {

    if (!business?.id) return;

    try {

      await fetch('/api/promotions/track', {

        method: 'POST',

        headers: { 'Content-Type': 'application/json' },

        body: JSON.stringify({

          promotion_id: promoId,

          business_id: business.id,

          action

        })

      });

    } catch (err) {

      // Silent error

    }

  };



  const nextSlide = useCallback(() => {

    setCurrentSetIndex((i) => {

      if (slides.length === 0) return i;

      const newIndex = (i + 1) % slides.length;

      const p = slides[newIndex];

      if (p) void trackInteraction(p.id, 'view');

      return newIndex;

    });

  }, [slides]);



  const prevSlide = useCallback(() => {

    setCurrentSetIndex((i) => {

      if (slides.length === 0) return i;

      const newIndex = (i - 1 + slides.length) % slides.length;

      const p = slides[newIndex];

      if (p) void trackInteraction(p.id, 'view');

      return newIndex;

    });

  }, [slides]);



  useEffect(() => {

    if (slides.length <= 1) return;

    const current = slides[currentIndex];

    const ms = Math.min(120000, Math.max(2000, current?.carousel_advance_ms ?? 6000));

    const t = setInterval(() => {

      nextSlide();

    }, ms);

    return () => clearInterval(t);

  }, [currentIndex, slides, nextSlide]);



  const handleClick = (promo: Promotion) => {

    trackInteraction(promo.id, 'click');

    

    if (promo.button_action === 'link' && promo.button_url) {

      window.open(promo.button_url, '_blank');

    } else if (promo.button_action === 'route' && promo.button_url) {

      router.push(promo.button_url);

    } else if (promo.button_action === 'upgrade_modal') {

      router.push('/settings');

    }

  };



  if (loading || slides.length === 0) return null;



  const currentPromo = slides[currentIndex];



  return (

    <div className="relative group w-full overflow-hidden rounded-2xl border border-border shadow-sm bg-surface mb-6">

      {/* Slide Container */}

      <div 

        className="flex transition-transform duration-500 ease-out h-[200px] md:h-[280px]"

        style={{ backgroundColor: currentPromo.background_color }}

      >

        <div className="w-full flex-shrink-0 flex items-center p-6 md:p-10 relative overflow-hidden">

          {/* Text Content */}

          <div className="flex-1 z-10 space-y-2 md:space-y-4 max-w-[60%]">

            <h3 

              className="text-xl md:text-3xl font-black leading-tight"

              style={{ color: currentPromo.text_color }}

            >

              {currentPromo.title}

            </h3>

            {currentPromo.description && (

              <p 

                className="text-sm md:text-lg opacity-90 line-clamp-2 md:line-clamp-none"

                style={{ color: currentPromo.text_color }}

              >

                {currentPromo.description}

              </p>

            )}

            

            {currentPromo.button_text && (

              <button

                onClick={() => handleClick(currentPromo)}

                className="mt-2 px-6 py-2 md:px-8 md:py-3 bg-white text-gray-900 rounded-xl font-bold text-sm md:text-base hover:shadow-lg active:scale-95 transition-all flex items-center gap-2"

                style={{ color: currentPromo.background_color }}

              >

                {currentPromo.button_text}

                {currentPromo.button_action === 'link' ? <ExternalLink className="w-4 h-4" /> : <ArrowRight className="w-4 h-4" />}

              </button>

            )}

          </div>



          {/* Image */}

          <div className="absolute right-0 top-0 bottom-0 w-[45%] flex items-center justify-center p-4">

            {currentPromo.image_url ? (

              <img 
                key={`${currentPromo.id}-${currentIndex}`}
                src={currentPromo.image_url} 

                alt={currentPromo.title}

                className="max-h-full object-contain drop-shadow-2xl animate-in zoom-in-95 duration-700"

              />

            ) : (

              <div className="w-full h-full bg-white bg-opacity-10 rounded-full flex items-center justify-center -mr-20 -mb-20">

                <div className="w-3/4 h-3/4 bg-white bg-opacity-10 rounded-full"></div>

              </div>

            )}

          </div>

        </div>

      </div>



      {/* Navigation Arrows */}

      {slides.length > 1 && (

        <>

          <button 

            onClick={prevSlide}

            className="absolute left-4 top-1/2 -translate-y-1/2 p-2 bg-black bg-opacity-20 hover:bg-opacity-40 text-white rounded-full transition-opacity opacity-0 group-hover:opacity-100 hidden md:block"

            type="button"

            aria-label="Previous slide"

          >

            <ChevronLeft className="w-6 h-6" />

          </button>

          <button 

            onClick={nextSlide}

            className="absolute right-4 top-1/2 -translate-y-1/2 p-2 bg-black bg-opacity-20 hover:bg-opacity-40 text-white rounded-full transition-opacity opacity-0 group-hover:opacity-100 hidden md:block"

            type="button"

            aria-label="Next slide"

          >

            <ChevronRight className="w-6 h-6" />

          </button>

        </>

      )}



      {/* Indicators */}

      {slides.length > 1 && (

        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2">

          {slides.map((_, idx) => (

            <button

              key={idx}

              type="button"

              onClick={() => {

                setCurrentSetIndex(idx);

                if (slides[idx]) trackInteraction(slides[idx].id, 'view');

              }}

              className={`h-1.5 rounded-full transition-all ${

                currentIndex === idx ? 'w-8 bg-white' : 'w-2 bg-white bg-opacity-40 hover:bg-opacity-60'

              }`}

              aria-label={`Go to slide ${idx + 1}`}

            />

          ))}

        </div>

      )}

    </div>

  );

}



