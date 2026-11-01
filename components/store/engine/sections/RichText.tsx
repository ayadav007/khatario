import { contentBlocksOf } from '@/lib/store/engine/content-blocks-map';
import type { EngineSectionProps } from '../registry';
import { ContentBlocks } from './ContentBlocks';
import { blockSettings, str, withDefaults } from './shared';

/** Studio's rich-text markup holding the section's content blocks. */
export function RichText({ section }: EngineSectionProps) {
  const blocks = contentBlocksOf(section, (b) => blockSettings(section.type, b));
  if (!blocks.length) return null;
  const align = str(withDefaults(section).align);
  return (
    <div className="rich" style={{ paddingTop: 0, paddingBottom: 0, textAlign: align === 'left' || align === 'right' ? align : 'center' }}>
      <ContentBlocks blocks={blocks} />
    </div>
  );
}
