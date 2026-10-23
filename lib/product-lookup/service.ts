import type { PoolClient } from 'pg';
import { lookupOpenFacts, lookupProductGuru } from '@/lib/product-lookup/providers';
import type {
  FetchLike,
  ProductLookupResult,
  ProductProviderId,
  ProductSuggestion,
  ProviderResult,
} from '@/lib/product-lookup/types';

type Queryable = Pick<PoolClient, 'query'>;

const DAY_MS = 24 * 60 * 60 * 1000;
/** How long a cached answer is used before the providers are asked again. */
export const FOUND_TTL_MS = 30 * DAY_MS;
export const NOT_FOUND_TTL_MS = 7 * DAY_MS;

/**
 * Requests per minute this server sends to each provider, below their published per-IP limits
 * (ProductGuru 60, Open Food Facts 15). Every shop on this server shares the budget.
 */
const PER_MINUTE: Record<ProductProviderId, number> = { productguru: 50, openfacts: 12 };
const sent: Record<ProductProviderId, number[]> = { productguru: [], openfacts: [] };

export function takeProviderSlot(provider: ProductProviderId, now = Date.now()): boolean {
  const window = sent[provider].filter((t) => now - t < 60_000);
  if (window.length >= PER_MINUTE[provider]) {
    sent[provider] = window;
    return false;
  }
  window.push(now);
  sent[provider] = window;
  return true;
}

export function resetProviderSlotsForTests(): void {
  sent.productguru = [];
  sent.openfacts = [];
}

const comparable = (v: string) => v.toLowerCase().replace(/[^a-z0-9.]/g, '');

/** Fields where the providers that answered disagree. A 300 ml and a 200 ml answer must never be merged. */
export function findConflicts(suggestions: ProductSuggestion[]): ProductLookupResult['conflicts'] {
  const conflicts: ProductLookupResult['conflicts'] = [];
  for (const field of ['name', 'brand', 'quantity'] as const) {
    const values = suggestions.map((s) => s[field]).filter((v): v is string => !!v);
    const distinct = [...new Map(values.map((v) => [comparable(v), v])).values()];
    if (distinct.length > 1) conflicts.push({ field, values: distinct });
  }
  return conflicts;
}

/** Name, brand and pack size are what a shopkeeper needs; with all three, the next provider is not asked. */
const isComplete = (s: ProductSuggestion) => !!s.name && !!s.brand && !!s.quantity;

type ProviderCall = (barcode: string, fetchImpl: FetchLike) => Promise<ProviderResult>;
const PROVIDERS: Array<{ id: ProductProviderId; call: ProviderCall }> = [
  // ProductGuru first: its limit is four times higher and it already merges several open sources.
  { id: 'productguru', call: lookupProductGuru },
  { id: 'openfacts', call: lookupOpenFacts },
];

async function askProviders(barcode: string, fetchImpl: FetchLike) {
  const suggestions: ProductSuggestion[] = [];
  let unanswered = 0;
  for (const provider of PROVIDERS) {
    if (suggestions.some(isComplete)) break;
    if (!takeProviderSlot(provider.id)) {
      unanswered++;
      continue;
    }
    const result = await provider.call(barcode, fetchImpl);
    if (result.status === 'found') suggestions.push(result.suggestion);
    else if (result.status !== 'not_found') {
      unanswered++;
      console.warn(`[product-lookup] ${provider.id} ${result.status}${result.status === 'error' ? `: ${result.message}` : ''}`);
    }
  }
  return { suggestions, unanswered };
}

/**
 * Suggestions for a barcode the shop does not have yet. Uses this business's cache first.
 * `unavailable` means no provider answered and nothing was cached; the shopkeeper adds the item by hand.
 */
export async function lookupExternalProduct(
  q: Queryable,
  businessId: string,
  barcode: string,
  opts: { fetchImpl?: FetchLike; now?: number } = {}
): Promise<ProductLookupResult> {
  const now = opts.now ?? Date.now();
  const cached = (
    await q.query<{ status: 'found' | 'not_found'; suggestions: ProductSuggestion[]; fetched_at: Date }>(
      `SELECT status, suggestions, fetched_at FROM product_lookup_cache WHERE business_id = $1 AND barcode = $2`,
      [businessId, barcode]
    )
  ).rows[0];
  if (cached) {
    const age = now - new Date(cached.fetched_at).getTime();
    if (age < (cached.status === 'found' ? FOUND_TTL_MS : NOT_FOUND_TTL_MS)) {
      const suggestions = Array.isArray(cached.suggestions) ? cached.suggestions : [];
      return { barcode, status: cached.status, suggestions, conflicts: findConflicts(suggestions), cached: true };
    }
  }

  const { suggestions, unanswered } = await askProviders(barcode, opts.fetchImpl ?? fetch);
  if (suggestions.length === 0 && unanswered > 0) {
    // A provider was down or busy, so "not found" would be a guess. Nothing is cached.
    return { barcode, status: 'unavailable', suggestions: [], conflicts: [], cached: false };
  }

  const status = suggestions.length > 0 ? 'found' : 'not_found';
  await q.query(
    `INSERT INTO product_lookup_cache (business_id, barcode, status, suggestions, fetched_at)
     VALUES ($1, $2, $3, $4::jsonb, to_timestamp($5 / 1000.0))
     ON CONFLICT (business_id, barcode) DO UPDATE
       SET status = EXCLUDED.status, suggestions = EXCLUDED.suggestions, fetched_at = EXCLUDED.fetched_at`,
    [businessId, barcode, status, JSON.stringify(suggestions), now]
  );
  return { barcode, status, suggestions, conflicts: findConflicts(suggestions), cached: false };
}

/**
 * Where an accepted suggestion came from, read from this business's own cache so the client
 * cannot claim a source. Null when the cache has no answer from that provider for this barcode.
 */
export async function externalSourceFromCache(
  q: Queryable,
  businessId: string,
  barcode: string,
  provider: string
): Promise<Record<string, unknown> | null> {
  const row = (
    await q.query<{ suggestions: ProductSuggestion[]; fetched_at: Date }>(
      `SELECT suggestions, fetched_at FROM product_lookup_cache
        WHERE business_id = $1 AND barcode = $2 AND status = 'found'`,
      [businessId, barcode]
    )
  ).rows[0];
  const s = row && Array.isArray(row.suggestions) ? row.suggestions.find((x) => x.provider === provider) : undefined;
  if (!s) return null;
  return {
    provider: s.provider,
    provider_label: s.provider_label,
    source_url: s.source_url,
    license: s.license,
    attribution: s.attribution,
    fetched_at: new Date(row.fetched_at).toISOString(),
  };
}
