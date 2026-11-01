import type { StoreBusinessContext } from '@/lib/store/resolve-store';
import { first, loadEnginePage, type EnginePage, type HomeSearchParams } from './page-loader';

export type { HomeSearchParams };
export type EngineHome = EnginePage;

/** The `disc` steps the classic catalog accepts (lib/store/query-params.ts). */
const DISCOUNT_STEPS = [10, 25, 50];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The engine theme and section data for the home page, or null to render the old catalog.
 * Delegates to the page loader; see its failure contract.
 */
export async function loadEngineHome(
  store: StoreBusinessContext,
  searchParams: HomeSearchParams,
): Promise<EngineHome | null> {
  // A malformed category id would fail the query and hide the grid, so it is ignored instead.
  const cat = first(searchParams.cat);
  const q = first(searchParams.q)?.trim().slice(0, 100) || null;
  // `disc` (the Offers links' `/catalog?disc=10`, redirected here when the catalog template is empty)
  // narrows the all-products grids to discounted products, as the classic catalog does.
  const disc = Number(first(searchParams.disc));
  return loadEnginePage(store, searchParams, 'home', {
    categoryId: cat && UUID.test(cat) ? cat : null,
    search: q,
    minDiscountPct: DISCOUNT_STEPS.includes(disc) ? disc : null,
  });
}
