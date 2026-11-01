import type { CSSProperties } from 'react';
import { contentBlocksOf } from '@/lib/store/engine/content-blocks-map';
import { heroGridClass, heroImageLayers, heroRootClasses } from '@/lib/store/engine/hero-layout';
import type { EngineSectionProps } from '../registry';
import { ContentBlocks } from './ContentBlocks';
import { HeroMedia } from './HeroMedia';
import { blockSettings, str, withDefaults } from './shared';
import '../hero.css';

const HEX = /^#[0-9a-f]{3,8}$/i;

/**
 * Hero banner (`image-banner`): pictures or videos behind the section's content blocks, placed in one of nine cells.
 * Keeps Studio's `.banner` card (margins, rounded corners, padding, panel colour), so a converted old banner looks as
 * before; hero.css lays out the rest. A hero with neither pictures nor words renders nothing.
 */
export function ImageBanner({ section }: EngineSectionProps) {
  const s = withDefaults(section);
  const blocks = contentBlocksOf(section, (b) => blockSettings(section.type, b));
  const layers = heroImageLayers({ image: str(s.image), image2: str(s.image_2), mobileImage: str(s.mobile_image) });
  if (!layers.length && !blocks.length) return null;
  const textColor = HEX.test(str(s.text_color)) ? str(s.text_color) : '';
  const overlay = typeof s.overlay === 'number' && Number.isFinite(s.overlay) ? Math.min(80, Math.max(0, s.overlay)) : 40;
  const state = heroRootClasses({
    height: str(s.height),
    motion: str(s.motion),
    box: s.box === true,
    textColor: !!textColor,
    textBelowMobile: s.text_below_mobile === true,
    twoImagesMobile: str(s.two_images_mobile),
    alignMobile: str(s.align_mobile),
    words: blocks.length > 0,
    layers,
  });
  const flags = state.split(' ');
  return (
    <div
      className={`banner eng-hero ${state} ${heroGridClass(str(s.position), str(s.align))}`}
      style={textColor ? ({ '--hb-text': textColor } as CSSProperties) : undefined}
    >
      {layers.length ? (
        <HeroMedia layers={layers} shade={overlay / 100} adapt={flags.includes('hb-h-adapt')} zoom={flags.includes('hb-motion-zoom')} />
      ) : null}
      {blocks.length ? (
        <div className="eng-hero-inner">
          <div className="eng-hero-copy">
            <ContentBlocks blocks={blocks} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
