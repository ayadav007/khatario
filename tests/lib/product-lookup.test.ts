import { lookupOpenFacts, lookupProductGuru } from '@/lib/product-lookup/providers';
import {
  FOUND_TTL_MS,
  findConflicts,
  lookupExternalProduct,
  resetProviderSlotsForTests,
  takeProviderSlot,
} from '@/lib/product-lookup/service';
import { cleanLabelDate, cleanLabelReading } from '@/lib/product-lookup/label-reader';
import { emptyScanAddForm, fillFromFacts, nameWithSize, scanAddItemPayload } from '@/lib/items/scan-add-form';
import type { ProductSuggestion } from '@/lib/product-lookup/types';

const CODE = '8901396151005';

function reply(status: number, body: unknown, url = ''): Response {
  return {
    status,
    url,
    json: async () => {
      if (typeof body === 'string') throw new SyntaxError('Unexpected token');
      return body;
    },
  } as unknown as Response;
}

const harpicPG = {
  ean: CODE,
  name: 'harpic',
  brand: 'Harpic',
  category_name: 'Disinfectant Toilet Cleaner',
  quantity: '500 ml',
  verified: true,
  certainty: 65,
  web_url: `https://myproduct.guru/p/${CODE}`,
};

const harpicOF = {
  code: CODE,
  status: 1,
  product: { code: CODE, product_name: 'Harpic Power Plus', brands: 'Harpic,Reckitt', quantity: '500 ml', categories: 'Cleaning,Toilet cleaners', product_type: 'product' },
};

