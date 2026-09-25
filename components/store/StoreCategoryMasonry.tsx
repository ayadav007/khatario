'use client';

import { chowkInkOn } from '@/lib/store/store-theme';

export function StoreCategoryMasonry({
  categories,
  images,
  paper,
  onSelect,
}: {
  categories: Array<{ id: string; name: string }>;
  images: Record<string, string>;
  paper: string;
  onSelect: (id: string) => void;
}) {
  if (categories.length === 0) return null;
  const ink = chowkInkOn(paper);

  return (
    <section id="shop-categories" className="mx-auto max-w-6xl px-4 pt-7">
      <div className="mb-4 flex items-end justify-between">
        <h2 className="text-[1.05rem] font-semibold" style={{ color: ink }}>
          Shop by category
        </h2>
      </div>
      <div className="flex gap-4 overflow-x-auto pb-2 md:flex-wrap md:overflow-visible">
        {categories.map((cat) => {
          const photo = images[cat.id];
          return (
            <button
              key={cat.id}
              type="button"
              onClick={() => onSelect(cat.id)}
              className="w-[4.5rem] flex-shrink-0 md:w-24"
            >
              <span className="mx-auto flex h-[4.5rem] w-[4.5rem] items-center justify-center overflow-hidden rounded-full bg-white shadow-sm md:h-24 md:w-24">
                {photo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={photo} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="font-chowk-display text-xl" style={{ color: ink, opacity: 0.45 }}>
                    {cat.name.slice(0, 1).toUpperCase()}
                  </span>
                )}
              </span>
              <span className="mt-2 line-clamp-2 text-center text-[11px] font-medium leading-tight" style={{ color: ink }}>
                {cat.name}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
