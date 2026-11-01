import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { requireAuthenticatedTenant } from '@/lib/stock-request-security';
import { checkLowStockForMultipleItems } from '@/lib/low-stock-checker';

export const dynamic = 'force-dynamic';

const MAX_ROWS = 300;
const MAX_CHANGES = 500;

async function loadSupplier(supplierId: string, businessId: string) {
  return db.queryOne<{ id: string; name: string }>(
    `SELECT id, name FROM suppliers WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL`,
    [supplierId, businessId]
  );
}

/**
 * GET /api/suppliers/[id]/items?q=&filter=all|purchased|assigned|unassigned
 * The caller's goods items for choosing which ones this supplier supplies by default.
 */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = requireAuthenticatedTenant(request);
  if (auth instanceof NextResponse) return auth;

  try {
    await authorize(auth.userId, 'items', 'read', { businessId: auth.businessId });
    const supplier = await loadSupplier(params.id, auth.businessId);
    if (!supplier) return NextResponse.json({ error: 'Supplier not found' }, { status: 404 });

    const { searchParams } = new URL(request.url);
    const q = (searchParams.get('q') || '').trim();
    const filter = searchParams.get('filter') || 'all';

    const where: string[] = [
      'i.business_id = $1',
      'i.deleted_at IS NULL',
      'COALESCE(i.is_active, true) = true',
      "COALESCE(i.item_type, 'goods') <> 'service'",
    ];
    const args: any[] = [auth.businessId, supplier.id];
    if (q) {
      args.push(`%${q}%`);
      where.push(`(i.name ILIKE $${args.length} OR i.code ILIKE $${args.length})`);
    }
    if (filter === 'purchased') where.push('lp.last_purchased IS NOT NULL');
    if (filter === 'assigned') where.push('i.default_supplier_id = $2');
    if (filter === 'unassigned') where.push('i.default_supplier_id IS NULL');

    const items = await db.queryRows(
      `
      SELECT
        i.id, i.name, i.code, i.unit,
        COALESCE(i.current_stock, 0) AS current_stock,
        COALESCE(i.min_stock, 0) AS min_stock,
        COALESCE(i.has_variants, false) AS has_variants,
        i.default_supplier_id,
        i.backup_supplier_id,
        ds.name AS default_supplier_name,
        CASE WHEN COALESCE(i.has_variants, false) THEN COALESCE((
          SELECT json_agg(json_build_object('id', v.id, 'name', v.variant_name,
                   'current_stock', COALESCE(v.current_stock, 0), 'min_stock', COALESCE(v.min_stock, 0)) ORDER BY v.variant_name)
            FROM item_variants v WHERE v.item_id = i.id
        ), '[]'::json) END AS variants,
        lp.last_purchased
      FROM items i
      LEFT JOIN suppliers ds ON ds.id = i.default_supplier_id AND ds.business_id = i.business_id
      LEFT JOIN LATERAL (
        SELECT MAX(p.bill_date) AS last_purchased
        FROM purchase_items pi
        JOIN purchases p ON p.id = pi.purchase_id
        WHERE pi.item_id = i.id
          AND p.business_id = i.business_id
          AND p.supplier_id = $2
          AND p.status <> 'cancelled'
      ) lp ON true
      WHERE ${where.join(' AND ')}
      ORDER BY (i.default_supplier_id = $2) DESC NULLS LAST, lp.last_purchased DESC NULLS LAST, i.name ASC
      LIMIT ${MAX_ROWS}
      `,
      args
    );

    return NextResponse.json({ supplier, items, limit: MAX_ROWS });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    console.error('supplier items GET', error);
    return NextResponse.json({ error: 'Failed to load items' }, { status: 500 });
  }
}

