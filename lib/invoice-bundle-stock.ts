/**
 * Bundle (combo) invoice stock: deduct component items by bundle_line_qty × component_qty.
 * Mirrors non-variant goods deduction in app/api/invoices/route.ts and finalize route.
 */

import type { PoolClient } from 'pg';
import { queryRows, queryOne } from '@/lib/db';
import {
  adjustBranchItemStock,
  getBranchItemQuantityDb,
  refreshItemGlobalStockFromBranches,
} from '@/lib/branch-stock';
import { allocateStockOnSale } from '@/lib/stock-valuation';

/** First component that cannot satisfy line_quantity × bundle_items.quantity (preflight only). */
export type BundleStockPreflightFailure = {
  name: string;
  itemId: string;
  available: number;
  need: number;
};

/**
 * Validates bundle component availability before invoice save / finalize.
 * Matches warehouse location_stock vs branch_item_stock + reconcile behavior used in invoice POST.
 */
export async function getFirstBundleStockPreflightFailure(args: {
  businessId: string;
  branchId: string;
  bundleItemId: string;
  lineQuantity: number;
  warehouseModeEnabled: boolean;
  warehouseId: string | null | undefined;
}): Promise<BundleStockPreflightFailure | null> {
  const { businessId, branchId, bundleItemId, lineQuantity, warehouseModeEnabled, warehouseId } = args;

  const components = await queryRows<{
    item_id: string;
    comp_qty: string;
    item_name: string;
  }>(
    `SELECT bi.item_id, bi.quantity::text AS comp_qty, i.name AS item_name
     FROM bundle_items bi
     INNER JOIN items i ON i.id = bi.item_id AND i.business_id = $2
     WHERE bi.bundle_id = $1`,
    [bundleItemId, businessId]
  );

  if (components.length === 0) {
    return null;
  }

  const lineQty = Number(lineQuantity) || 0;
  const { getEffectiveAllowSaleWhenOutOfStock } = await import('@/lib/inventory-sales-policy');

  for (const c of components) {
    const per = parseFloat(String(c.comp_qty)) || 0;
    const need = lineQty * per;
    if (need <= 0) continue;

    const allowOversell = await getEffectiveAllowSaleWhenOutOfStock(businessId, c.item_id);
    if (allowOversell) continue;

    let available = 0;
    if (warehouseModeEnabled) {
      if (!warehouseId) {
        return {
          name: c.item_name,
          itemId: c.item_id,
          available: 0,
          need,
        };
      }
      const ls = await queryOne<{ q: string }>(
        `SELECT COALESCE(current_stock_qty, 0)::text AS q
         FROM location_stock WHERE location_id = $1 AND item_id = $2`,
        [warehouseId, c.item_id]
      );
      available = parseFloat(ls?.q || '0') || 0;
    } else {
      available = await getBranchItemQuantityDb(businessId, branchId, c.item_id);
      if (available < need) {
        const { tryReconcileBaseItemBranchStock } = await import('@/lib/reconcile-legacy-branch-stock');
        const healed = await tryReconcileBaseItemBranchStock(businessId, c.item_id, branchId);
        if (healed) {
          available = await getBranchItemQuantityDb(businessId, branchId, c.item_id);
        }
      }
    }

    if (available < need) {
      return {
        name: c.item_name,
        itemId: c.item_id,
        available,
        need,
      };
    }
  }

  return null;
}

export class InvoiceBundleStockError extends Error {
  constructor(
    public statusCode: number,
    public body: Record<string, unknown>
  ) {
    super(String(body.error ?? 'Bundle stock error'));
    this.name = 'InvoiceBundleStockError';
  }
}

export type BundleDeductionContext = {
  client: PoolClient;
  businessId: string;
  branchId: string;
  invoiceId: string;
  customerId: string | null;
  warehouseModeEnabled: boolean;
  hasBatchTrackingColumns: boolean;
};

async function fetchGoodsItemMeta(
  client: PoolClient,
  businessId: string,
  itemId: string,
  hasBatchTrackingColumns: boolean
) {
  if (hasBatchTrackingColumns) {
    const r = await client.query(
      `SELECT item_type,
              COALESCE(track_batch, false) AS track_batch,
              COALESCE(track_serial, false) AS track_serial,
              COALESCE(valuation_method, 'simple') AS valuation_method,
              COALESCE(is_bundle, false) AS is_bundle
       FROM items WHERE id = $1 AND business_id = $2`,
      [itemId, businessId]
    );
    return r.rows[0] as
      | {
          item_type: string;
          track_batch: boolean;
          track_serial: boolean;
          valuation_method: string;
          is_bundle: boolean;
        }
      | undefined;
  }
  const r = await client.query(
    `SELECT item_type, COALESCE(is_bundle, false) AS is_bundle
     FROM items WHERE id = $1 AND business_id = $2`,
    [itemId, businessId]
  );
  const row = r.rows[0];
  if (!row) return undefined;
  return {
    ...row,
    track_batch: false,
    track_serial: false,
    valuation_method: 'simple',
  };
}

