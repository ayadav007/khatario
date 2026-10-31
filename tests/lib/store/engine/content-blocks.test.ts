import { CONTENT_BLOCKS, HIGHLIGHT_CARD_BLOCK } from '@/lib/store/engine/content-blocks';
import { getSectionSchema } from '@/lib/store/engine/registry';

describe('content blocks', () => {
  it('declares the six content blocks with the spec limits', () => {
    expect(CONTENT_BLOCKS.map((b) => b.type)).toEqual(['eyebrow', 'heading', 'text', 'quote', 'checklist_item', 'button']);
    const by = Object.fromEntries(CONTENT_BLOCKS.map((b) => [b.type, b]));
    const setting = (type: string, id: string) => by[type].settings.find((s) => s.id === id);
    expect(setting('eyebrow', 'text')?.max_length).toBe(60);
    expect(setting('heading', 'text')?.max_length).toBe(120);
    expect(setting('heading', 'size')).toMatchObject({ type: 'select', default: 'medium' });
    expect(setting('heading', 'size')?.options?.map((o) => o.value)).toEqual(['small', 'medium', 'large']);
    expect(setting('text', 'content')?.type).toBe('richtext');
    expect(setting('quote', 'text')?.max_length).toBe(400);
    expect(setting('quote', 'attribution')?.max_length).toBe(80);
    expect(setting('checklist_item', 'title')?.max_length).toBe(60);
    expect(setting('checklist_item', 'text')?.max_length).toBe(160);
    expect(setting('button', 'label')?.max_length).toBe(30);
    expect(setting('button', 'link')?.type).toBe('url');
    expect(setting('button', 'style')).toMatchObject({ default: 'filled' });
    expect(setting('button', 'style')?.options?.map((o) => o.value)).toEqual(['filled', 'outline']);
  });

  it('the highlight card is limited to one and has its own limits', () => {
    expect(HIGHLIGHT_CARD_BLOCK).toMatchObject({ type: 'highlight_card', limit: 1 });
    const max = (id: string) => HIGHLIGHT_CARD_BLOCK.settings.find((s) => s.id === id)?.max_length;
    expect([max('eyebrow'), max('title'), max('text')]).toEqual([40, 80, 200]);
  });

  it('image-with-text and rich-text take the blocks and no longer have heading/description settings', () => {
    const iwt = getSectionSchema('image-with-text')!;
    expect(iwt.blocks!.map((b) => b.type)).toEqual([...CONTENT_BLOCKS.map((b) => b.type), 'highlight_card']);
    expect(iwt.max_blocks).toBe(12);
    expect(iwt.settings.map((s) => s.id)).toEqual(expect.arrayContaining(['image', 'image_side', 'image_width', 'text_align']));
    expect(iwt.settings.find((s) => s.id === 'image_width')).toMatchObject({ default: 'half' });
    expect(iwt.settings.find((s) => s.id === 'text_align')).toMatchObject({ default: 'left' });
    for (const old of ['heading', 'description', 'button_text', 'link']) expect(iwt.settings.find((s) => s.id === old)).toBeUndefined();
    const rt = getSectionSchema('rich-text')!;
    expect(rt.blocks!.map((b) => b.type)).toEqual(CONTENT_BLOCKS.map((b) => b.type));
    expect(rt.max_blocks).toBe(12);
    expect(rt.settings.map((s) => s.id)).toContain('align');
    for (const old of ['heading', 'content']) expect(rt.settings.find((s) => s.id === old)).toBeUndefined();
    expect(rt.settings.find((s) => s.id === 'align')).toMatchObject({ default: 'center' });
  });
});
