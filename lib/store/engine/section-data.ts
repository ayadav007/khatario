import { queryRows } from '@/lib/db';
import type { StoreBusinessContext } from '@/lib/store/resolve-store';
import { mapStoreItemRow, type StoreItem } from '@/lib/store/map-store-product';
import { buildStoreItemsQuery, type StoreItemsQueryInput } from '@/lib/store/store-items-query';
import { getSectionSchema } from './registry';
import type { SectionDataRequest } from './schema-types';
import type { Template } from './types';

export interface SectionCategory {
  id: string;
  name: string;
  item_count: number;
  image_url: string | null;
}

export interface SectionData {
  products?: StoreItem[];
  categories?: SectionCategory[];
  /** An optional categories lookup failed: `categories` is `[]` so the section still renders, but it is not the truth. */
  categoriesFailed?: true;
  /** Category shelves: one entry per category with products, in category order. */
  shelves?: Array<{ category: SectionCategory; products: StoreItem[] }>;
  error?: string;
}

export interface ResolveOptions {
  branchId?: string | null;
  /** Narrows only `source: 'all'` requests (the `cat` URL key). */
  categoryId?: string | null;
  /** Narrows only `source: 'all'` requests (the `q` URL key). */
  search?: string | null;
  /** Narrows only `source: 'all'` requests (the `disc` URL key: 10, 25 or 50 percent off or more). */
  minDiscountPct?: number | null;
}

type ProductsRequest = NonNullable<SectionDataRequest['products']>;

/** Section id to what it needs. Skips disabled sections and types with no `data`. */
export function collectDataRequests(groups: Template[]): Map<string, SectionDataRequest> {
  const out = new Map<string, SectionDataRequest>();
  for (const group of groups) {
    for (const [id, section] of Object.entries(group.sections)) {
      if (section.disabled) continue;
      const schema = getSectionSchema(section.type);
      if (!schema?.data) continue;
      out.set(id, schema.data(section.settings));
    }
  }
  return out;
}

/** Requests with the same key run as one query. Only fields that apply to the source are part of the key. */
export function productRequestKey(
  p: ProductsRequest,
  narrow: { categoryId?: string | null; search?: string | null; minDiscountPct?: number | null } = {},
): string {
  return JSON.stringify([
    p.source,
    p.source === 'category' ? (p.categoryId ?? null) : null,
    p.source === 'price_max' ? (p.priceMax ?? null) : null,
    p.source === 'all' ? (narrow.categoryId ?? null) : null,
    p.source === 'all' ? (narrow.search ?? null) : null,
    p.source === 'all' ? (narrow.minDiscountPct ?? null) : null,
    p.limit,
  ]);
}

function queryInput(
  store: StoreBusinessContext,
  p: ProductsRequest,
  opts: ResolveOptions,
): StoreItemsQueryInput {
  const input: StoreItemsQueryInput = {
    businessId: store.business_id,
    branchId: opts.branchId ?? null,
    limit: p.limit,
    offset: 0,
  };
  switch (p.source) {
    case 'featured':
      input.featuredOnly = true;
      break;
    case 'discounted':
      input.discountedOnly = true;
      break;
    case 'new':
      input.sort = 'new';
      break;
    case 'bestsellers':
      input.sort = 'bestsellers';
      break;
    case 'category':
      input.categoryId = p.categoryId;
      break;
    case 'price_max':
      input.maxPrice = p.priceMax;
      break;
    case 'all':
      input.categoryId = opts.categoryId ?? null;
      input.search = opts.search ?? null;
      input.minDiscountPct = opts.minDiscountPct ?? null;
      break;
  }
  return input;
}

async function loadProducts(
  store: StoreBusinessContext,
  p: ProductsRequest,
  opts: ResolveOptions,
): Promise<StoreItem[]> {
  // A category rail with no category picked shows nothing rather than the whole catalog.
  if (p.source === 'category' && !p.categoryId) return [];

  const input = queryInput(store, p, opts);

  if (store.is_demo) {
    const { filterDemoCatalog } = await import('@/lib/store/theme-demo');
    return filterDemoCatalog({
      pack: store.store_theme?.pack,
      categoryId: input.categoryId,
      search: input.search,
      page: 1,
      limit: p.limit,
      featuredOnly: input.featuredOnly,
      discountedOnly: input.discountedOnly,
      minDiscountPct: input.minDiscountPct,
      maxPrice: input.maxPrice,
      sort: input.sort === 'new' || input.sort === 'bestsellers' ? input.sort : 'name',
    }).items as unknown as StoreItem[];
  }

  const q = buildStoreItemsQuery(input);
  const rows = await queryRows<Record<string, unknown>>(q.listSql, q.listParams);
  return rows.map(mapStoreItemRow);
}

/** A business's store categories (those with store products), by name, with item counts. */
export async function storeCategories(businessId: string): Promise<SectionCategory[]> {
  const q = buildStoreItemsQuery({ businessId, limit: 1, offset: 0 });
  const rows = await queryRows<{ id: string; name: string; item_count: number }>(
    q.categorySql,
    q.categoryParams,
  );
  // The categories table has no image column yet: like the old storefront, a category shows the photo of its
  // first store product (by name) that has one.
  const photos = await queryRows<{ category_id: string; image_url: string }>(
    `SELECT DISTINCT ON (i.category_id) i.category_id, i.image_url
       FROM items i
      WHERE i.business_id = $1 AND i.show_in_store = true
        AND (i.is_active IS NULL OR i.is_active = true)
        AND i.deleted_at IS NULL
        AND i.category_id IS NOT NULL AND COALESCE(i.image_url, '') <> ''
      ORDER BY i.category_id, i.name, i.id`,
    [businessId],
  );
  const photo = new Map(photos.map((p) => [p.category_id, p.image_url]));
  return rows.map((r) => ({ id: r.id, name: r.name, item_count: r.item_count, image_url: photo.get(r.id) ?? null }));
}

