/**
 * Single source of truth for applying inventory + stock movements when a purchase line
 * is goods (used by POST /api/purchases and PATCH .../finalize).
 */

import type { PoolClient } from 'pg';
import { allocateStockOnPurchase } from '@/lib/stock-valuation';
import { adjustBranchItemStock, refreshItemGlobalStockFromBranches } from '@/lib/branch-stock';
import { adjustBranchVariantStock, refreshVariantGlobalStockFromBranches } from '@/lib/branch-variant-stock';

export class PurchaseStockError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code?: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'PurchaseStockError';
  }
}

export interface PurchaseStockLineInput {
  item_id: string;
  variant_id?: string | null;
  item_name?: string | null;
  quantity: number;
  unit_price: number;
  location_id?: string | null;
  batch_number?: string | null;
  serial_numbers?: unknown;
  manufacturing_date?: string | null;
  expiry_date?: string | null;
}

function parseSerialNumbers(raw: unknown): string[] | undefined {
  if (raw == null) return undefined;
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  if (typeof raw === 'string') {
    return raw
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  return undefined;
}

export async function applyPurchaseGoodsStockLine(
  client: PoolClient,
  ctx: {
    businessId: string;
    branchId: string;
    purchaseId: string;
    supplierId: string | null;
    billRef: string;
    warehouseModeEnabled: boolean;
    trackBatch: boolean;
    trackSerial: boolean;
  },
  row: PurchaseStockLineInput
): Promise<void> {
  const quantity = Number(row.quantity) || 0;
  const unitCost = Number(row.unit_price) || 0;
  const locationId = row.location_id || null;

  const itemOwn = await client.query(
    `SELECT 1 FROM items WHERE id = $1 AND business_id = $2`,
    [row.item_id, ctx.businessId]
  );
  if (itemOwn.rows.length === 0) {
    throw new PurchaseStockError(
      `Item "${row.item_name || row.item_id}" does not belong to this business or does not exist. Cannot receive stock.`,
      400,
      'ITEM_BUSINESS_MISMATCH',
      { item_id: row.item_id }
    );
  }

  if (ctx.warehouseModeEnabled && row.location_id) {
    const { isWarehouseAccessibleByBranch } = await import('@/lib/warehouse-access');
    const accessible = await isWarehouseAccessibleByBranch(row.location_id, ctx.branchId);
    if (!accessible) {
      throw new PurchaseStockError(
        `Warehouse ${row.location_id} is not accessible by branch ${ctx.branchId}.`,
        400,
        'WAREHOUSE_BRANCH_MISMATCH',
        { warehouse_id: row.location_id, item_id: row.item_id }
      );
    }
  }

  if (row.variant_id) {
    const vOk = await client.query(
      `SELECT 1 FROM item_variants v
       JOIN items i ON i.id = v.item_id
       WHERE v.id = $1 AND v.item_id = $2 AND i.business_id = $3`,
      [row.variant_id, row.item_id, ctx.businessId]
    );
    if (vOk.rows.length === 0) {
      throw new PurchaseStockError(
        'variant_id does not belong to this item/business.',
        400,
        'VARIANT_INVALID',
        { variant_id: row.variant_id, item_id: row.item_id }
      );
    }

    if (ctx.warehouseModeEnabled) {
      if (!row.location_id) {
        throw new PurchaseStockError(
          `location_id (warehouse) is required for variant line "${row.item_name || row.item_id}".`,
          400,
          'WAREHOUSE_REQUIRED',
          { item_id: row.item_id, item_name: row.item_name }
        );
      }
      await client.query(
        `SELECT * FROM location_stock WHERE location_id = $1 AND item_id = $2 FOR UPDATE`,
        [row.location_id, row.item_id]
      );
      await client.query(
        `
        INSERT INTO location_stock (location_id, item_id, current_stock_qty)
        VALUES ($1, $2, $3)
        ON CONFLICT (location_id, item_id)
        DO UPDATE SET
          current_stock_qty = location_stock.current_stock_qty + $3,
          last_updated = CURRENT_TIMESTAMP
      `,
        [row.location_id, row.item_id, quantity]
      );
    } else {
      await adjustBranchVariantStock(
        client,
        ctx.businessId,
        ctx.branchId,
        row.variant_id,
        quantity
      );
      await refreshVariantGlobalStockFromBranches(client, ctx.businessId, row.variant_id);
    }

    if (ctx.trackBatch || ctx.trackSerial) {
      try {
        const allocation = await allocateStockOnPurchase(
          row.item_id,
          quantity,
          unitCost,
          ctx.businessId,
          ctx.purchaseId,
          locationId || undefined,
          ctx.supplierId || undefined,
          row.batch_number ?? undefined,
          parseSerialNumbers(row.serial_numbers),
          row.manufacturing_date ?? undefined,
          row.expiry_date ?? undefined
        );

        if (allocation.batchId) {
          await client.query(
            `
            INSERT INTO stock_movements (
              business_id, item_id, variant_id, location_id, batch_id, type, quantity,
              unit_cost, reference_type, reference_id
            )
            VALUES ($1, $2, $3, $4, $5, 'in', $6, $7, 'purchase', $8)
          `,
            [
              ctx.businessId,
              row.item_id,
              row.variant_id,
              locationId,
              allocation.batchId,
              quantity,
              unitCost,
              ctx.purchaseId,
            ]
          );
        }

        if (allocation.serialIds && allocation.serialIds.length > 0) {
          for (const serialId of allocation.serialIds) {
            await client.query(
              `
              INSERT INTO stock_movements (
                business_id, item_id, variant_id, location_id, serial_id, type, quantity,
                unit_cost, reference_type, reference_id
              )
              VALUES ($1, $2, $3, $4, $5, 'in', 1, $6, 'purchase', $7)
            `,
              [
                ctx.businessId,
                row.item_id,
                row.variant_id,
                locationId,
                serialId,
                unitCost,
                ctx.purchaseId,
              ]
            );
          }
        }
      } catch (allocationError: unknown) {
        console.error('Error allocating variant stock on purchase:', allocationError);
        await client.query(
          `
          INSERT INTO stock_movements (
            business_id, item_id, variant_id, location_id, type, quantity, unit_cost,
            reference_type, reference_id
          )
          VALUES ($1, $2, $3, $4, 'in', $5, $6, 'purchase', $7)
        `,
          [
            ctx.businessId,
            row.item_id,
            row.variant_id,
            locationId,
            quantity,
            unitCost,
            ctx.purchaseId,
          ]
        );
      }
    } else {
      await client.query(
        `
        INSERT INTO stock_movements (
          business_id, item_id, variant_id, location_id, type, quantity, unit_cost,
          reference_type, reference_id
        )
        VALUES ($1, $2, $3, $4, 'in', $5, $6, 'purchase', $7)
      `,
        [
          ctx.businessId,
          row.item_id,
          row.variant_id,
          locationId,
          quantity,
          unitCost,
          ctx.purchaseId,
        ]
      );
    }
    return;
  }

  // No variant — item-level stock (same as finalize)
  if (ctx.warehouseModeEnabled && !row.location_id) {
    throw new PurchaseStockError(
      `location_id (warehouse) is required for item "${row.item_name || row.item_id}". Warehouse mode is enabled - stock operations require warehouse context.`,
      400,
      'WAREHOUSE_REQUIRED',
      { item_id: row.item_id, item_name: row.item_name }
    );
  }

  if (ctx.warehouseModeEnabled && locationId) {
    await client.query(
      `
      SELECT * FROM location_stock
      WHERE location_id = $1 AND item_id = $2
      FOR UPDATE
    `,
      [locationId, row.item_id]
    );

    await client.query(
      `
      INSERT INTO location_stock (location_id, item_id, current_stock_qty)
      VALUES ($1, $2, $3)
      ON CONFLICT (location_id, item_id)
      DO UPDATE SET
        current_stock_qty = location_stock.current_stock_qty + $3,
        last_updated = CURRENT_TIMESTAMP
    `,
      [locationId, row.item_id, quantity]
    );
  } else if (!ctx.warehouseModeEnabled) {
    await adjustBranchItemStock(client, ctx.businessId, ctx.branchId, row.item_id, quantity);
    await refreshItemGlobalStockFromBranches(client, ctx.businessId, row.item_id);
  }

  if (ctx.trackBatch || ctx.trackSerial) {
    try {
      const allocation = await allocateStockOnPurchase(
        row.item_id,
        quantity,
        unitCost,
        ctx.businessId,
        ctx.purchaseId,
        locationId || undefined,
        ctx.supplierId || undefined,
        row.batch_number ?? undefined,
        parseSerialNumbers(row.serial_numbers),
        row.manufacturing_date ?? undefined,
        row.expiry_date ?? undefined
      );

      if (allocation.batchId) {
        await client.query(
          `
          INSERT INTO stock_movements (
            business_id, item_id, location_id, batch_id, type, quantity,
            unit_cost, reference_type, reference_id
          )
          VALUES ($1, $2, $3, $4, 'in', $5, $6, 'purchase', $7)
        `,
          [
            ctx.businessId,
            row.item_id,
            locationId,
            allocation.batchId,
            quantity,
            unitCost,
            ctx.purchaseId,
          ]
        );
      }

      if (allocation.serialIds && allocation.serialIds.length > 0) {
        for (const serialId of allocation.serialIds) {
          await client.query(
            `
            INSERT INTO stock_movements (
              business_id, item_id, location_id, serial_id, type, quantity,
              unit_cost, reference_type, reference_id
            )
            VALUES ($1, $2, $3, $4, 'in', 1, $5, 'purchase', $6)
          `,
            [ctx.businessId, row.item_id, locationId, serialId, unitCost, ctx.purchaseId]
          );
        }
      }
    } catch (allocationError: unknown) {
      console.error('Error allocating stock on purchase:', allocationError);
      await client.query(
        `
        INSERT INTO stock_movements (
          business_id, item_id, location_id, type, quantity, unit_cost,
          reference_type, reference_id
        )
        VALUES ($1, $2, $3, 'in', $4, $5, 'purchase', $6)
      `,
        [ctx.businessId, row.item_id, locationId, quantity, unitCost, ctx.purchaseId]
      );
    }
  } else {
    await client.query(
      `
      INSERT INTO stock_movements (
        business_id, item_id, location_id, type, quantity, unit_cost,
        reference_type, reference_id
      )
      VALUES ($1, $2, $3, 'in', $4, $5, 'purchase', $6)
    `,
      [ctx.businessId, row.item_id, locationId, quantity, unitCost, ctx.purchaseId]
    );
  }
}
