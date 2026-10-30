import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { currentStoreForPreview } from '@/lib/store/current-store';
import type { StoreBusinessContext } from '@/lib/store/resolve-store';
import { catalogRedirect } from '@/lib/store/engine/links';
import {
  first,
  hasEnabledSection,
  loadEnginePage,
  searchString,
  type HomeSearchParams,
} from '@/lib/store/engine/page-loader';
import { catalogCategoryName } from '@/lib/store/engine/section-data';
import { RenderTemplate } from './RenderTemplate';

/** Ids longer than this are never one of the store's categories, so they are not looked up. */
const MAX_CATEGORY_ID = 64;

/** The category's name, null when the store shows no such category, undefined when the lookup failed. */
async function categoryName(store: StoreBusinessContext, categoryId: string): Promise<string | null | undefined> {
  if (categoryId.length > MAX_CATEGORY_ID) return null;
  try {
    return await catalogCategoryName(store, categoryId);
  } catch (e) {
    console.error('[store engine] catalog category', store.store_subdomain, e instanceof Error ? e.message : e);
    return undefined;
  }
}

/**
 * The body of `/catalog` and `/catalog/[category]` (D14). A store without the engine, or whose catalog
 * template is empty (D15), goes to the home page with `cat` and the rest of the query; an unknown
 * category is a 404; anything else renders the theme's catalog template locked to the route's category.
 */
export async function EngineCatalogPage({
  searchParams,
  categoryId,
}: {
  searchParams: HomeSearchParams;
  categoryId: string | null;
}) {
  // A store that is not launched yet resolves only for a verified theme preview (D10)...
  const resolved = await currentStoreForPreview(first(searchParams.preview_theme), first(searchParams.pt));
  const store = resolved?.store ?? null;
  const engine = store ? await loadEnginePage(store, searchParams, 'catalog') : null;
  // ...and then renders only that preview, never as a normal storefront.
  if (resolved?.offline && !engine?.preview) notFound();

  if (!store || !engine || !hasEnabledSection(engine.template)) {
    const path = categoryId ? `/catalog/${encodeURIComponent(categoryId)}` : '/catalog';
    redirect(catalogRedirect(false, path, searchString(searchParams)) ?? '/');
  }

  let name: string | undefined;
  if (categoryId) {
    const found = await categoryName(store, categoryId);
    if (found === null) notFound();
    name = found;
  }

  return (
    <RenderTemplate
      store={store}
      theme={engine.theme}
      templateKey="catalog"
      data={engine.data}
      preview={engine.preview}
      editor={engine.editor}
      route={categoryId ? { categoryId, categoryName: name } : {}}
    />
  );
}

/** `<category name> | <store name>`, or `All products | <store name>`. */
export async function engineCatalogMetadata(
  searchParams: HomeSearchParams,
  categoryId: string | null,
): Promise<Metadata> {
  const resolved = await currentStoreForPreview(first(searchParams.preview_theme), first(searchParams.pt));
  const store = resolved?.store;
  if (!store) return { title: 'All products' };
  const name = categoryId ? await categoryName(store, categoryId) : null;
  // Absolute: the store layout's title template would add the store name a second time.
  return { title: { absolute: `${name || 'All products'} | ${store.name}` } };
}
