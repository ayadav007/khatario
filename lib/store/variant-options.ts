// Variant option axes (colour / size / ...) for the store product page.
// Most merchants only set variant_name, so that becomes a single "Option" axis.

export type StoreVariant = {
  id: string;
  variant_name: string;
  selling_price: number | null;
  current_stock: number;
  attributes?: Record<string, string> | null;
};

/** Raw shape from the public items API: numbers may arrive as numeric strings. */
export type StoreVariantInput = Omit<StoreVariant, 'selling_price' | 'current_stock'> & {
  selling_price: number | string | null;
  current_stock: number | string | null;
};

export type VariantAxis = {
  key: string;
  label: string;
  values: { value: string; inStock: boolean; swatch: string | null }[];
};

const OPTION_KEY = 'option';

const NAMED_COLOURS: Record<string, string> = {
  black: '#000000',
  white: '#ffffff',
  'off white': '#faf9f6',
  red: '#e53935',
  blue: '#1e66d0',
  green: '#2e7d32',
  yellow: '#fdd835',
  orange: '#fb8c00',
  pink: '#f48fb1',
  purple: '#7b1fa2',
  brown: '#6d4c41',
  grey: '#9e9e9e',
  gray: '#9e9e9e',
  silver: '#c0c0c0',
  gold: '#d4af37',
  maroon: '#800000',
  peach: '#ffcba4',
  mustard: '#e1ad01',
  navy: '#1a2a5e',
  cream: '#fffdd0',
  beige: '#e8dcc4',
  rust: '#b7410e',
  olive: '#808000',
  teal: '#008080',
  magenta: '#c2185b',
  wine: '#722f37',
  mint: '#98ff98',
  lavender: '#b497d6',
  skin: '#e8b998',
  charcoal: '#36454f',
};

export function swatchColor(value: string): string | null {
  const v = String(value ?? '').trim();
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)) return v;
  return NAMED_COLOURS[v.toLowerCase().replace(/\s+/g, ' ')] ?? null;
}

function normKey(raw: string): string {
  const k = raw.trim().toLowerCase();
  return k === 'color' ? 'colour' : k;
}

function titleCase(key: string): string {
  return key.replace(/\b\w/g, (c) => c.toUpperCase());
}

function labelFor(key: string): string {
  return key === OPTION_KEY ? 'Option' : titleCase(key);
}

function stockOf(v: { current_stock: unknown }): number {
  const n = Number(v.current_stock ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** Normalised attribute map of one variant (empty values dropped). */
function attrsOf(v: StoreVariantInput): Record<string, string> {
  const out: Record<string, string> = {};
  const a = v.attributes;
  if (!a || typeof a !== 'object') return out;
  for (const [k, raw] of Object.entries(a)) {
    const key = normKey(String(k));
    const val = raw == null ? '' : String(raw).trim();
    if (key && val && !(key in out)) out[key] = val;
  }
  return out;
}

type Model = { keys: string[]; valueOf: (v: StoreVariantInput, key: string) => string | undefined };

/** Unique label per variant so duplicate or blank names stay selectable. */
function optionLabels(variants: StoreVariantInput[]): Map<StoreVariantInput, string> {
  const labels = new Map<StoreVariantInput, string>();
  const used = new Map<string, number>();
  let blanks = 0;
  for (const v of variants) {
    const name = String(v.variant_name ?? '').trim();
    const base = name || `Option ${++blanks}`;
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    labels.set(v, n === 1 ? base : `${base} (${n})`);
  }
  return labels;
}

function buildModel(variants: StoreVariantInput[]): Model {
  const maps = variants.map(attrsOf);
  const useAttrs = variants.length > 0 && maps.every((m) => Object.keys(m).length > 0);
  if (!useAttrs) {
    const labels = optionLabels(variants);
    return {
      keys: variants.length > 0 ? [OPTION_KEY] : [],
      valueOf: (v) => labels.get(v),
    };
  }
  const seen: string[] = [];
  for (const m of maps) for (const k of Object.keys(m)) if (!seen.includes(k)) seen.push(k);
  const keys = [
    ...['colour', 'size'].filter((k) => seen.includes(k)),
    ...seen.filter((k) => k !== 'colour' && k !== 'size'),
  ];
  const byVariant = new Map<StoreVariantInput, Record<string, string>>();
  variants.forEach((v, i) => byVariant.set(v, maps[i]));
  return { keys, valueOf: (v, key) => byVariant.get(v)?.[key] };
}

function axisValues(variants: StoreVariantInput[], model: Model, key: string): string[] {
  const out: string[] = [];
  for (const v of variants) {
    const val = model.valueOf(v, key);
    if (val !== undefined && !out.includes(val)) out.push(val);
  }
  return out;
}

export function variantOptions(variants: StoreVariantInput[]): VariantAxis[] {
  const model = buildModel(variants);
  return model.keys.map((key) => ({
    key,
    label: labelFor(key),
    values: axisValues(variants, model, key).map((value) => ({
      value,
      inStock: variants.some((v) => model.valueOf(v, key) === value && stockOf(v) > 0),
      swatch: key === 'colour' ? swatchColor(value) : null,
    })),
  }));
}

function normSelection(selection: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(selection ?? {})) {
    const key = normKey(k);
    const s = String(val ?? '').trim();
    if (key && s) out[key] = s;
  }
  return out;
}

function matches(v: StoreVariantInput, model: Model, sel: Record<string, string>): boolean {
  return Object.entries(sel).every(([k, val]) => model.valueOf(v, k) === val);
}

function normalise(v: StoreVariantInput): StoreVariant {
  const price = v.selling_price == null || v.selling_price === '' ? null : Number(v.selling_price);
  return {
    ...v,
    selling_price: price != null && Number.isFinite(price) ? price : null,
    current_stock: stockOf(v),
  };
}

export function resolveVariant(
  variants: StoreVariantInput[],
  selection: Record<string, string>,
): StoreVariant | null {
  const model = buildModel(variants);
  const sel = normSelection(selection);
  if (Object.keys(sel).length === 0) return null;
  const found = variants.filter((v) => matches(v, model, sel));
  const pick = found.find((v) => stockOf(v) > 0) ?? found[0];
  return pick ? normalise(pick) : null;
}

export function nextSelection(
  variants: StoreVariantInput[],
  selection: Record<string, string>,
  key: string,
  value: string,
): Record<string, string> {
  const model = buildModel(variants);
  const k = normKey(key);
  const chosen: Record<string, string> = {};
  for (const [ck, cv] of Object.entries({ ...normSelection(selection), [k]: String(value).trim() })) {
    if (model.keys.includes(ck)) chosen[ck] = cv;
  }

  // Like Shopify: an existing combination is kept even when it is sold out.
  if (variants.some((v) => matches(v, model, chosen))) return chosen;

  // No such combination: keep the new choice and re-pick every other axis to
  // something compatible, in stock first.
  const constraint: Record<string, string> = { [k]: chosen[k] };
  const result: Record<string, string> = { [k]: chosen[k] };
  for (const axis of model.keys) {
    if (axis === k) continue;
    const compatible = variants.filter((v) => matches(v, model, constraint));
    const inStockVals = axisValues(compatible.filter((v) => stockOf(v) > 0), model, axis);
    const anyVals = axisValues(compatible, model, axis);
    const current = chosen[axis];
    const pick =
      current && inStockVals.includes(current)
        ? current
        : inStockVals[0] ?? anyVals[0] ?? current;
    if (pick !== undefined) {
      result[axis] = pick;
      constraint[axis] = pick;
    }
  }
  return result;
}
