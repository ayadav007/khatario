'use client';

import { useEffect, useRef, useState } from 'react';
import { heroZoomScale, type HeroLayer } from '@/lib/store/engine/hero-layout';

/**
 * The Hero banner's pictures (hero.css): one cell per picture, the phone picture swapped in by the phone container
 * query. Pictures carry the darkening as a gradient over the image, as the slideshow's slides do; a video plays as the
 * slideshow's muted loop with brightness standing in for the darkening. `adapt` adds the slideshow's invisible sizer so
 * the picture's own shape sets the height (a video is 16:9 until its metadata loads). `zoom` scales the pictures with
 * scroll progress through one passive listener, not under reduced motion.
 */
export function HeroMedia({ layers, shade, adapt, zoom }: { layers: HeroLayer[]; shade: number; adapt: boolean; zoom: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  // Video width / height by URL, for `adapt`.
  const [ratios, setRatios] = useState<Record<string, number>>({});

  useEffect(() => {
    const el = ref.current;
    if (!zoom || !el || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const r = el.getBoundingClientRect();
      el.style.setProperty('--hb-zoom', String(heroZoomScale(r.top, r.height, window.innerHeight)));
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (frame) window.cancelAnimationFrame(frame);
      el.style.removeProperty('--hb-zoom');
    };
  }, [zoom]);

  const gradient = shade > 0 ? `linear-gradient(rgba(0,0,0,${shade}),rgba(0,0,0,${shade})),` : '';
  return (
    <div className="eng-hero-media" ref={ref} aria-hidden>
      {layers.map((l) => (
        <div key={l.slot} className={`eng-hero-pic ${l.slot}`}>
          {adapt ? (
            l.video ? (
              <div className="heroSizer" style={{ aspectRatio: String(ratios[l.url] ?? 16 / 9) }} />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="heroSizer" src={l.url} alt="" loading="lazy" />
            )
          ) : null}
          <div className="eng-hero-layer" style={l.video ? undefined : { backgroundImage: `${gradient}url(${JSON.stringify(l.url)})` }}>
            {l.video ? (
              <video
                className="heroVid"
                src={l.url}
                muted
                loop
                autoPlay
                playsInline
                preload="metadata"
                style={shade > 0 ? { filter: `brightness(${1 - shade})` } : undefined}
                onLoadedMetadata={(e) => {
                  const { videoWidth: w, videoHeight: h } = e.currentTarget;
                  if (w && h) setRatios((r) => (r[l.url] ? r : { ...r, [l.url]: w / h }));
                }}
              />
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}
