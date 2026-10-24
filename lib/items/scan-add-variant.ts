import type { PoolClient } from 'pg';
import { getPool } from '@/lib/db';
import { hashReplayPayload } from '@/lib/offline-sync/types';
import { findReplayLog, insertReplayLogPending, markReplayCompleted } from '@/lib/offline-sync/replay-log-repository';
import { seedOpeningStockLayers } from '@/lib/seed-opening-stock-layers';
import { refreshVariantGlobalStockFromBranches } from '@/lib/branch-variant-stock';
import { refreshItemGlobalStockFromBranches } from '@/lib/branch-stock';
import { normalizeOpeningBatch, type OpeningBatch } from '@/lib/items/opening-batch';
import { nameWithoutSize } from '@/lib/items/scan-add-form';

/**
 * Scan & Add Items: a second pack size that carries the same barcode as an item already in the shop.
 *
 * The item keeps the barcode; each size becomes a variant without its own barcode, so billing a
 * scan of that barcode asks which size. A plain item is first turned into an item with variants,
 * its current pack becoming the first variant, but only while it has no sales, purchases or other
 * stock changes since its opening stock: nothing already posted is rewritten.
 */

export const ADD_VARIANT_IDEMPOTENCY_ACTION = 'items.scan_add_variant';

export interface AddVariantInput {
  item_id: string;
  /** The new pack, e.g. "75 g". */
  variant_name: string;
  selling_price?: number | string | null;
  purchase_price?: number | string | null;
  opening_stock?: number | string | null;
  batch?: { batch_number?: unknown; manufacturing_date?: unknown; expiry_date?: unknown } | null;
  /** When converting a plain item: the name for the pack it already holds. Defaults to its size on pack. */
  existing_variant_name?: string | null;
  /** When converting: the item's new name without a size, e.g. "Harpic" instead of "Harpic 500 ml". */
  item_name?: string | null;
  /** Whether prices include GST. Kept on the item, so it applies to every size of it. Omitted = unchanged. */
  gst_included?: boolean | null;
}

export type AddVariantResult =
  | { ok: true; status: 201 | 200; itemId: string; variantId: string; converted: boolean; replayed: boolean }
  | { ok: false; status: number; code: string; error: string };

const fail = (status: number, code: string, error: string): AddVariantResult => ({ ok: false, status, code, error });
const money = (v: unknown) => (v === undefined || v === null || v === '' ? null : Number(v));

/** Shape and money checks. Null when the input can be saved. */
export function validateAddVariant(input: AddVariantInput): { code: string; error: string } | null {
  const name = String(input.variant_name ?? '').trim();
  if (!name) return { code: 'VARIANT_NAME_REQUIRED', error: 'Enter the pack size, e.g. 75 g' };
  if (name.length > 100) return { code: 'VARIANT_NAME_TOO_LONG', error: 'Pack size is too long' };
  for (const [field, label] of [['selling_price', 'Selling price'], ['purchase_price', 'Purchase price'], ['opening_stock', 'Stock']] as const) {
    const v = money(input[field]);
    if (v !== null && (!Number.isFinite(v) || v < 0)) return { code: 'INVALID_NUMBER', error: `${label} must be 0 or more` };
  }
  const qty = money(input.opening_stock) ?? 0;
  const cost = money(input.purchase_price) ?? 0;
  if (qty > 0 && cost <= 0) return { code: 'PURCHASE_PRICE_REQUIRED', error: 'Enter the purchase price for the stock you have' };
  return null;
}

export function addVariantFingerprint(input: AddVariantInput, batch: OpeningBatch | null) {
  const storedPayload = {
    item_id: input.item_id,
    variant_name: String(input.variant_name ?? '').trim(),
    selling_price: money(input.selling_price),
    purchase_price: money(input.purchase_price),
    opening_stock: money(input.opening_stock) ?? 0,
    existing_variant_name: input.existing_variant_name?.trim() || null,
    item_name: input.item_name?.trim() || null,
    gst_included: typeof input.gst_included === 'boolean' ? input.gst_included : null,
    batch,
  };
  return { hash: hashReplayPayload(storedPayload), storedPayload };
}

/** Sold, bought or adjusted since its opening stock. */
async function itemHasHistory(client: PoolClient, businessId: string, itemId: string): Promise<boolean> {
  const r = await client.query<{ h: boolean }>(
    `SELECT (EXISTS (SELECT 1 FROM invoice_items WHERE item_id = $1)
          OR EXISTS (SELECT 1 FROM purchase_items WHERE item_id = $1)
          OR EXISTS (SELECT 1 FROM stock_movements
                      WHERE item_id = $1 AND business_id = $2
                        AND COALESCE(notes, '') NOT LIKE 'Opening Stock%')) AS h`,
    [itemId, businessId]
  );
  return r.rows[0]?.h === true;
}

