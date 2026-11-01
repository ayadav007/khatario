'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * A theme's demo store drawn live in a frame: the store renders at its real width (1440 for computers, 390 for
 * phones) and is scaled down to the box. The frame loads only once it comes near the view, shows a skeleton in the
 * theme's colours until then, and "Preview unavailable" if it has not loaded after 20 seconds. Card previews
 * (`interactive` off) cannot be focused or clicked, so the card stays the click target.
 */
export function ThemeLivePreview({
  src,
  width,
  height,
  interactive,
  palette,
  title,
}: {
  src: string;
  width: 1440 | 390;
  height: number;
  interactive: boolean;
  palette: [string, string, string];
  title: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  const [near, setNear] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const resize = new ResizeObserver(([entry]) => setScale(entry.contentRect.width / width));
    resize.observe(el);
    const seen = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setNear(true);
          seen.disconnect();
        }
      },
      { rootMargin: '200px' },
    );
    seen.observe(el);
    return () => {
      resize.disconnect();
      seen.disconnect();
    };
  }, [width]);

  // A new address (the theme page's switches) loads again.
  useEffect(() => {
    setLoaded(false);
    setFailed(false);
  }, [src]);

  useEffect(() => {
    if (!near || loaded) return;
    const t = window.setTimeout(() => setFailed(true), 20_000);
    return () => window.clearTimeout(t);
  }, [near, loaded, src]);

  const [paper, accent, ink] = palette;
  return (
    <div
      ref={box}
      className="relative w-full overflow-hidden"
      style={{ aspectRatio: `${width} / ${height}`, background: paper }}
      aria-hidden={interactive ? undefined : true}
    >
      {!loaded ? (
        <div className="absolute inset-0 flex flex-col gap-[6%] p-[5%]" aria-hidden>
          <div className="h-[7%] w-full rounded" style={{ background: ink, opacity: 0.12 }} />
          <div className="h-[38%] w-full rounded-lg" style={{ background: accent, opacity: 0.18 }} />
          <div className="grid flex-1 grid-cols-4 gap-[4%]">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="rounded" style={{ background: ink, opacity: 0.08 }} />
            ))}
          </div>
          {failed ? (
            <p className="absolute inset-0 flex items-center justify-center text-sm font-medium text-slate-600">Preview unavailable</p>
          ) : null}
        </div>
      ) : null}
      {near && scale > 0 ? (
        <iframe
          key={src}
          src={src}
          title={title}
          loading="lazy"
          tabIndex={interactive ? undefined : -1}
          onLoad={() => setLoaded(true)}
          className="absolute left-0 top-0 origin-top-left border-0"
          style={{
            width,
            height,
            transform: `scale(${scale})`,
            pointerEvents: interactive ? 'auto' : 'none',
            opacity: loaded ? 1 : 0,
            transition: 'opacity .3s',
          }}
        />
      ) : null}
    </div>
  );
}
