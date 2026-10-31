import type { Block, Section, Template } from '../types';

export { presetSettings } from './look';

export function block(type: string, settings: Record<string, unknown>): Block {
  return { type, settings };
}

/** Block ids are `<blocktype>-<n>` (underscores become dashes), so they are deterministic. */
export function section(type: string, settings: Record<string, unknown>, blocks: Block[] = []): Section {
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

/**
 * D30: a section's id is its type; a repeated type gets `-2`, `-3` and so on, so ids stay unique and
 * deterministic (two `product-rail`s become `product-rail` and `product-rail-2`).
 */
export function template(sections: Section[]): Template {
  const counts: Record<string, number> = {};
  const out: Template = { order: [], sections: {} };
  for (const s of sections) {
    counts[s.type] = (counts[s.type] ?? 0) + 1;
    const id = counts[s.type] === 1 ? s.type : `${s.type}-${counts[s.type]}`;
    out.order.push(id);
    out.sections[id] = s;
  }
  return out;
}
