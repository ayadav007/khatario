import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { Item } from '@/types/database';
import { checkLimit } from '@/lib/subscription';
import { validateBarcode, normalizeBarcode } from '@/lib/barcode-validator';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { validateBundleComponentItems } from '@/lib/bundle-items-validation';

type BundleComponentInput = { item_id: string; quantity: number | string };

/**
 * POST /api/items/bundle
 * Create a bundle (combo) item: parent item row + bundle_items lines.
 * Body: same item fields as POST /api/items, plus bundle_components: [{ item_id, quantity }]
 */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const business_id = getBusinessIdFromRequest(request, body);
  const {
    name,
    code,
    barcode,
    barcode_type,
    unit = 'PCS',
    selling_price,
    purchase_price = 0,
    tax_rate = 0,
    hsn_sac,
    default_supplier_id,
    image_url,
    gst_included = false,
    mrp,
    fssai_licence_no,
    net_quantity,
    country_of_origin,
    brand,
    is_weighed = false,
    plu_code,
    weight_barcode_mode = 'weight',
    allow_sale_when_out_of_stock,
    created_by,
    bundle_components = [] as BundleComponentInput[],
  } = body;

  if (!business_id || !name) {
    return NextResponse.json({ error: 'Name and Business ID are required' }, { status: 400 });
  }
  if (!created_by) {
    return NextResponse.json(
      { error: 'created_by (user_id) is required for authorization' },
      { status: 400 }
    );
  }

  if (!Array.isArray(bundle_components) || bundle_components.length < 1) {
    return NextResponse.json(
      { error: 'bundle_components must be a non-empty array of { item_id, quantity }' },
      { status: 400 }
    );
  }

  const { checkEmployeeAccessBoundary } = await import('@/lib/access-boundary');
  const accessCheck = await checkEmployeeAccessBoundary(created_by, 'portal');
  if (!accessCheck.allowed) {
    return NextResponse.json(
      { error: accessCheck.reason, code: 'ACCESS_DENIED' },
      { status: 403 }
    );
  }

  try {
    await authorize(created_by, 'items', 'create');
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return error.toNextResponse();
    }
    throw error;
  }

  const limitCheck = await checkLimit(business_id, 'items');
  if (!limitCheck.allowed) {
    return NextResponse.json(
      {
        error: limitCheck.message || 'Item limit reached',
        limit: limitCheck.limit,
        current: limitCheck.current,
        code: 'SUBSCRIPTION_LIMIT_EXCEEDED',
      },
      { status: 403 }
    );
  }

  for (const c of bundle_components) {
    const q = Number(c.quantity);
    if (!c.item_id || !(q > 0)) {
      return NextResponse.json(
        { error: 'Each bundle_components entry needs item_id and quantity > 0' },
        { status: 400 }
      );
    }
  }

  const ids = bundle_components.map((c) => c.item_id);
  const compValid = await validateBundleComponentItems(business_id, ids);
  if (!compValid.ok) {
    return NextResponse.json(
      { error: compValid.error, code: compValid.code },
      { status: 400 }
    );
  }

  let normalizedBarcode: string | null = null;
  let finalBarcodeType: string | null = null;
  if (barcode) {
    normalizedBarcode = normalizeBarcode(barcode);
    const validation = validateBarcode(normalizedBarcode, barcode_type);
    if (!validation.isValid) {
      return NextResponse.json(
        { error: validation.error || 'Invalid barcode format' },
        { status: 400 }
      );
    }
    finalBarcodeType = validation.type || null;
  }

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (normalizedBarcode) {
      const existing = await client.query(
        'SELECT id, name FROM items WHERE barcode = $1 AND business_id = $2 AND deleted_at IS NULL',
        [normalizedBarcode, business_id]
      );
      if (existing.rows[0]) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          {
            error: `Barcode "${normalizedBarcode}" already exists for item "${existing.rows[0].name}"`,
          },
          { status: 400 }
        );
      }
    }

    const oversellOverride =
      allow_sale_when_out_of_stock === undefined ? null : Boolean(allow_sale_when_out_of_stock);
    const normalizedPlu = plu_code
      ? String(plu_code).replace(/\D/g, '').slice(0, 5) || null
      : null;
    const normalizedWeightMode = weight_barcode_mode === 'price' ? 'price' : 'weight';

    const insertItem = await client.query<Item>(
      `INSERT INTO items (
        business_id, name, code, barcode, barcode_type, unit, selling_price, purchase_price,
        tax_rate, hsn_sac, item_type, opening_stock, current_stock, min_stock,
        default_supplier_id, has_variants, image_url, gst_included, mrp,
        fssai_licence_no, net_quantity, country_of_origin, brand,
        is_weighed, plu_code, weight_barcode_mode, allow_sale_when_out_of_stock,
        is_bundle
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'goods', 0, 0, 0,
        $11, false, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22,
        true
      )
      RETURNING *`,
      [
        business_id,
        name,
        code || null,
        normalizedBarcode,
        finalBarcodeType,
        unit,
        Number(selling_price) || 0,
        purchase_price,
        tax_rate,
        hsn_sac || null,
        default_supplier_id || null,
        image_url,
        gst_included || false,
        mrp || null,
        fssai_licence_no || null,
        net_quantity || null,
        country_of_origin || null,
        brand || null,
        !!is_weighed,
        normalizedPlu,
        normalizedWeightMode,
        oversellOverride,
      ]
    );

    const item = insertItem.rows[0];
    if (!item) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Failed to create bundle item' }, { status: 500 });
    }

    for (const c of bundle_components) {
      await client.query(
        `INSERT INTO bundle_items (bundle_id, item_id, quantity)
         VALUES ($1, $2, $3)`,
        [item.id, c.item_id, Number(c.quantity)]
      );
    }

    await client.query('COMMIT');
    return NextResponse.json({ item }, { status: 201 });
  } catch (e: unknown) {
    await client.query('ROLLBACK');
    const msg = e instanceof Error ? e.message : 'Failed to create bundle';
    console.error('[POST /api/items/bundle]', e);
    return NextResponse.json({ error: msg }, { status: 500 });
  } finally {
    client.release();
  }
}
