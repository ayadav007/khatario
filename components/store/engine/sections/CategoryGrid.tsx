import { engineCategoryStyle, pickCategories } from '@/lib/store/engine/render-helpers';
import type { EngineSectionProps } from '../registry';
import { EngineCategoryGrid } from '../EngineViews';
import { noBox, str, withDefaults } from './shared';

export function CategoryGrid({ id, section, data }: EngineSectionProps) {
  if (!data || data.error) return null;
  const v = withDefaults(section);
  const categories = pickCategories(data.categories ?? [], v.categories);
  if (categories.length === 0) return null;
  const images: Record<string, string> = {};
  for (const c of categories) if (c.image_url) images[c.id] = c.image_url;
  return (
    <EngineCategoryGrid
      sectionId={id}
      s={noBox({
        title: str(v.heading),
        eyebrow: str(v.eyebrow),
        columns: typeof v.columns === 'number' ? v.columns : 4,
      })}
      categories={categories.map((c) => ({ id: c.id, name: c.name, count: c.item_count }))}
      style={engineCategoryStyle(v.style, Object.keys(images).length > 0)}
      images={images}
    />
  );
}
