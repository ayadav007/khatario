import { contentBlocksOf } from '@/lib/store/engine/content-blocks-map';
import type { Block, Section } from '@/lib/store/engine/types';

function sec(type: string, blocks: Array<[string, Block]>): Section {
  return {
    type,
    settings: {},
    blocks: Object.fromEntries(blocks),
    block_order: blocks.map(([id]) => id),
  };
}

const blk = (type: string, settings: Record<string, unknown>, disabled = false): Block => ({ type, settings, ...(disabled ? { disabled: true } : {}) });
const plain = (b: Block) => ({ ...b.settings });

describe('contentBlocksOf', () => {
  it('maps blocks in order, skipping disabled and empty ones', () => {
    const section = sec('rich-text', [
      ['eyebrow-1', blk('eyebrow', { text: 'New' })],
      ['heading-1', blk('heading', { text: '', size: 'large' })],
      ['button-1', blk('button', { label: 'Go', link: '/catalog', style: 'outline' }, true)],
    ]);
    expect(contentBlocksOf(section, plain)).toEqual([{ id: 'eyebrow-1', type: 'eyebrow', text: 'New' }]);
  });

  it('maps every block type to its fields', () => {
    const section = sec('image-with-text', [
      ['heading-1', blk('heading', { text: 'Our story', size: 'small' })],
      ['text-1', blk('text', { content: '<p>Hi</p>' })],
      ['quote-1', blk('quote', { text: 'Great', attribution: 'Asha' })],
      ['checklist-item-1', blk('checklist_item', { title: 'Fresh', text: 'Daily' })],
      ['button-1', blk('button', { label: 'Go', link: '/catalog', style: 'outline' })],
      ['highlight-card-1', blk('highlight_card', { eyebrow: 'Since', title: '1998', text: 'Family run' })],
    ]);
    expect(contentBlocksOf(section, plain)).toEqual([
      { id: 'heading-1', type: 'heading', text: 'Our story', size: 'small' },
      { id: 'text-1', type: 'text', html: '<p>Hi</p>' },
      { id: 'quote-1', type: 'quote', text: 'Great', attribution: 'Asha' },
      { id: 'checklist-item-1', type: 'checklist_item', title: 'Fresh', text: 'Daily' },
      { id: 'button-1', type: 'button', label: 'Go', link: '/catalog', style: 'outline' },
      { id: 'highlight-card-1', type: 'highlight_card', eyebrow: 'Since', title: '1998', text: 'Family run' },
    ]);
  });

  it('falls back to the default size and style for values outside the allowed ones', () => {
    const section = sec('rich-text', [
      ['heading-1', blk('heading', { text: 'H', size: 'huge' })],
      ['button-1', blk('button', { label: 'Go', style: 'glow' })],
    ]);
    expect(contentBlocksOf(section, plain)).toEqual([
      { id: 'heading-1', type: 'heading', text: 'H', size: 'medium' },
      { id: 'button-1', type: 'button', label: 'Go', link: '', style: 'filled' },
    ]);
  });

  it('drops blocks whose required text is empty or only spaces', () => {
    const section = sec('rich-text', [
      ['text-1', blk('text', { content: '' })],
      ['quote-1', blk('quote', { text: '  ', attribution: 'Someone' })],
      ['checklist-item-1', blk('checklist_item', { title: '', text: 'Orphan text' })],
      ['button-1', blk('button', { label: '', link: '/x' })],
      ['highlight-card-1', blk('highlight_card', { eyebrow: '', title: '', text: '' })],
    ]);
    expect(contentBlocksOf(section, plain)).toEqual([]);
  });

  it('keeps a checklist item without text and a quote without attribution', () => {
    const section = sec('rich-text', [
      ['checklist-item-1', blk('checklist_item', { title: 'Fresh' })],
      ['quote-1', blk('quote', { text: 'Great' })],
    ]);
    expect(contentBlocksOf(section, plain)).toEqual([
      { id: 'checklist-item-1', type: 'checklist_item', title: 'Fresh', text: '' },
      { id: 'quote-1', type: 'quote', text: 'Great', attribution: '' },
    ]);
  });

  it('skips unknown block types, blocks the settings reader rejects, and ids missing from blocks', () => {
    const section = sec('rich-text', [
      ['gallery-1', blk('gallery', { text: 'x' })],
      ['eyebrow-1', blk('eyebrow', { text: 'Kept' })],
      ['eyebrow-2', blk('eyebrow', { text: 'Rejected' })],
    ]);
    section.block_order.push('ghost-1');
    const out = contentBlocksOf(section, (b) => (b.settings.text === 'Rejected' ? null : plain(b)));
    expect(out.map((b) => b.id)).toEqual(['eyebrow-1']);
  });
});
