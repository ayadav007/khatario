import type { EngineSectionProps } from '../registry';
import { MainCatalogView, type CatalogPromo } from '../catalog/MainCatalogView';
import { blockSettings, str, withDefaults } from './shared';

function clamp(v: unknown, min: number, max: number, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback;
}

/**
 * `main-catalog` (D14, D18): settings and enabled promo blocks mapped on the server; the products,
 * filters and sort load in the browser, locked to the route's category on `/catalog/[category]`.
 */
export function MainCatalog({ section, route }: EngineSectionProps) {
  const s = withDefaults(section);
  const promos: CatalogPromo[] = [];
  for (const id of section.block_order) {
    const block = section.blocks[id];
    if (!block || block.disabled || block.type !== 'promo') continue;
    const b = blockSettings(section.type, block);
    if (!b) continue;
    promos.push({
      id,
      image: str(b.image),
      heading: str(b.heading),
      text: str(b.text),
      link: str(b.link),
      position: clamp(b.position, 1, 40, 6),
    });
  }
  return (
    <MainCatalogView
      categoryId={route?.categoryId ?? null}
      settings={{
        columnsDesktop: clamp(s.columns_desktop, 2, 5, 4),
        columnsMobile: clamp(s.columns_mobile, 1, 3, 2),
        showFilters: s.show_filters !== false,
        showSort: s.show_sort !== false,
        showCount: s.show_count !== false,
        fullWidth: s.full_width === true,
      }}
      promos={promos}
    />
  );
}
