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
  const withPhoto = categories.filter((c) => images[c.id]);
  if (withPhoto.length === 0) return null;

  const ink = chowkInkOn(paper);
  const [first, second, third] = withPhoto;
  const gap = `color-mix(in srgb, ${ink} 12%, transparent)`;

  const tile = (cat: { id: string; name: string }, className: string) => (
    <button
      key={cat.id}
      type="button"
      onClick={() => onSelect(cat.id)}
      className={`relative overflow-hidden ${className}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={images[cat.id]} alt="" className="h-full w-full object-cover" />
      <span
        className="absolute bottom-0 left-0 line-clamp-2 max-w-[90%] px-2 py-1.5 text-left text-[13px] leading-tight"
        style={{ backgroundColor: paper, color: ink }}
      >
        {cat.name}
      </span>
    </button>
  );

  if (withPhoto.length === 1) {
    return <div className="h-64 w-full sm:h-[28rem]">{tile(first, 'h-full w-full')}</div>;
  }

  if (withPhoto.length === 2) {
    return (
      <div className="grid h-[280px] grid-cols-2 gap-px sm:h-[420px]" style={{ backgroundColor: gap }}>
        {tile(first, 'h-full w-full')}
        {tile(second, 'h-full w-full')}
      </div>
    );
  }

  return (
    <div className="grid h-[320px] grid-cols-2 gap-px sm:h-[480px]" style={{ backgroundColor: gap }}>
      {tile(first, 'h-full w-full')}
      <div className="grid grid-rows-2 gap-px" style={{ backgroundColor: gap }}>
        {tile(second, 'h-full w-full')}
        {tile(third, 'h-full w-full')}
      </div>
    </div>
  );
}
