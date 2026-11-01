import type { CSSProperties } from 'react';
import { galleryAlt, galleryClass, galleryImages, type GalleryImage } from '@/lib/store/engine/image-gallery-map';
import type { EngineSectionProps } from '../registry';
import { CollageTileLink } from './CollageTileLink';
import { blockSettings, str, withDefaults } from './shared';

/** A numeric setting clamped to a range, `fallback` when it is not a number. */
function clamped(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
}

function ImageBody({ g, alt }: { g: GalleryImage; alt: string }) {
  return (
    <figure className="eng-gallery-fig">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="eng-gallery-media" src={g.image} alt={alt} loading="lazy" />
      {g.caption || g.subcaption ? (
        <figcaption className="eng-gallery-cap">
          {g.caption ? <b>{g.caption}</b> : null}
          {g.subcaption ? <span>{g.subcaption}</span> : null}
        </figcaption>
      ) : null}
    </figure>
  );
}

/** A grid, masonry or sideways strip of photos; captions show on hover (always on touch screens). */
export function ImageGallery({ section }: EngineSectionProps) {
  const v = withDefaults(section);
  const images = galleryImages(section, (b) => blockSettings(section.type, b));
  if (images.length === 0) return null;

  const style = {
    '--eng-cols': clamped(v.columns, 2, 6, 4),
    '--eng-gap': `${clamped(v.gap, 0, 32, 8)}px`,
  } as CSSProperties;

  return (
    <div className={galleryClass(v)} style={style}>
      {str(v.eyebrow) || str(v.heading) ? (
        <div className="eng-gallery-head">
          {str(v.eyebrow) ? <p className="eyebrow">{str(v.eyebrow)}</p> : null}
          {str(v.heading) ? <h2 className="eng-gallery-heading">{str(v.heading)}</h2> : null}
        </div>
      ) : null}
      <ul className="eng-gallery-list">
        {images.map((g, i) => {
          const { alt, ariaLabel } = galleryAlt(g, v.hover, i);
          return (
            <li key={g.id} className="eng-gallery-item">
              {g.href ? (
                <CollageTileLink href={g.href} className="eng-gallery-link" kind="gallery" ariaLabel={ariaLabel}>
                  <ImageBody g={g} alt={alt} />
                </CollageTileLink>
              ) : (
                <ImageBody g={g} alt={alt} />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
