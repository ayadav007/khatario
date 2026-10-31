import { contentBlocksOf } from '@/lib/store/engine/content-blocks-map';
import type { EngineSectionProps } from '../registry';
import { ContentBlocks } from './ContentBlocks';
import { blockSettings, str, withDefaults } from './shared';

/** One still image beside the section's content blocks, in Studio's hero markup. */
export function ImageWithText({ section }: EngineSectionProps) {
  const s = withDefaults(section);
  const blocks = contentBlocksOf(section, (b) => blockSettings(section.type, b));
  const image = str(s.image);
  const card = blocks.find((b) => b.type === 'highlight_card');
  const copy = blocks.filter((b) => b.type !== 'highlight_card');
  const heading = blocks.find((b) => b.type === 'heading');
  const classes = [
    'hero',
    s.image_side === 'right' ? 'text-image' : 'image-text',
    'medium',
    s.image_width === 'narrow' ? 'eng-iwt-narrow' : '',
    s.text_align === 'center' ? 'eng-iwt-center' : '',
  ].filter(Boolean);
  return (
    <div className={classes.join(' ')} style={{ paddingTop: 0, paddingBottom: 0 }}>
      <div className="heroCopy">
        <ContentBlocks blocks={copy} />
      </div>
      <div className="heroImg">
        {image ? (
          <div
            className="heroSlideImg on"
            role="img"
            aria-label={heading?.type === 'heading' ? heading.text : ''}
            style={{ backgroundImage: `url(${JSON.stringify(image)})` }}
          />
        ) : null}
        {card ? <ContentBlocks blocks={[card]} /> : null}
      </div>
    </div>
  );
}
