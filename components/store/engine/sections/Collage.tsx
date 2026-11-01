import { collageMode, collageTiles, type CollageTile } from '@/lib/store/engine/collage-map';
import { ctaTarget, engineCatalogHref, engineProductHref } from '@/lib/store/engine/links';
import type { EngineSectionProps } from '../registry';
import { EngineCtaButton } from '../EngineViews';
import { CollageTileLink } from './CollageTileLink';
import { blockSettings, richtextHtml, str, withDefaults } from './shared';

// StudioSections' own rupees() is in a client module, which a server component cannot call: same format here.
const rupees = (n: number): string => `₹${Math.round(n).toLocaleString('en-IN')}`;

/** Where a tile goes: an image tile its own link (same rules as a button), a product its page, a category the catalog. */
function tileHref(t: CollageTile): string {
  if (t.kind === 'product') return engineProductHref('', t.product.id);
  if (t.kind === 'category') return engineCatalogHref('', { categoryId: t.categoryId });
  const target = ctaTarget(t.link);
  if (target.kind === 'anchor') return `#${target.id}`;
  return target.kind === 'internal' || target.kind === 'external' ? target.href : '';
}

/** Product and category tiles print their name in the caption, so the picture itself adds nothing for a screen reader. */
function tileAlt(t: CollageTile): string {
  return t.kind === 'image' ? t.caption : '';
}

function TileBody({ t }: { t: CollageTile }) {
  const alt = tileAlt(t);
  return (
    <>
      {t.image ? (
        t.kind === 'image' && t.video ? (
          <video className="eng-collage-media" src={t.image} aria-label={alt || undefined} muted loop playsInline autoPlay preload="metadata" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="eng-collage-media" src={t.image} alt={alt} loading="lazy" />
        )
      ) : null}
      {t.kind === 'image' ? (
        t.caption || t.label ? (
          <span className="eng-collage-cap">
            {t.caption ? <b>{t.caption}</b> : null}
            {t.label ? <span>{t.label}</span> : null}
          </span>
        ) : null
      ) : (
        <span className="eng-collage-cap">
          <b>{t.kind === 'product' ? t.product.name : t.name}</b>
          {t.kind === 'product' ? <span>{rupees(t.product.selling_price)}</span> : null}
        </span>
      )}
    </>
  );
}

/** Editorial collage: a text column beside up to four image, product or category tiles, the first one large. */
export function Collage({ section, data }: EngineSectionProps) {
  const v = withDefaults(section);
  const layout = str(v.layout) || 'text-left';
  const tiles = collageTiles(section, data ?? {}, (b) => blockSettings(section.type, b));
  const mode = collageMode(layout, tiles.length);
  if (mode === 'empty') return null;

  const html = richtextHtml(section.type, 'text', v.text);
  const buttons = [
    { label: str(v.button_text), link: str(v.link), style: 'filled' as const },
    { label: str(v.button_2_text), link: str(v.link_2), style: 'outline' as const },
  ].filter((b) => b.label);
  const classes = [
    'eng-collage',
    `eng-collage--${layout}`,
    mode === 'text' ? 'eng-collage--text-only' : '',
    v.feature_tile === 'first' && tiles.length >= 2 ? 'eng-collage--feature' : '',
    `eng-collage--${v.tile_shape === 'square' ? 'square' : 'portrait'}`,
  ].filter(Boolean);

  return (
    <div className={classes.join(' ')}>
      {mode !== 'tiles' ? (
        <div className="eng-collage-text">
          {str(v.eyebrow) ? <p className="eyebrow">{str(v.eyebrow)}</p> : null}
          {str(v.heading) ? <h2 className="eng-collage-heading">{str(v.heading)}</h2> : null}
          {html ? <div className="eng-rt eng-collage-body" dangerouslySetInnerHTML={{ __html: html }} /> : null}
          {buttons.length ? (
            <div className="eng-cb-buttons">
              {buttons.map((b) => (
                <EngineCtaButton key={b.style} label={b.label} link={b.link} style={b.style} />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      {tiles.length ? (
        <div className="eng-collage-grid" data-count={tiles.length}>
          {tiles.map((t) => {
            const href = tileHref(t);
            return href ? (
              <CollageTileLink key={t.id} href={href} className="eng-collage-tile" kind={t.kind}>
                <TileBody t={t} />
              </CollageTileLink>
            ) : (
              <div key={t.id} className="eng-collage-tile" data-kind={t.kind}>
                <TileBody t={t} />
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
