import type { SectionSchema } from '../schema-types';

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback;
}

/** Category products: one product rail per category that has products, each with a "View all" link. */
export const categoryShelves: SectionSchema = {
  type: 'category-shelves',
  name: 'Category shelves',
  category: 'Products',
  templates: ['home', 'page'],
  settings: [
    { id: 'max_categories', type: 'range', label: 'Categories', min: 1, max: 12, step: 1, default: 6 },
    { id: 'per_shelf', type: 'range', label: 'Products per shelf', min: 4, max: 12, step: 1, default: 8 },
    { id: 'show_view_all', type: 'checkbox', label: 'Show "View all"', default: true },
  ],
  presets: [{ name: 'Category shelves', settings: { max_categories: 6, per_shelf: 8, show_view_all: true } }],
  data: (s) => ({
    shelves: {
      maxCategories: clampInt(s.max_categories, 1, 12, 6),
      perShelf: clampInt(s.per_shelf, 4, 12, 8),
    },
  }),
};
