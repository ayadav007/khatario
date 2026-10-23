import type { FetchLike, ProductSuggestion, ProviderResult } from '@/lib/product-lookup/types';

/** Open Food Facts asks every app to name itself and give a contact. */
export const LOOKUP_USER_AGENT = 'Khatario/1.0 (help@khatario.com)';
const TIMEOUT_MS = 6000;

const text = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t && t.toLowerCase() !== 'unknown' ? t : null;
};

function missingFields(s: Pick<ProductSuggestion, 'name' | 'brand' | 'quantity' | 'category'>) {
  return (['name', 'brand', 'quantity', 'category'] as const).filter((f) => !s[f]);
}

async function getJson(fetchImpl: FetchLike, url: string): Promise<{ status: number; body: unknown; finalUrl: string }> {
  const res = await fetchImpl(url, {
    headers: { 'User-Agent': LOOKUP_USER_AGENT, Accept: 'application/json' },
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body, finalUrl: res.url || url };
}

function failure(e: unknown): ProviderResult {
  const name = e instanceof Error ? e.name : '';
  return { status: 'error', message: name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'request failed' };
}

/**
 * ProductGuru barcode lookup: GET https://myproduct.guru/lookup/{barcode}.json
 * No key; 60 requests a minute per IP; 404 for an unknown barcode, 410 for products it will not serve.
 * Licence: factual data, CC BY 4.0, shown as "Data: ProductGuru" with a link.
 */
export async function lookupProductGuru(barcode: string, fetchImpl: FetchLike = fetch): Promise<ProviderResult> {
  try {
    const { status, body } = await getJson(fetchImpl, `https://myproduct.guru/lookup/${encodeURIComponent(barcode)}.json`);
    if (status === 404 || status === 410) return { status: 'not_found' };
    if (status === 429) return { status: 'rate_limited' };
    if (status !== 200 || !body || typeof body !== 'object') return { status: 'error', message: `HTTP ${status}` };
    const b = body as Record<string, unknown>;
    // Answers for another code would be a different product.
    if (text(b.ean) && text(b.ean) !== barcode) return { status: 'not_found' };
    const core = {
      name: text(b.name),
      brand: text(b.brand),
      quantity: text(b.quantity),
      category: text(b.category_name),
    };
    if (!core.name && !core.brand) return { status: 'not_found' };
    return {
      status: 'found',
      suggestion: {
        barcode,
        provider: 'productguru',
        provider_label: 'ProductGuru',
        ...core,
        image_url: null,
        source_url: text(b.web_url) ?? 'https://myproduct.guru',
        license: 'CC BY 4.0',
        attribution: 'Data: ProductGuru',
        verified: typeof b.verified === 'boolean' ? b.verified : null,
        certainty: typeof b.certainty === 'number' ? b.certainty : null,
        missing_fields: missingFields(core),
      },
    };
  } catch (e) {
    return failure(e);
  }
}

const OPEN_FACTS_LABELS: Record<string, { label: string; host: string }> = {
  food: { label: 'Open Food Facts', host: 'world.openfoodfacts.org' },
  beauty: { label: 'Open Beauty Facts', host: 'world.openbeautyfacts.org' },
  petfood: { label: 'Open Pet Food Facts', host: 'world.openpetfoodfacts.org' },
  product: { label: 'Open Products Facts', host: 'world.openproductsfacts.org' },
};

const OPEN_FACTS_FIELDS = 'code,product_name,product_name_en,brands,quantity,categories,image_front_url,product_type';

/**
 * Open Food Facts and its sister databases (beauty, pet food, other products).
 * `product_type=all` on the food host redirects to whichever database holds the barcode, so one
 * request covers all four. Product reads are limited to 15 a minute per IP.
 * Licence: ODbL 1.0 for the database, CC BY-SA for images.
 */
export async function lookupOpenFacts(barcode: string, fetchImpl: FetchLike = fetch): Promise<ProviderResult> {
  try {
    const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json?product_type=all&fields=${OPEN_FACTS_FIELDS}`;
    const { status, body, finalUrl } = await getJson(fetchImpl, url);
    if (status === 429) return { status: 'rate_limited' };
    const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    if (status === 404 || b.status === 0) return { status: 'not_found' };
    if (status !== 200 || b.status !== 1 || !b.product || typeof b.product !== 'object') {
      return { status: 'error', message: `HTTP ${status}` };
    }
    const p = b.product as Record<string, unknown>;
    if (text(p.code) && text(p.code) !== barcode) return { status: 'not_found' };
    const type = text(p.product_type) ?? Object.keys(OPEN_FACTS_LABELS).find((k) => finalUrl.includes(OPEN_FACTS_LABELS[k].host)) ?? 'food';
    const flavour = OPEN_FACTS_LABELS[type] ?? OPEN_FACTS_LABELS.food;
    const categories = text(p.categories);
    const core = {
      name: text(p.product_name) ?? text(p.product_name_en),
      brand: text(p.brands)?.split(',')[0]?.trim() || null,
      quantity: text(p.quantity),
      category: categories ? categories.split(',').pop()!.trim() : null,
    };
    if (!core.name && !core.brand) return { status: 'not_found' };
    return {
      status: 'found',
      suggestion: {
        barcode,
        provider: 'openfacts',
        provider_label: flavour.label,
        ...core,
        image_url: text(p.image_front_url),
        source_url: `https://${flavour.host}/product/${encodeURIComponent(barcode)}`,
        license: 'ODbL 1.0',
        attribution: `Data: ${flavour.label} (ODbL)`,
        verified: null,
        certainty: null,
        missing_fields: missingFields(core),
      },
    };
  } catch (e) {
    return failure(e);
  }
}
