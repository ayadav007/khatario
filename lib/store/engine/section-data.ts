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
  error?: string;
}

export interface ResolveOptions {
  branchId?: string | null;
  /** Narrows only `source: 'all'` requests (the `cat` URL key). */
  categoryId?: string | null;
  /** Narrows only `source: 'all'` requests (the `q` URL key). */
  search?: string | null;
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
  narrow: { categoryId?: string | null; search?: string | null } = {},
): string {
  return JSON.stringify([
    p.source,
    p.source === 'category' ? (p.categoryId ?? null) : null,
    p.source === 'price_max' ? (p.priceMax ?? null) : null,
    p.source === 'all' ? (narrow.categoryId ?? null) : null,
    p.source === 'all' ? (narrow.search ?? null) : null,
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
      maxPrice: input.maxPrice,
      sort: input.sort === 'new' || input.sort === 'bestsellers' ? input.sort : 'name',
    }).items as unknown as StoreItem[];
  }

  const q = buildStoreItemsQuery(input);
  const rows = await queryRows<Record<string, unknown>>(q.listSql, q.listParams);
  return rows.map(mapStoreItemRow);
}

async function loadCategories(store: StoreBusinessContext): Promise<SectionCategory[]> {
  if (store.is_demo) {
    const { filterDemoCatalog } = await import('@/lib/store/theme-demo');
    return filterDemoCatalog({ pack: store.store_theme?.pack, page: 1, limit: 1 }).categories.map((c) => ({
      id: c.id,
      name: c.name,
      item_count: c.item_count,
      image_url: null,
    }));
  }
  const q = buildStoreItemsQuery({ businessId: store.business_id, limit: 1, offset: 0 });
  const rows = await queryRows<{ id: string; name: string; item_count: number }>(
    q.categorySql,
    q.categoryParams,
  );
  // The categories table has no image column yet.
  return rows.map((r) => ({ id: r.id, name: r.name, item_count: r.item_count, image_url: null }));
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

  for (const [id, req] of requests) {
    if (req.products) {
      const key = productRequestKey(req.products, opts);
      sectionKey.set(id, key);
      if (!productJobs.has(key)) {
        productJobs.set(
          key,
          loadProducts(store, req.products, opts).then(
            (items) => ({ items }),
            (e) => ({ error: message(e) }),
          ),
        );
      }
    }
    if (req.categories && !categoriesJob) {
      categoriesJob = loadCategories(store).then(
        (items) => ({ items }),
        (e) => ({ error: message(e) }),
      );
    }
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
      if (r.error) data.error = data.error ?? r.error;
      else data.categories = r.items;
    }
    result[id] = data;
  }
  return result;
}