/**
 * POST /api/suppliers/[id]/items
 * Body: { assign?: string[], unassign?: string[], min_stock?: { [itemId]: number } }
 * assign: make this supplier the default for these items (replacing any other default).
 * unassign: clear the default only where it is this supplier.
 * min_stock: the reorder level for each item (items with sizes/colours are skipped).
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = requireAuthenticatedTenant(request);
  if (auth instanceof NextResponse) return auth;

  try {
    await authorize(auth.userId, 'items', 'update', { businessId: auth.businessId });
    const supplier = await loadSupplier(params.id, auth.businessId);
    if (!supplier) return NextResponse.json({ error: 'Supplier not found' }, { status: 404 });

    const body = await request.json().catch(() => ({}));
    const ids = (v: unknown) => (Array.isArray(v) ? Array.from(new Set(v.map(String))) : []);
    const assign = ids(body.assign);
    const unassign = ids(body.unassign).filter((id) => !assign.includes(id));
    const minStockEntries = Object.entries(
      body.min_stock && typeof body.min_stock === 'object' ? (body.min_stock as Record<string, unknown>) : {}
    ).map(([id, v]) => [id, Number(v)] as const);
    // Backup supplier: gets what the default supplier cannot send (lib/supply-orders routeToBackups).
    const backupAssign = ids(body.backup_assign);
    const backupUnassign = ids(body.backup_unassign).filter((id) => !backupAssign.includes(id));
    // Reorder levels for sizes / colours of items with variants.
    const variantLevels = Object.entries(
      body.variant_min_stock && typeof body.variant_min_stock === 'object' ? (body.variant_min_stock as Record<string, unknown>) : {}
    ).map(([id, v]) => [id, Number(v)] as const);

    if ([...minStockEntries, ...variantLevels].some(([, v]) => !Number.isFinite(v) || v < 0)) {
      return NextResponse.json({ error: 'Reorder levels must be zero or more' }, { status: 400 });
    }
    if (assign.length + unassign.length + minStockEntries.length + backupAssign.length + backupUnassign.length + variantLevels.length > MAX_CHANGES) {
      return NextResponse.json({ error: `At most ${MAX_CHANGES} changes at a time` }, { status: 400 });
    }

    const allIds = Array.from(
      new Set([...assign, ...unassign, ...backupAssign, ...backupUnassign, ...minStockEntries.map(([id]) => id)])
    );
    if (allIds.length === 0 && variantLevels.length === 0) return NextResponse.json({ ok: true, updated: 0 });
    if (variantLevels.length) {
      const ownVariants = await db.queryRows<{ id: string }>(
        `SELECT v.id FROM item_variants v JOIN items i ON i.id = v.item_id
          WHERE i.business_id = $1 AND i.deleted_at IS NULL AND v.id = ANY($2::uuid[])`,
        [auth.businessId, variantLevels.map(([id]) => id)]
      );
      if (ownVariants.length !== variantLevels.length) {
        return NextResponse.json({ error: 'Some sizes or colours were not found in your items' }, { status: 400 });
      }
    }

    const owned = await db.queryRows<{ id: string }>(
      `SELECT id FROM items
        WHERE business_id = $1 AND deleted_at IS NULL
          AND COALESCE(item_type, 'goods') <> 'service'
          AND id = ANY($2::uuid[])`,
      [auth.businessId, allIds]
    );
    if (owned.length !== allIds.length) {
      return NextResponse.json({ error: 'Some items were not found in your items' }, { status: 400 });
    }

    const client = await db.getPool().connect();
    try {
      await client.query('BEGIN');
      if (assign.length) {
        await client.query(
          `UPDATE items SET default_supplier_id = $3, updated_at = CURRENT_TIMESTAMP
            WHERE business_id = $1 AND id = ANY($2::uuid[])`,
          [auth.businessId, assign, supplier.id]
        );
      }
      if (unassign.length) {
        await client.query(
          `UPDATE items SET default_supplier_id = NULL, updated_at = CURRENT_TIMESTAMP
            WHERE business_id = $1 AND id = ANY($2::uuid[]) AND default_supplier_id = $3`,
          [auth.businessId, unassign, supplier.id]
        );
      }
      if (backupAssign.length) {
        await client.query(
          `UPDATE items SET backup_supplier_id = $3, updated_at = CURRENT_TIMESTAMP
            WHERE business_id = $1 AND id = ANY($2::uuid[]) AND default_supplier_id IS DISTINCT FROM $3`,
          [auth.businessId, backupAssign, supplier.id]
        );
      }
      if (backupUnassign.length) {
        await client.query(
          `UPDATE items SET backup_supplier_id = NULL, updated_at = CURRENT_TIMESTAMP
            WHERE business_id = $1 AND id = ANY($2::uuid[]) AND backup_supplier_id = $3`,
          [auth.businessId, backupUnassign, supplier.id]
        );
      }
      // An item's default supplier is never also its backup.
      if (assign.length) {
        await client.query(
          `UPDATE items SET backup_supplier_id = NULL WHERE business_id = $1 AND id = ANY($2::uuid[]) AND backup_supplier_id = $3`,
          [auth.businessId, assign, supplier.id]
        );
      }
      for (const [variantId, level] of variantLevels) {
        await client.query(`UPDATE item_variants SET min_stock = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [variantId, level]);
      }
      for (const [itemId, level] of minStockEntries) {
        await client.query(
          `UPDATE items SET min_stock = $3, updated_at = CURRENT_TIMESTAMP
            WHERE business_id = $1 AND id = $2 AND COALESCE(has_variants, false) = false`,
          [auth.businessId, itemId, level]
        );
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    // Raise or close low-stock alerts for the changed items right away.
    await checkLowStockForMultipleItems(allIds.map((item_id) => ({ item_id, business_id: auth.businessId })));

    return NextResponse.json({ ok: true, updated: allIds.length });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    console.error('supplier items POST', error);
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
  }
}