/** Single goods item, item-level stock (no variants). Used for bundle components. */
export async function deductSingleGoodsItemOnInvoice(
  ctx: BundleDeductionContext,
  itemId: string,
  quantity: number,
  locationId: string | null,
  lineLabelForErrors: string
): Promise<void> {
  const {
    client,
    businessId,
    branchId,
    invoiceId,
    customerId,
    warehouseModeEnabled,
    hasBatchTrackingColumns,
  } = ctx;

  if (quantity <= 0) return;

  const itemData = await fetchGoodsItemMeta(client, businessId, itemId, hasBatchTrackingColumns);
  if (!itemData) {
    throw new InvoiceBundleStockError(400, {
      error: `Component item not found: ${itemId}`,
      item_id: itemId,
    });
  }

  const itemType = itemData.item_type || 'goods';
  if (itemType !== 'goods') return;

  const trackBatch = (itemData as { track_batch?: boolean }).track_batch || false;
  const trackSerial = (itemData as { track_serial?: boolean }).track_serial || false;
  const valuationMethod = ((itemData as { valuation_method?: string }).valuation_method ||
    'simple') as 'fifo' | 'lifo' | 'weighted_avg' | 'simple';

  if (warehouseModeEnabled && !locationId) {
    throw new InvoiceBundleStockError(400, {
      error: `location_id (warehouse) is required for bundle component "${lineLabelForErrors}". Warehouse mode is enabled.`,
      item_id: itemId,
      code: 'WAREHOUSE_REQUIRED',
    });
  }

  if (trackBatch || trackSerial) {
    try {
      const allocation = await allocateStockOnSale(
        itemId,
        quantity,
        valuationMethod,
        businessId,
        locationId || undefined,
        trackSerial
      );

      if (warehouseModeEnabled && locationId) {
        await client.query(
          `SELECT * FROM location_stock 
           WHERE location_id = $1 AND item_id = $2
           FOR UPDATE`,
          [locationId, itemId]
        );
        await client.query(
          `UPDATE location_stock
           SET current_stock_qty = current_stock_qty - $1,
               last_updated = CURRENT_TIMESTAMP
           WHERE location_id = $2 AND item_id = $3`,
          [quantity, locationId, itemId]
        );
      } else if (!warehouseModeEnabled) {
        await adjustBranchItemStock(client, businessId, branchId, itemId, -quantity);
        await refreshItemGlobalStockFromBranches(client, businessId, itemId);
      }

      for (const batchAlloc of allocation.batchAllocations) {
        await client.query(
          `UPDATE item_batches
           SET quantity = quantity - $1,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $2`,
          [batchAlloc.quantity, batchAlloc.batch_id]
        );

        await client.query(
          `INSERT INTO stock_movements (
             business_id, item_id, location_id, type, quantity,
             reference_type, reference_id, batch_id, unit_cost
           )
           VALUES ($1, $2, $3, 'out', $4, 'invoice', $5, $6, $7)`,
          [
            businessId,
            itemId,
            locationId,
            batchAlloc.quantity,
            invoiceId,
            batchAlloc.batch_id,
            batchAlloc.unit_cost,
          ]
        );
      }

      if (allocation.serialAllocations) {
        for (const serialAlloc of allocation.serialAllocations) {
          await client.query(
            `UPDATE item_serials
             SET status = 'sold',
                 sold_to_customer_id = $1,
                 sold_invoice_id = $2,
                 sold_at = CURRENT_TIMESTAMP,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $3`,
            [customerId || null, invoiceId, serialAlloc.serial_id]
          );

          await client.query(
            `INSERT INTO stock_movements (
               business_id, item_id, location_id, type, quantity,
               reference_type, reference_id, serial_id, unit_cost
             )
             VALUES ($1, $2, $3, 'out', 1, 'invoice', $4, $5, $6)`,
            [businessId, itemId, locationId, invoiceId, serialAlloc.serial_id, serialAlloc.unit_cost]
          );
        }
      }
    } catch (allocationError: unknown) {
      console.error('Error allocating bundle component stock on sale:', allocationError);
      if (warehouseModeEnabled && locationId) {
        await client.query(
          `UPDATE location_stock
           SET current_stock_qty = current_stock_qty - $1,
               last_updated = CURRENT_TIMESTAMP
           WHERE location_id = $2 AND item_id = $3`,
          [quantity, locationId, itemId]
        );
      } else if (!warehouseModeEnabled) {
        await adjustBranchItemStock(client, businessId, branchId, itemId, -quantity);
        await refreshItemGlobalStockFromBranches(client, businessId, itemId);
      }

      await client.query(
        `INSERT INTO stock_movements (
           business_id, item_id, location_id, type, quantity, reference_type, reference_id
         )
         VALUES ($1, $2, $3, 'out', $4, 'invoice', $5)`,
        [businessId, itemId, locationId, quantity, invoiceId]
      );
    }
  } else {
    if (warehouseModeEnabled && locationId) {
      await client.query(
        `SELECT * FROM location_stock 
         WHERE location_id = $1 AND item_id = $2
         FOR UPDATE`,
        [locationId, itemId]
      );
      await client.query(
        `UPDATE location_stock
         SET current_stock_qty = current_stock_qty - $1,
             last_updated = CURRENT_TIMESTAMP
         WHERE location_id = $2 AND item_id = $3`,
        [quantity, locationId, itemId]
      );
    } else if (!warehouseModeEnabled) {
      await adjustBranchItemStock(client, businessId, branchId, itemId, -quantity);
      await refreshItemGlobalStockFromBranches(client, businessId, itemId);
    }

    await client.query(
      `INSERT INTO stock_movements (
         business_id, item_id, location_id, type, quantity, reference_type, reference_id
       )
       VALUES ($1, $2, $3, 'out', $4, 'invoice', $5)`,
      [businessId, itemId, locationId, quantity, invoiceId]
    );
  }
}

