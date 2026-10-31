'use client';

import { useEffect, useState } from 'react';
import { LayoutGrid } from 'lucide-react';

export interface RailCategory {
  id: string;
  name: string;
  /** The category's photo (its first store product's), or empty for a letter tile. */
  image: string;
}

// The old Quick category view (quick-theme.css `.qk-rail`), in the section's colour scheme when it has one.
export const RAIL_CSS =
  '.eng-rail{display:grid;grid-template-columns:84px minmax(0,1fr);align-items:start}' +
  '.eng-rail-nav{position:sticky;top:var(--eng-rail-top,0px);max-height:calc(100vh - var(--eng-rail-top,0px));overflow-y:auto;scrollbar-width:none;background:var(--c-card,var(--st-card,#fff));border-right:1px solid var(--c-border,var(--st-line,rgba(0,0,0,.08)));padding:4px 0 120px}' +
  '.eng-rail-nav::-webkit-scrollbar{display:none}' +
  '.eng-rail-nav button{position:relative;display:flex;flex-direction:column;align-items:center;gap:5px;width:100%;border:0;background:none;color:inherit;padding:10px 4px;cursor:pointer;text-align:center}' +
  '.eng-rail-pic{width:52px;height:52px;border-radius:14px;object-fit:cover;background:color-mix(in srgb,var(--c-accent,var(--primary)) 10%,var(--c-card,var(--st-card,#fff)));display:flex;align-items:center;justify-content:center;font-weight:800;color:var(--c-accent,var(--primary));transition:transform .2s}' +
  '.eng-rail-pic svg{width:24px;height:24px}' +
  '.eng-rail-nav b{font-size:11px;font-weight:500;line-height:1.25;opacity:.75;overflow-wrap:anywhere}' +
  '.eng-rail-nav button.on{background:color-mix(in srgb,var(--c-accent,var(--primary)) 8%,transparent)}' +
  ".eng-rail-nav button.on::before{content:'';position:absolute;right:0;top:10px;bottom:10px;width:3px;border-radius:3px 0 0 3px;background:var(--c-accent,var(--primary))}" +
  '.eng-rail-nav button.on b{opacity:1;font-weight:700}' +
  '.eng-rail-nav button.on .eng-rail-pic{transform:scale(1.06)}' +
  '.eng-rail-main{min-width:0;padding:12px 10px}' +
  '@container store (min-width: 900px){' +
  '.eng-rail{grid-template-columns:220px minmax(0,1fr)}' +
  '.eng-rail-nav button{flex-direction:row;gap:10px;padding:8px 14px;text-align:left}' +
  '.eng-rail-pic{width:40px;height:40px;border-radius:10px;flex:0 0 auto}' +
  '.eng-rail-nav b{font-size:13px}' +
  '.eng-rail-main{padding:16px 24px}' +
  '}';

/** The height of the store's sticky header, so the rail pins just below it whatever its height. */
export function useStickyHeaderHeight(): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const el = document.querySelector('.st-sticky');
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setHeight((el as HTMLElement).offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return height;
}

/** The category column: "All" first, then each category with its photo; `selected` null is "All". */
export function CategoryRail({
  categories,
  selected,
  onPick,
}: {
  categories: RailCategory[];
  selected: string | null;
  onPick: (id: string | null) => void;
}) {
  const entries = [{ id: null, name: 'All', image: '' }, ...categories];
  return (
    <nav className="eng-rail-nav" aria-label="Categories">
      {entries.map((c) => {
        const on = c.id === selected;
        return (
          <button type="button" key={c.id ?? 'all'} className={on ? 'on' : ''} aria-current={on} onClick={() => onPick(c.id)}>
            {c.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="eng-rail-pic" src={c.image} alt="" loading="lazy" />
            ) : (
              <span className="eng-rail-pic" aria-hidden>
                {c.id ? c.name.charAt(0).toUpperCase() : <LayoutGrid />}
              </span>
            )}
            <b>{c.name}</b>
          </button>
        );
      })}
    </nav>
  );
}
