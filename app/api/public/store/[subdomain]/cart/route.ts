import { NextRequest, NextResponse } from 'next/server';
import { queryRows } from '@/lib/db';
import { resolveStoreBySubdomain } from '@/lib/store/resolve-store';
import { readStoreCustomer, STORE_CUSTOMER_COOKIE } from '@/lib/store/customer-session';
import { CART_MAX_LINES, CartError, readCart, saveCart, type CartLine } from '@/lib/store/abandoned-carts';

export const dynamic = 'force-dynamic';

/**
 * The signed-in shopper's saved cart (spec 2026-10-29-store-shopping-features §7.3). The client
 * sends only item, variant and quantity; price, name and image are read here from the catalogue.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type CatalogRow = {
  item_id: string;
  variant_id: string | null;
  item_name: string;
  variant_name: string | null;
  item_price: string;
  variant_price: string | null;
  image_url: string | null;
  unit: string | null;
  stock: string;
};

async function sessionFor(request: NextRequest, subdomain: string) {
  const store = await resolveStoreBySubdomain(subdomain);
  if (!store) return { error: NextResponse.json({ error: 'Store not found' }, { status: 404 }) };
  if (store.is_demo) return { demo: true as const };
  const session = readStoreCustomer(request.cookies.get(STORE_CUSTOMER_COOKIE)?.value);
  if (!session || session.businessId !== store.business_id) {
    return { error: NextResponse.json({ error: 'Sign in required' }, { status: 401 }) };
  }
  return { store, session };
}

const keyOf = (itemId: string, variantId: string | null) => `${itemId}:${variantId ?? ''}`;

/** Visible items (and their variants) of this business, keyed by item and variant. */
async function catalogFor(businessId: string, lines: { item_id: string; variant_id: string | null }[]) {
  const itemIds = [...new Set(lines.map((l) => l.item_id))];
  const variantIds = [...new Set(lines.map((l) => l.variant_id).filter((v): v is string => !!v))];
  if (!itemIds.length) return new Map<string, CatalogRow>();
  const rows = await queryRows<CatalogRow>(
    `SELECT i.id AS item_id, v.id AS variant_id, i.name AS item_name, v.variant_name,
            i.selling_price::text AS item_price, v.selling_price::text AS variant_price,
            i.image_url, i.unit,
            COALESCE(CASE WHEN v.id IS NULL THEN i.current_stock ELSE v.current_stock END, 0)::text AS stock
       FROM items i
       LEFT JOIN item_variants v ON v.item_id = i.id AND v.id = ANY($3::uuid[])
      WHERE i.business_id = $1 AND i.id = ANY($2::uuid[])
        AND i.show_in_store = true
        AND (i.is_active IS NULL OR i.is_active = true)
        AND i.deleted_at IS NULL`,
    [businessId, itemIds, variantIds],
  );
  const out = new Map<string, CatalogRow>();
  for (const r of rows) {
    out.set(keyOf(r.item_id, r.variant_id), r);
    // The plain item is always addressable, even when the query also joined a variant row.
    if (r.variant_id) out.set(keyOf(r.item_id, null), { ...r, variant_id: null, variant_name: null, variant_price: null });
  }
  return out;
}

/** Same price rule as the checkout quote: the variant's price when set, else the item's. */
function priceOf(r: CatalogRow): number {
  const item = parseFloat(r.item_price) || 0;
  return r.variant_id ? parseFloat(r.variant_price ?? '') || item : item;
}

export async function GET(request: NextRequest, { params }: { params: { subdomain: string } }) {
  const scoped = await sessionFor(request, params.subdomain);
  if ('demo' in scoped) return NextResponse.json({ lines: [] });
  if ('error' in scoped) return scoped.error;
  const saved = await readCart(scoped.store.business_id, scoped.session.customerId);
  const catalog = await catalogFor(scoped.store.business_id, saved);
  // Lines no longer in the store are left out; unit, stock and the split name help the storefront.
  const lines = saved.flatMap((l) => {
    const r = catalog.get(keyOf(l.item_id, l.variant_id ?? null));
    if (!r) return [];
    return [
      {
        ...l,
        item_name: r.item_name,
        variant_name: r.variant_name,
        unit: r.unit || 'PCS',
        stock: parseFloat(r.stock) || 0,
      },
    ];
  });
  return NextResponse.json({ lines });
}

export async function PUT(request: NextRequest, { params }: { params: { subdomain: string } }) {
  const scoped = await sessionFor(request, params.subdomain);
  if ('demo' in scoped) return NextResponse.json({ ok: true });
  if ('error' in scoped) return scoped.error;

  const body = (await request.json().catch(() => null)) as { lines?: unknown } | null;
  const raw = body && typeof body === 'object' ? body.lines : undefined;
  if (!Array.isArray(raw)) return NextResponse.json({ error: 'lines must be a list' }, { status: 400 });
  if (raw.length > CART_MAX_LINES) {
    return NextResponse.json({ error: new CartError('too_many_lines').message }, { status: 400 });
  }

  const wanted: { item_id: string; variant_id: string | null; quantity: number }[] = [];
  for (const l of raw) {
    if (!l || typeof l !== 'object') return NextResponse.json({ error: new CartError('bad_line').message }, { status: 400 });
    const { item_id, variant_id, quantity } = l as Record<string, unknown>;
    const variant = variant_id ?? null;
    // A malformed id can never match the catalogue; drop it like an unknown item.
    if (typeof item_id !== 'string' || !UUID.test(item_id)) continue;
    if (variant !== null && (typeof variant !== 'string' || !UUID.test(variant))) continue;
    wanted.push({ item_id, variant_id: variant as string | null, quantity: quantity as number });
  }

  const catalog = await catalogFor(scoped.store.business_id, wanted);
  const seen = new Set<string>();
  const lines: CartLine[] = [];
  for (const w of wanted) {
    const k = keyOf(w.item_id, w.variant_id);
    const r = catalog.get(k);
    if (!r || seen.has(k)) continue;
    seen.add(k);
    lines.push({
      item_id: w.item_id,
      variant_id: w.variant_id,
      quantity: w.quantity,
      price: priceOf(r),
      name: r.variant_name ? `${r.item_name} – ${r.variant_name}` : r.item_name,
      image_url: r.image_url ?? null,
    });
  }

  try {
    await saveCart(scoped.store.business_id, scoped.session.customerId, lines);
  } catch (err) {
    if (err instanceof CartError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }
  return NextResponse.json({ ok: true });
}