export async function deductBundleChildrenOnInvoice(
  ctx: BundleDeductionContext,
  bundleItemId: string,
  bundleLineQty: number,
  locationId: string | null,
  lineLabelForErrors: string
): Promise<string[]> {
  const { client, businessId, hasBatchTrackingColumns } = ctx;
  const deductedItemIds: string[] = [];

  const rows = await client.query(
    `SELECT bi.item_id, bi.quantity::numeric AS quantity
     FROM bundle_items bi
     INNER JOIN items i ON i.id = bi.item_id AND i.business_id = $2
     WHERE bi.bundle_id = $1`,
    [bundleItemId, businessId]
  );

  if (rows.rows.length === 0) {
    throw new InvoiceBundleStockError(400, {
      error: `Bundle has no components defined (id: ${bundleItemId}).`,
      bundle_id: bundleItemId,
      code: 'BUNDLE_EMPTY',
    });
  }

  for (const row of rows.rows as { item_id: string; quantity: string | number }[]) {
    const childId = row.item_id;
    const perBundle = Number(row.quantity);
    if (!(perBundle > 0)) continue;

    const childMeta = await fetchGoodsItemMeta(client, businessId, childId, hasBatchTrackingColumns);
    if (childMeta && (childMeta as { is_bundle?: boolean }).is_bundle) {
      throw new InvoiceBundleStockError(400, {
        error: `Nested bundles are not allowed: component "${childId}" is a bundle.`,
        item_id: childId,
        code: 'BUNDLE_NESTED',
      });
    }

    const outQty = bundleLineQty * perBundle;
    await deductSingleGoodsItemOnInvoice(ctx, childId, outQty, locationId, lineLabelForErrors);
    deductedItemIds.push(childId);
  }

  return deductedItemIds;
}

/** Reverse bundle component stock on invoice cancel (mirror finalize/POST deduction). */
export async function restoreBundleChildrenAfterInvoiceCancel(
  client: PoolClient,
  businessId: string,
  branchId: string | null,
  invoiceId: string,
  bundleItemId: string,
  bundleLineQty: number,
  locationId: string | null,
  warehouseModeEnabled: boolean
): Promise<void> {
  const comp = await client.query(
    `SELECT item_id, quantity::numeric AS quantity FROM bundle_items WHERE bundle_id = $1`,
    [bundleItemId]
  );

  for (const row of comp.rows as { item_id: string; quantity: string | number }[]) {
    const childId = row.item_id;
    const perBundle = Number(row.quantity);
    const qty = bundleLineQty * perBundle;

    const itemTypeRes = await client.query(`SELECT item_type, track_batch, track_serial FROM items WHERE id = $1`, [
      childId,
    ]);
    const itemData = itemTypeRes.rows[0];
    const itemType = itemData?.item_type || 'goods';
    if (itemType !== 'goods') continue;

    if (itemData?.track_batch) {
      const movements = await client.query(
        `SELECT batch_id, quantity FROM stock_movements
         WHERE reference_type = 'invoice' AND reference_id = $1 AND item_id = $2 AND batch_id IS NOT NULL`,
        [invoiceId, childId]
      );
      for (const movement of movements.rows as { batch_id: string; quantity: number | string }[]) {
        await client.query(
          `UPDATE item_batches
           SET quantity = quantity + $1,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $2`,
          [movement.quantity, movement.batch_id]
        );
      }
    }

    if (warehouseModeEnabled && locationId) {
      await client.query(
        `INSERT INTO location_stock (location_id, item_id, current_stock_qty)
         VALUES ($1, $2, $3)
         ON CONFLICT (location_id, item_id)
         DO UPDATE SET
           current_stock_qty = location_stock.current_stock_qty + EXCLUDED.current_stock_qty,
           last_updated = CURRENT_TIMESTAMP`,
        [locationId, childId, qty]
      );
    } else if (!warehouseModeEnabled && branchId) {
      await adjustBranchItemStock(client, businessId, branchId, childId, qty);
      await refreshItemGlobalStockFromBranches(client, businessId, childId);
    }

    await client.query(
      `INSERT INTO stock_movements (
         business_id, item_id, variant_id, type, quantity, reference_type, reference_id
       )
       VALUES ($1, $2, $3, 'in', $4, 'invoice_cancel', $5)`,
      [businessId, childId, null, qty, invoiceId]
    );
  }
}