async function insertBatch(
  client: PoolClient,
  businessId: string,
  itemId: string,
  variantId: string,
  batch: OpeningBatch,
  cost: number,
  qty: number
): Promise<string> {
  const row = await client.query<{ id: string }>(
    `INSERT INTO item_batches (
       business_id, item_id, variant_id, batch_number, manufacturing_date, expiry_date, purchase_price, quantity, notes
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'Opening stock')
     RETURNING id`,
    [businessId, itemId, variantId, batch.batchNumber, batch.manufacturingDate, batch.expiryDate, cost, qty]
  );
  await client.query(`UPDATE items SET track_batch = true, valuation_method = 'fifo' WHERE id = $1 AND business_id = $2`, [itemId, businessId]);
  return row.rows[0].id;
}

export async function addVariantFromScan(
  businessId: string,
  userId: string,
  input: AddVariantInput,
  idempotencyKey: string | null
): Promise<AddVariantResult> {
  const invalid = validateAddVariant(input);
  if (invalid) return fail(400, invalid.code, invalid.error);
  const batchOrError = normalizeOpeningBatch(input.batch ?? null);
  if (batchOrError && 'error' in batchOrError) return fail(400, 'INVALID_BATCH', batchOrError.error);
  const batch = batchOrError;

  const variantName = String(input.variant_name).trim();
  const qty = money(input.opening_stock) ?? 0;
  const cost = money(input.purchase_price) ?? 0;
  const idem = idempotencyKey
    ? { scopedKey: `${ADD_VARIANT_IDEMPOTENCY_ACTION}:${idempotencyKey}`, ...addVariantFingerprint(input, batch) }
    : null;

  const { isWarehouseModeEnabled } = await import('@/lib/warehouse-mode');
  if (await isWarehouseModeEnabled(businessId)) {
    // Opening stock of variants is not placed in warehouses yet (see seedOpeningStockLayers).
    return fail(409, 'WAREHOUSE_MODE', 'Sizes with stock cannot be added here while warehouses are on. Use the item page.');
  }

  const client = await getPool().connect();
  let converted = false;
  let variantId = '';
  try {
    await client.query('BEGIN');

    let idemRowId: string | null = null;
    if (idem) {
      const row = await insertReplayLogPending(client, {
        businessId,
        idempotencyKey: idem.scopedKey,
        actionType: ADD_VARIANT_IDEMPOTENCY_ACTION,
        requestHash: idem.hash,
        requestPayload: idem.storedPayload,
        userId,
      });
      if (!row) {
        await client.query('ROLLBACK');
        const prior = await findReplayLog(businessId, idem.scopedKey, client);
        if (!prior || prior.request_hash !== idem.hash || prior.action_type !== ADD_VARIANT_IDEMPOTENCY_ACTION) {
          return fail(409, 'IDEMPOTENCY_KEY_REUSED', 'This idempotency key was already used for a different size.');
        }
        if (prior.status !== 'completed' || !prior.entity_id) {
          return fail(409, 'IDEMPOTENCY_IN_PROGRESS', 'This size is still being saved. Try again in a moment.');
        }
        const payload = (prior.response_payload ?? {}) as Record<string, unknown>;
        return {
          ok: true,
          status: 200,
          itemId: input.item_id,
          variantId: prior.entity_id,
          converted: payload.converted === true,
          replayed: true,
        };
      }
      idemRowId = row.id;
    }

    const item = (
      await client.query(
        `SELECT id, name, has_variants, is_bundle, item_type, net_quantity, purchase_price, opening_stock_rate,
                selling_price, opening_stock, current_stock
           FROM items
          WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL
          FOR UPDATE`,
        [input.item_id, businessId]
      )
    ).rows[0] as Record<string, any> | undefined;
    if (!item) {
      await client.query('ROLLBACK');
      return fail(404, 'ITEM_NOT_FOUND', 'Item not found');
    }
    if (item.is_bundle || item.item_type !== 'goods') {
      await client.query('ROLLBACK');
      return fail(409, 'NOT_A_STOCK_ITEM', 'Sizes can only be added to stock items');
    }

    if (!item.has_variants) {
      if (await itemHasHistory(client, businessId, item.id)) {
        await client.query('ROLLBACK');
        return fail(
          409,
          'ITEM_HAS_HISTORY',
          `${item.name} has already been sold, bought or adjusted, so it cannot be split into sizes. Add the new size as a separate item.`
        );
      }
      const existingName = (input.existing_variant_name?.trim() || item.net_quantity?.trim() || 'Original').slice(0, 100);
      if (existingName.toLowerCase() === variantName.toLowerCase()) {
        await client.query('ROLLBACK');
        return fail(409, 'VARIANT_EXISTS', `${item.name} is already the ${variantName} pack`);
      }
      // The current pack becomes the first variant, valued at the rate its opening stock was posted at,
      // so the opening stock voucher keeps the same total when it is rebuilt.
      const rate = Number(item.opening_stock_rate ?? item.purchase_price ?? 0);
      const first = (
        await client.query<{ id: string }>(
          `INSERT INTO item_variants (item_id, variant_name, purchase_price, selling_price, opening_stock, current_stock, attributes)
           VALUES ($1, $2, $3, $4, $5, 0, $6::jsonb)
           RETURNING id`,
          [item.id, existingName, rate, item.selling_price, Number(item.opening_stock) || 0, JSON.stringify({ size: existingName })]
        )
      ).rows[0].id;
      // Move every branch's quantity of the item onto that variant.
      await client.query(
        `INSERT INTO branch_item_variant_stock (business_id, branch_id, item_variant_id, quantity)
         SELECT business_id, branch_id, $3, quantity FROM branch_item_stock
          WHERE business_id = $1 AND item_id = $2 AND quantity <> 0`,
        [businessId, item.id, first]
      );
      await client.query(`UPDATE branch_item_stock SET quantity = 0, updated_at = CURRENT_TIMESTAMP WHERE business_id = $1 AND item_id = $2`, [businessId, item.id]);
      await client.query(
        `UPDATE item_batches SET variant_id = $3, updated_at = CURRENT_TIMESTAMP
          WHERE business_id = $1 AND item_id = $2 AND variant_id IS NULL`,
        [businessId, item.id, first]
      );
      await refreshVariantGlobalStockFromBranches(client, businessId, first);
      // The size now lives on each variant, so it leaves the item's name and net quantity.
      const newName = (input.item_name?.trim() || nameWithoutSize(item.name, item.net_quantity)).slice(0, 255);
      await client.query(
        `UPDATE items
            SET has_variants = true, opening_stock = 0, name = $3, net_quantity = NULL, updated_at = CURRENT_TIMESTAMP
          WHERE id = $1 AND business_id = $2`,
        [item.id, businessId, newName]
      );
      await refreshItemGlobalStockFromBranches(client, businessId, item.id);
      converted = true;
    }

    if (typeof input.gst_included === 'boolean') {
      await client.query(`UPDATE items SET gst_included = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND business_id = $2`, [
        item.id,
        businessId,
        input.gst_included,
      ]);
    }

    const clash = await client.query(
      `SELECT 1 FROM item_variants WHERE item_id = $1 AND lower(trim(variant_name)) = lower($2)`,
      [item.id, variantName]
    );
    if (clash.rows.length) {
      await client.query('ROLLBACK');
      return fail(409, 'VARIANT_EXISTS', `${item.name} already has a ${variantName} size`);
    }

    variantId = (
      await client.query<{ id: string }>(
        `INSERT INTO item_variants (item_id, variant_name, purchase_price, selling_price, opening_stock, current_stock, attributes)
         VALUES ($1, $2, $3, $4, $5, 0, $6::jsonb)
         RETURNING id`,
        [item.id, variantName, cost, money(input.selling_price) ?? 0, qty, JSON.stringify({ size: variantName })]
      )
    ).rows[0].id;

    if (qty > 0) {
      const batchId = batch ? await insertBatch(client, businessId, item.id, variantId, batch, cost, qty) : null;
      await client.query(
        `INSERT INTO stock_movements (business_id, item_id, variant_id, type, quantity, reference_type, notes, batch_id, unit_cost)
         VALUES ($1, $2, $3, 'in', $4, 'adjustment', $5, $6, $7)`,
        [businessId, item.id, variantId, qty, `Opening Stock (Variant: ${variantName})`, batchId, batchId ? cost : null]
      );
      await seedOpeningStockLayers(businessId, { itemId: item.id, variantId, quantity: qty, client });
    }

    if (idemRowId) {
      await markReplayCompleted(client, idemRowId, { variant_id: variantId, converted }, { type: 'item_variant', id: variantId });
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }

  // Rebuilt from item + variants, so it is safe to run again.
  const { syncItemOpeningStockLedger } = await import('@/lib/inventory/opening-stock-ledger');
  await syncItemOpeningStockLedger(businessId, input.item_id).catch((e) =>
    console.error('[scan-add/variant] opening stock ledger sync failed:', e)
  );
  return { ok: true, status: 201, itemId: input.item_id, variantId, converted, replayed: false };
}
