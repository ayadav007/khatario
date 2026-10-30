import type { EngineSectionProps } from '../registry';
import { str, withDefaults } from './shared';

/**
 * `catalog-banner`: the catalog page's heading (an h1), text and optional background image. On a
 * category route the category name replaces the heading unless `use_category_name` is off.
 */
export function CatalogBanner({ section, route }: EngineSectionProps) {
  const s = withDefaults(section);
  const heading =
    route?.categoryName && s.use_category_name !== false ? route.categoryName : str(s.heading) || 'All products';
  const text = str(s.text);
  const image = str(s.image);
  const tall = s.height === 'medium';
  const box = s.full_width === true ? 'px-4 sm:px-8' : 'mx-auto max-w-6xl px-4 sm:px-8';
  return (
    <div className={box}>
      <div
        className={`relative flex flex-col justify-end overflow-hidden ${image ? 'rounded-2xl' : ''} ${
          tall ? 'min-h-[280px]' : image ? 'min-h-[160px]' : ''
        }`}
      >
        {image ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={image} alt="" className="absolute inset-0 h-full w-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent" />
          </>
        ) : null}
        <div className={`relative ${image ? 'p-5 text-white sm:p-8' : ''}`}>
          <h1 className="text-2xl font-bold leading-tight sm:text-3xl" style={{ overflowWrap: 'anywhere' }}>
            {heading}
          </h1>
          {text ? (
            <p className="mt-2 max-w-2xl text-sm sm:text-base" style={image ? undefined : { opacity: 0.75 }}>
              {text}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