async function loadCategories(store: StoreBusinessContext): Promise<SectionCategory[]> {
  if (store.is_demo) {
    const { filterDemoCatalog } = await import('@/lib/store/theme-demo');
    const demo = filterDemoCatalog({ pack: store.store_theme?.pack, page: 1, limit: 500 });
    const byName = [...demo.items].sort((a, b) => a.name.localeCompare(b.name));
    return demo.categories.map((c) => ({
      id: c.id,
      name: c.name,
      item_count: c.item_count,
      image_url: byName.find((i) => i.category_id === c.id && i.image_url)?.image_url ?? null,
    }));
  }
  return storeCategories(store.business_id);
}

const CATEGORY_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The name of one of the business's categories, or null when it has no such category (a malformed id
 * is never queried). A category with no store products still counts: its catalog page shows it empty.
 */
export async function catalogCategoryName(store: StoreBusinessContext, categoryId: string): Promise<string | null> {
  if (store.is_demo) {
    const { filterDemoCatalog } = await import('@/lib/store/theme-demo');
    const cats = filterDemoCatalog({ pack: store.store_theme?.pack, page: 1, limit: 1 }).categories;
    return cats.find((c) => c.id === categoryId)?.name ?? null;
  }
  if (!CATEGORY_ID_RE.test(categoryId)) return null;
  // The categories table has no deleted/active columns; the business scope is the whole visibility rule.
  const rows = await queryRows<{ name: string }>('SELECT name FROM categories WHERE id = $1 AND business_id = $2', [
    categoryId,
    store.business_id,
  ]);
  return rows[0]?.name ?? null;
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Loads what each section asked for. Identical product requests share one query, categories load once,
 * and a failure only marks the sections that depended on the failed query.
 */
export async function resolveSectionData(
  store: StoreBusinessContext,
  requests: Map<string, SectionDataRequest>,
  opts: ResolveOptions = {},
): Promise<Record<string, SectionData>> {
  const productJobs = new Map<string, Promise<{ items?: StoreItem[]; error?: string }>>();
  const sectionKey = new Map<string, string>();
  let categoriesJob: Promise<{ items?: SectionCategory[]; error?: string }> | null = null;

  const productJob = (p: ProductsRequest): string => {
    const key = productRequestKey(p, opts);
    if (!productJobs.has(key)) {
      productJobs.set(
        key,
        loadProducts(store, p, opts).then(
          (items) => ({ items }),
          (e) => ({ error: message(e) }),
        ),
      );
    }
    return key;
  };

  for (const [id, req] of requests) {
    if (req.products) sectionKey.set(id, productJob(req.products));
    if ((req.categories || req.shelves) && !categoriesJob) {
      categoriesJob = loadCategories(store).then(
        (items) => ({ items }),
        (e) => ({ error: message(e) }),
      );
    }
  }

  // Shelves need the categories first; their per-category product requests share the same job map.
  const shelfPlans = new Map<string, { error?: string; shelves: Array<{ category: SectionCategory; key: string }> }>();
  for (const [id, req] of requests) {
    if (!req.shelves || !categoriesJob) continue;
    const cats = await categoriesJob;
    if (cats.error) {
      shelfPlans.set(id, { error: cats.error, shelves: [] });
      continue;
    }
    const picked = (cats.items ?? []).filter((c) => c.item_count > 0).slice(0, Math.max(0, req.shelves.maxCategories));
    shelfPlans.set(id, {
      shelves: picked.map((category) => ({
        category,
        key: productJob({ source: 'category', categoryId: category.id, limit: req.shelves!.perShelf }),
      })),
    });
  }

  const result: Record<string, SectionData> = {};
  for (const [id, req] of requests) {
    const data: SectionData = {};
    if (req.products) {
      const r = await productJobs.get(sectionKey.get(id)!)!;
      if (r.error) data.error = r.error;
      else data.products = r.items;
    }
    if (req.categories && categoriesJob) {
      const r = await categoriesJob;
      // Optional categories (the header's chips) degrade to none, so the section still renders; menus read the flag.
      if (r.error && req.categoriesOptional) {
        data.categories = [];
        data.categoriesFailed = true;
      } else if (r.error) data.error = data.error ?? r.error;
      else data.categories = r.items;
    }
    const plan = shelfPlans.get(id);
    if (plan) {
      if (plan.error) data.error = data.error ?? plan.error;
      else {
        const shelves: NonNullable<SectionData['shelves']> = [];
        for (const { category, key } of plan.shelves) {
          const r = await productJobs.get(key)!;
          if (r.error) {
            data.error = data.error ?? r.error;
            break;
          }
          if (r.items && r.items.length > 0) shelves.push({ category, products: r.items });
        }
        if (!data.error) data.shelves = shelves;
      }
    }
    result[id] = data;
  }
  return result;
}