describe('ProductGuru adapter', () => {
  test('normalises a found product with its attribution and provider scores', async () => {
    const r = await lookupProductGuru(CODE, async () => reply(200, harpicPG));
    expect(r).toEqual({
      status: 'found',
      suggestion: expect.objectContaining({
        provider: 'productguru',
        name: 'harpic',
        brand: 'Harpic',
        quantity: '500 ml',
        attribution: 'Data: ProductGuru',
        source_url: `https://myproduct.guru/p/${CODE}`,
        license: 'CC BY 4.0',
        verified: true,
        certainty: 65,
        missing_fields: [],
      }),
    });
  });

  test('sends the app User-Agent and never a key', async () => {
    const fetchMock = jest.fn(async () => reply(404, { error: 'not found' }));
    await lookupProductGuru(CODE, fetchMock);
    const init = (fetchMock.mock.calls[0] as unknown[])[1] as RequestInit;
    expect((init.headers as Record<string, string>)['User-Agent']).toMatch(/^Khatario\//);
    expect(JSON.stringify(init.headers)).not.toMatch(/key|authorization/i);
  });

  test('404 and 410 are not found, 429 is rate limited, bad JSON and timeouts are errors', async () => {
    expect(await lookupProductGuru(CODE, async () => reply(404, {}))).toEqual({ status: 'not_found' });
    expect(await lookupProductGuru(CODE, async () => reply(410, {}))).toEqual({ status: 'not_found' });
    expect(await lookupProductGuru(CODE, async () => reply(429, {}))).toEqual({ status: 'rate_limited' });
    expect((await lookupProductGuru(CODE, async () => reply(200, '<html>'))).status).toBe('error');
    const timeout = Object.assign(new Error('t'), { name: 'TimeoutError' });
    expect(await lookupProductGuru(CODE, async () => { throw timeout; })).toEqual({ status: 'error', message: 'timeout' });
  });

  test('an answer for a different barcode is not this product', async () => {
    expect(await lookupProductGuru(CODE, async () => reply(200, { ...harpicPG, ean: '8901396151006' }))).toEqual({ status: 'not_found' });
  });

  test('incomplete details are reported as missing, not invented', async () => {
    const r = await lookupProductGuru(CODE, async () => reply(200, { ...harpicPG, quantity: null, category_name: 'unknown' }));
    expect(r.status === 'found' && r.suggestion.missing_fields).toEqual(['quantity', 'category']);
    expect(r.status === 'found' && r.suggestion.quantity).toBeNull();
  });
});

describe('Open Facts adapter', () => {
  test('one product_type=all request; the database it redirected to is named', async () => {
    const fetchMock = jest.fn(async (url: string) => reply(200, harpicOF, url.replace('openfoodfacts', 'openproductsfacts')));
    const r = await lookupOpenFacts(CODE, fetchMock);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain('product_type=all');
    expect(r.status === 'found' && r.suggestion).toEqual(
      expect.objectContaining({
        provider: 'openfacts',
        provider_label: 'Open Products Facts',
        brand: 'Harpic',
        category: 'Toilet cleaners',
        license: 'ODbL 1.0',
        source_url: `https://world.openproductsfacts.org/product/${CODE}`,
      })
    );
  });

  test('status 0 is not found; 429 is rate limited', async () => {
    expect(await lookupOpenFacts(CODE, async () => reply(404, { status: 0, status_verbose: 'product not found' }))).toEqual({ status: 'not_found' });
    expect(await lookupOpenFacts(CODE, async () => reply(429, {}))).toEqual({ status: 'rate_limited' });
  });
});

describe('lookup service', () => {
  const suggestion = (over: Partial<ProductSuggestion>): ProductSuggestion =>
    ({ barcode: CODE, provider: 'productguru', name: 'Harpic', brand: 'Harpic', quantity: '500 ml', ...over }) as ProductSuggestion;

  function fakeDb(cached?: { status: string; suggestions: unknown[]; fetched_at: Date }) {
    const writes: unknown[][] = [];
    const q = {
      query: jest.fn(async (sql: string, params: unknown[]) => {
        if (/^\s*SELECT/.test(sql)) return { rows: cached ? [cached] : [] };
        writes.push(params);
        return { rows: [] };
      }),
    };
    return { q: q as any, writes };
  }

  beforeEach(() => resetProviderSlotsForTests());

  test('a complete ProductGuru answer stops there', async () => {
    const fetchMock = jest.fn(async () => reply(200, harpicPG));
    const { q, writes } = fakeDb();
    const r = await lookupExternalProduct(q, 'b1', CODE, { fetchImpl: fetchMock });
    expect(r.status).toBe('found');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(writes[0][0]).toBe('b1');
  });

  test('without a pack size, Open Facts is asked too, and a size disagreement is a conflict', async () => {
    const fetchMock = jest.fn(async (url: string) =>
      url.includes('myproduct.guru')
        ? reply(200, { ...harpicPG, quantity: null })
        : reply(200, { ...harpicOF, product: { ...harpicOF.product, quantity: '200 ml' } }, url)
    );
    const r = await lookupExternalProduct(fakeDb().q, 'b1', CODE, { fetchImpl: fetchMock });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(r.suggestions.map((s) => s.provider)).toEqual(['productguru', 'openfacts']);
    // Only one provider gave a size, so there is nothing to disagree on.
    expect(r.conflicts.find((c) => c.field === 'quantity')).toBeUndefined();

    const both = await lookupExternalProduct(fakeDb().q, 'b1', CODE, {
      fetchImpl: async (url: string) =>
        url.includes('myproduct.guru')
          ? reply(200, { ...harpicPG, brand: null })
          : reply(200, { ...harpicOF, product: { ...harpicOF.product, quantity: '300 ml' } }, url),
    });
    expect(both.conflicts).toContainEqual({ field: 'quantity', values: ['500 ml', '300 ml'] });
  });

  test('nobody knows it → not_found is cached', async () => {
    const { q, writes } = fakeDb();
    const r = await lookupExternalProduct(q, 'b1', CODE, { fetchImpl: async () => reply(404, { status: 0 }) });
    expect(r.status).toBe('not_found');
    expect(writes[0][2]).toBe('not_found');
  });

  test('a provider failure with no answer is unavailable and not cached', async () => {
    const { q, writes } = fakeDb();
    const r = await lookupExternalProduct(q, 'b1', CODE, { fetchImpl: async () => reply(500, {}) });
    expect(r.status).toBe('unavailable');
    expect(writes).toHaveLength(0);
  });

  test('a fresh cache answer is used without calling anyone; an old one is refreshed', async () => {
    const fetchMock = jest.fn(async () => reply(200, harpicPG));
    const now = Date.now();
    const fresh = fakeDb({ status: 'found', suggestions: [suggestion({})], fetched_at: new Date(now - 1000) });
    expect((await lookupExternalProduct(fresh.q, 'b1', CODE, { fetchImpl: fetchMock, now })).cached).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();

    const stale = fakeDb({ status: 'found', suggestions: [suggestion({})], fetched_at: new Date(now - FOUND_TTL_MS - 1000) });
    expect((await lookupExternalProduct(stale.q, 'b1', CODE, { fetchImpl: fetchMock, now })).cached).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('the per-minute budget stops calls before the provider limit', () => {
    const t = 1_000_000;
    for (let i = 0; i < 12; i++) expect(takeProviderSlot('openfacts', t)).toBe(true);
    expect(takeProviderSlot('openfacts', t)).toBe(false);
    expect(takeProviderSlot('openfacts', t + 61_000)).toBe(true);
  });

  test('sizes written differently are the same; different sizes conflict', () => {
    expect(findConflicts([suggestion({ quantity: '500 ml' }), suggestion({ provider: 'openfacts', quantity: '500ML' })])).toEqual([]);
    expect(findConflicts([suggestion({ quantity: '300 ml' }), suggestion({ provider: 'openfacts', quantity: '200 ml' })])).toEqual([
      { field: 'quantity', values: ['300 ml', '200 ml'] },
    ]);
  });
});

describe('label reading cleanup', () => {
  test('keeps only what the step asks for, in valid shapes', () => {
    const raw = { name: 'Parle-G', brand: 'Parle', size: '100 g', mrp: 10, batch_number: 'B12', expiry_date: '2027-02-30', manufacturing_date: '2026-09' };
    expect(cleanLabelReading(raw, 'front')).toEqual(expect.objectContaining({ name: 'Parle-G', brand: 'Parle', size: '100 g', mrp: null, batch_number: null }));
    expect(cleanLabelReading(raw, 'details')).toEqual(
      expect.objectContaining({ name: null, mrp: 10, batch_number: 'B12', expiry_date: null, manufacturing_date: '2026-09' })
    );
    expect(cleanLabelReading({ mrp: -5 }, 'details').mrp).toBeNull();
    expect(cleanLabelReading('not json', 'size')).toEqual(expect.objectContaining({ size: null }));
  });

  test('dates are accepted only as real YYYY-MM-DD or YYYY-MM', () => {
    expect(cleanLabelDate('2027-03-31')).toBe('2027-03-31');
    expect(cleanLabelDate('2027-03')).toBe('2027-03');
    expect(cleanLabelDate('2027-13')).toBeNull();
    expect(cleanLabelDate('31/03/2027')).toBeNull();
    expect(cleanLabelDate('9 months from mfg')).toBeNull();
  });
});

describe('filling the form', () => {
  const blank = emptyScanAddForm(CODE);

  test('suggestions fill empty fields with the size in the name', () => {
    const f = fillFromFacts(blank, { name: 'harpic', brand: 'Harpic', quantity: '500 ml' });
    expect(f).toEqual(expect.objectContaining({ name: 'Harpic 500 ml', brand: 'Harpic', size: '500 ml' }));
  });

  test('what the shopkeeper typed is never overwritten', () => {
    const typed = { ...blank, name: 'Harpic Blue 500 ml', size: '500 ml', mrp: '99' };
    expect(fillFromFacts(typed, { name: 'harpic', quantity: '200 ml', mrp: 120 })).toEqual(expect.objectContaining({ name: 'Harpic Blue 500 ml', size: '500 ml', mrp: '99' }));
  });

  test('a disputed size stays blank', () => {
    const f = fillFromFacts(blank, { name: 'Harpic', quantity: '300 ml' }, { sizeInDoubt: true });
    expect(f.size).toBe('');
    expect(f.name).toBe('Harpic');
  });

  test('size from a later photo joins the name once', () => {
    const named = fillFromFacts(blank, { name: 'Parle-G Biscuits' });
    expect(fillFromFacts(named, { quantity: '75 g' }).name).toBe('Parle-G Biscuits 75 g');
    expect(nameWithSize('Parle-G 75g', '75 g')).toBe('Parle-G 75g');
  });

  test('the accepted provider goes in the payload as a name only', () => {
    expect(scanAddItemPayload({ ...blank, name: 'Harpic 500 ml' }, 'productguru').lookup_source).toBe('productguru');
    expect(scanAddItemPayload({ ...blank, name: 'Harpic 500 ml' }).lookup_source).toBeUndefined();
  });
});
