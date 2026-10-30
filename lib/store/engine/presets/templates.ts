import type { Block, Section, Template } from '../types';
import { newId } from '../shared';

// Client-safe on purpose (the editor imports it): no color-schemes, settings or sanitize here, so these
// are small local builders rather than presets/shared.ts. Section ids are fresh per call.

function blk(type: string, settings: Record<string, unknown> = {}): Block {
  return { type, settings };
}

function sec(type: string, settings: Record<string, unknown> = {}, blocks: Block[] = []): Section {
  const out: Section = { type, settings, blocks: {}, block_order: [] };
  const counts: Record<string, number> = {};
  for (const b of blocks) {
    counts[b.type] = (counts[b.type] ?? 0) + 1;
    const id = `${b.type.replace(/_/g, '-')}-${counts[b.type]}`;
    out.blocks[id] = b;
    out.block_order.push(id);
  }
  return out;
}

function tpl(sections: Section[]): Template {
  const order: string[] = [];
  const map: Record<string, Section> = {};
  for (const s of sections) {
    const id = newId(s.type);
    order.push(id);
    map[id] = s;
  }
  return { order, sections: map };
}

/** The starting layout for a new theme's product or catalog template. */
export function defaultTemplate(kind: 'product' | 'catalog'): Template {
  if (kind === 'product') {
    return tpl([
      sec('main-product', {}, [blk('title'), blk('price'), blk('variant_picker'), blk('buy_buttons'), blk('description')]),
      sec('product-reviews'),
      sec('related-products'),
      sec('recently-viewed'),
    ]);
  }
  return tpl([sec('catalog-banner'), sec('main-catalog')]);
}

/** Starting points for a new custom page. */
export const PAGE_STARTERS: Record<'blank' | 'about' | 'sale' | 'contact', { label: string; build: () => Template }> = {
  blank: { label: 'Blank page', build: () => tpl([]) },
  about: {
    label: 'About us',
    build: () =>
      tpl([
        sec('image-with-text', {
          heading: 'Our story',
          description: '<p>Tell customers about your business.</p>',
          image_side: 'left',
        }),
        sec('rich-text', { heading: 'What we stand for', content: '<p>Share what makes your shop different.</p>', align: 'center' }),
      ]),
  },
  sale: {
    label: 'Sale',
    build: () =>
      tpl([
        sec('image-banner', { heading: 'Sale', button_text: 'Shop now', link: '/' }),
        sec('product-rail', { source: 'discounted', heading: 'On offer now', limit: 8 }),
      ]),
  },
  // Task 7 adds an faq section here.
  contact: {
    label: 'Contact',
    build: () =>
      tpl([sec('rich-text', { heading: 'Get in touch', content: '<p>Call or message us and we will get back to you.</p>', align: 'center' })]),
  },
};
