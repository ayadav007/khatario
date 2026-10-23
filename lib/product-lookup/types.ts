/** Outside product databases Scan & Add asks about a barcode. */
export type ProductProviderId = 'productguru' | 'openfacts';

/** One provider's answer, in Khatario's own shape. Nothing here is trusted until the shopkeeper confirms it. */
export interface ProductSuggestion {
  barcode: string;
  provider: ProductProviderId;
  /** Which database actually held it, e.g. "Open Products Facts". */
  provider_label: string;
  name: string | null;
  brand: string | null;
  /** Pack size exactly as the provider wrote it, e.g. "500 ml". */
  quantity: string | null;
  category: string | null;
  image_url: string | null;
  source_url: string | null;
  license: string;
  /** Text to show next to the data, with source_url as the link. */
  attribution: string;
  /** Provider's own flags. `certainty` is ProductGuru's 0-100 score, not a probability. */
  verified: boolean | null;
  certainty: number | null;
  missing_fields: Array<'name' | 'brand' | 'quantity' | 'category'>;
}

export type ProviderResult =
  | { status: 'found'; suggestion: ProductSuggestion }
  | { status: 'not_found' }
  | { status: 'rate_limited' }
  | { status: 'error'; message: string };

export interface ProductLookupResult {
  barcode: string;
  status: 'found' | 'not_found' | 'unavailable';
  suggestions: ProductSuggestion[];
  /** Fields where providers disagree, e.g. two different pack sizes. Shown to the shopkeeper, never auto-picked. */
  conflicts: Array<{ field: 'name' | 'brand' | 'quantity'; values: string[] }>;
  /** True when the answer came from this business's cache. */
  cached: boolean;
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
