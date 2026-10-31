import type { StudioSettings } from '@/lib/store/studio-sections';
import type { EngineSectionProps } from '../registry';
import { EngineProductGrid } from '../EngineViews';
import { noBox, withDefaults } from './shared';

/** One product rail per category with products, headed by the category name; empty shelves are skipped. */
export function CategoryShelves({ id, section, data }: EngineSectionProps) {
  if (!data || data.error) return null;
  const shelves = (data.shelves ?? []).filter((s) => s.products.length > 0);
  if (shelves.length === 0) return null;
  const v = withDefaults(section);
  const viewAll = v.show_view_all !== false;
  return (
    <div className="eng-shelves">
      {shelves.map(({ category, products }) => {
        const s: StudioSettings = noBox({
          title: category.name,
          eyebrow: '',
          source: 'category',
          categoryId: category.id,
          cardStyle: 'bordered',
          showRating: true,
          showBadges: true,
          limit: products.length,
        });
        return (
          <EngineProductGrid
            key={category.id}
            sectionId={`${id}-${category.id}`}
            s={s}
            products={products}
            isRow
            showViewAll={viewAll}
          />
        );
      })}
    </div>
  );
}
