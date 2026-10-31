import type { Block, Section } from './types';

// Client-safe and pure: no sanitiser here. The caller supplies each block's settings (the renderer passes
// `blockSettings`, which has already re-sanitised any richtext).

export type HeadingSize = 'small' | 'medium' | 'large';
export type ButtonStyle = 'filled' | 'outline';

export type ContentBlock = { id: string } & (
  | { type: 'eyebrow'; text: string }
  | { type: 'heading'; text: string; size: HeadingSize }
  | { type: 'text'; html: string }
  | { type: 'quote'; text: string; attribution: string }
  | { type: 'checklist_item'; title: string; text: string }
  | { type: 'button'; label: string; link: string; style: ButtonStyle }
  | { type: 'highlight_card'; eyebrow: string; title: string; text: string }
);

const SIZES: readonly HeadingSize[] = ['small', 'medium', 'large'];
const STYLES: readonly ButtonStyle[] = ['filled', 'outline'];

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const filled = (s: string): boolean => s.trim() !== '';
function pick<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

function toContentBlock(id: string, block: Block, s: Record<string, unknown>): ContentBlock | null {
  switch (block.type) {
    case 'eyebrow':
      return filled(str(s.text)) ? { id, type: 'eyebrow', text: str(s.text) } : null;
    case 'heading':
      return filled(str(s.text)) ? { id, type: 'heading', text: str(s.text), size: pick(s.size, SIZES, 'medium') } : null;
    case 'text':
      return filled(str(s.content)) ? { id, type: 'text', html: str(s.content) } : null;
    case 'quote':
      return filled(str(s.text)) ? { id, type: 'quote', text: str(s.text), attribution: str(s.attribution) } : null;
    case 'checklist_item':
      return filled(str(s.title)) ? { id, type: 'checklist_item', title: str(s.title), text: str(s.text) } : null;
    case 'button':
      return filled(str(s.label))
        ? { id, type: 'button', label: str(s.label), link: str(s.link), style: pick(s.style, STYLES, 'filled') }
        : null;
    case 'highlight_card': {
      const card = { eyebrow: str(s.eyebrow), title: str(s.title), text: str(s.text) };
      // A card with nothing in it would draw an empty box over the image.
      return filled(card.eyebrow + card.title + card.text) ? { id, type: 'highlight_card', ...card } : null;
    }
    default:
      return null;
  }
}

/**
 * A section's content blocks in block order, ready to render. Disabled and unknown blocks are skipped, and so is a
 * block whose required text is empty (it would render nothing). `settingsOf` returns a block's settings, or null
 * for a block the section's schema does not know.
 */
export function contentBlocksOf(section: Section, settingsOf: (block: Block) => Record<string, unknown> | null): ContentBlock[] {
  const out: ContentBlock[] = [];
  for (const id of section.block_order ?? []) {
    const block = section.blocks?.[id];
    if (!block || block.disabled) continue;
    const settings = settingsOf(block);
    if (!settings) continue;
    const mapped = toContentBlock(id, block, settings);
    if (mapped) out.push(mapped);
  }
  return out;
}
