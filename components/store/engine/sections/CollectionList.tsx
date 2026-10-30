import type { EngineSectionProps } from '../registry';
import { EngineCollectionList } from '../EngineViews';
import { blockSettings, str, withDefaults } from './shared';

/** Merchant-chosen categories with their own picture and title; a block whose category is gone is skipped. */
export function CollectionList({ section, data }: EngineSectionProps) {
  if (!data || data.error) return null;
  const v = withDefaults(section);
  const names = new Map((data.categories ?? []).map((c) => [c.id, c.name]));
  const tiles: { categoryId: string; title: string; image: string }[] = [];
  for (const id of section.block_order ?? []) {
    const block = section.blocks?.[id];
    if (!block || block.disabled || block.type !== 'collection') continue;
    const b = blockSettings(section.type, block);
    const categoryId = b ? str(b.category) : '';
    const name = names.get(categoryId);
    if (!b || !name) continue;
    tiles.push({ categoryId, title: str(b.title) || name, image: str(b.image) });
  }
  if (tiles.length === 0) return null;
  const columns = typeof v.columns === 'number' ? Math.min(6, Math.max(2, v.columns)) : 4;
  return <EngineCollectionList heading={str(v.heading)} columns={columns} tiles={tiles} />;
}
