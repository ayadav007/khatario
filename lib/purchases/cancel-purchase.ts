import type { PoolClient } from 'pg';
import { adjustBranchItemStock, getBranchItemQuantity, refreshItemGlobalStockFromBranches } from '@/lib/branch-stock';
import {
  adjustBranchVariantStock,
  getBranchVariantQuantity,
  refreshVariantGlobalStockFromBranches,
} from '@/lib/branch-variant-stock';
import { resolveBranchId } from '@/lib/branch-helpers';
import { reverseVouchers, reverseVoucherLedgerEntries } from '@/lib/ledger-reversal';
import { releaseDocumentAdvances } from '@/lib/accounting/advance-service';
import { supplierPayableAmount } from '@/lib/purchases/supplier-payable';
import { RULE37_REAVAIL, RULE37_REVERSAL } from '@/lib/gst/rule37';
import { recostAfterStockChange, stockItemsForDocument } from '@/lib/inventory/fifo-recost';

export class PurchaseCancelError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const EPS = 0.0005;

type StockMovement = {
  id: string | null;
  item_id: string;
  quantity: string | number;
  unit_cost: string | number | null;
  batch_id: string | null;
  serial_id: string | null;
  location_id: string | null;
  variant_id: string | null;
};

/**
 * Marks TDS rows cancelled (never deleted). Their vouchers must already be reversed by the
 * caller; deposited rows are refused by the caller and by a table constraint.
 */
export async function cancelTdsTransactions(
  client: PoolClient,
  p: { businessId: string; ids: string[]; userId: string; reason: string }
): Promise<void> {
  if (p.ids.length === 0) return;
  await client.query(
    `UPDATE tds_transactions
        SET status = 'cancelled', cancelled_at = CURRENT_TIMESTAMP, cancelled_by = $3, cancellation_reason = $4
      WHERE business_id = $1 AND id = ANY($2::uuid[]) AND status = 'active'`,
    [p.businessId, p.ids, p.userId, p.reason]
  );
}

/**
 * Cancels a final purchase bill on the caller's transaction. Nothing posted is deleted:
 *   - a bill with a live payment (or a paid amount) is refused with 409 PURCHASE_HAS_PAYMENTS.
 *     Payments are never reversed, refunded or turned into an advance automatically; reverse
 *     each payment first (POST /api/payments/[id]/reverse) or correct the bill with a purchase
 *     return. Reversed payments no longer count as live;
 *   - the bill voucher, the vouchers of its TDS deductions and its Rule 37 ITC reversal /
 *     re-availment vouchers are reversed (mirror lines linked in ledger_entry_reversals);
 *   - advance adjustments against the bill are released back to the advance;
 *   - every stock receipt of the bill gets a compensating 'out' movement (reference_type
 *     'purchase_cancel'). If the received stock, batch quantity or serial is no longer on
 *     hand the cancel is refused (409) instead of clamping stock at zero;
 *   - the supplier balance loses the bill's net effect (payable less TDS and advance);
 *   - TDS rows are marked cancelled (deposited TDS refuses the cancel), and the bill becomes
 *     status 'cancelled', balance 0, with cancelled_at/by/reason.
 * Period locks and GST filing are checked by the caller before the transaction; the
 * database refuses reversal lines in a locked period regardless.
 */
export async function cancelFinalPurchase(
  client: PoolClient,
  p: {
    businessId: string;
    purchaseId: string;
    userId: string;
    reason: string | null;
    warehouseModeEnabled: boolean;
  }
): Promise<{ reversedLines: number; releasedAdvance: number; stockMovements: number }> {
  const purchase = (
    await client.query(
      `SELECT * FROM purchases WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL FOR UPDATE`,
      [p.purchaseId, p.businessId]
    )
  ).rows[0];
  if (!purchase) throw new PurchaseCancelError(404, 'PURCHASE_NOT_FOUND', 'Purchase not found');
  if (purchase.status === 'cancelled') {
    throw new PurchaseCancelError(409, 'PURCHASE_ALREADY_CANCELLED', 'Purchase is already cancelled');
  }
  if (purchase.status !== 'final') {
    throw new PurchaseCancelError(400, 'PURCHASE_NOT_FINAL', 'Only a final purchase can be cancelled; delete the draft instead');
  }

  const returns = await client.query(
    `SELECT 1 FROM purchase_returns
      WHERE purchase_id = $1 AND business_id = $2 AND COALESCE(status, 'final') <> 'cancelled' LIMIT 1`,
    [p.purchaseId, p.businessId]
  );
  if (returns.rows.length > 0) {
    throw new PurchaseCancelError(
      409,
      'PURCHASE_HAS_RETURNS',
      'Cannot cancel a purchase that has returns against it. Cancel the returns first.'
    );
  }

  const livePayments = await client.query(
    `SELECT 1 FROM payments
      WHERE business_id = $1 AND reference_type = 'purchase' AND reference_id = $2 AND deleted_at IS NULL
        AND status = 'active' LIMIT 1`,
    [p.businessId, p.purchaseId]
  );
  if (livePayments.rows.length > 0 || (Number(purchase.paid_amount) || 0) > EPS) {
    throw new PurchaseCancelError(
      409,
      'PURCHASE_HAS_PAYMENTS',
      'This bill cannot be cancelled because a payment has already been recorded against it. To send goods back or reduce the bill, record a purchase return.'
    );
  }

  const tds = await client.query<{ id: string; is_deposited: boolean }>(
    `SELECT id, COALESCE(is_deposited, false) AS is_deposited
       FROM tds_transactions WHERE business_id = $1 AND purchase_id = $2 AND status = 'active' FOR UPDATE`,
    [p.businessId, p.purchaseId]
  );
  if (tds.rows.some((r) => r.is_deposited)) {
    throw new PurchaseCancelError(
      409,
      'BILL_TDS_DEPOSITED',
      'TDS on this bill is already deposited. Correct it through a TDS return revision instead of cancelling the bill.'
    );
  }

  let stockBranchId: string;
  try {
    stockBranchId = await resolveBranchId({ businessId: p.businessId, branchId: purchase.branch_id });
  } catch (e) {
    throw new PurchaseCancelError(400, 'PURCHASE_NO_BRANCH', (e as Error)?.message || 'Purchase has no valid branch for stock reversal');
  }
  const stockMovements = await reverseReceivedStock(client, {
    businessId: p.businessId,
    purchaseId: p.purchaseId,
    stockBranchId,
    warehouseModeEnabled: p.warehouseModeEnabled,
    userId: p.userId,
    label: purchase.bill_number || purchase.purchase_number || p.purchaseId.slice(0, 8),
  });

  const reason = `Purchase ${purchase.bill_number || purchase.purchase_number || ''} cancelled`.replace(/\s+/g, ' ');
  let reversedLines = await reverseVoucherLedgerEntries(client, {
    businessId: p.businessId,
    voucherType: 'purchase',
    voucherId: p.purchaseId,
    reason,
    actorId: p.userId,
  });
  reversedLines += await reverseVouchers(client, {
    businessId: p.businessId,
    voucherType: 'tds',
    voucherIds: tds.rows.map((r) => r.id),
    reason,
    actorId: p.userId,
  });

  const rule37 = await client.query<{ voucher_type: string; voucher_id: string }>(
    `SELECT DISTINCT voucher_type, voucher_id FROM ledger_entry_lines
      WHERE business_id = $1 AND voucher_type IN ($2, $3) AND reference_number = $4`,
    [p.businessId, RULE37_REVERSAL, RULE37_REAVAIL, `RULE37|${p.purchaseId}`]
  );
  for (const v of rule37.rows) {
    reversedLines += await reverseVoucherLedgerEntries(client, {
      businessId: p.businessId,
      voucherType: v.voucher_type,
      voucherId: v.voucher_id,
      reason,
      actorId: p.userId,
    });
  }

  const { released } = await releaseDocumentAdvances(client, {
    businessId: p.businessId,
    userId: p.userId,
    purchaseId: p.purchaseId,
    reason,
  });

  if (purchase.supplier_id) {
    const net = round2(
      supplierPayableAmount(purchase.grand_total, purchase.tax_total, purchase.is_reverse_charge) -
        (Number(purchase.tds_deducted) || 0) -
        (Number(purchase.advance_adjusted) || 0)
    );
    if (net !== 0) {
      await client.query(
        `UPDATE suppliers SET current_balance = current_balance - $1, updated_at = CURRENT_TIMESTAMP
          WHERE id = $2 AND business_id = $3`,
        [net, purchase.supplier_id, p.businessId]
      );
    }
  }

  await cancelTdsTransactions(client, {
    businessId: p.businessId,
    ids: tds.rows.map((r) => r.id),
    userId: p.userId,
    reason: p.reason || reason,
  });
  await client.query(
    `UPDATE quantity_requests SET purchase_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE purchase_id = $1`,
    [p.purchaseId]
  );
  await client.query(
    `UPDATE purchases
        SET status = 'cancelled', balance_amount = 0, paid_amount = 0, tds_deducted = 0,
            cancelled_at = CURRENT_TIMESTAMP, cancelled_by = $3, cancellation_reason = $4,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND business_id = $2`,
    [p.purchaseId, p.businessId, p.userId, p.reason]
  );
  await recostAfterStockChange(client, p.businessId, await stockItemsForDocument(client, 'purchase', p.purchaseId));

  return { reversedLines, releasedAdvance: released, stockMovements };
}

async function reverseReceivedStock(
  client: PoolClient,
  p: {
    businessId: string;
    purchaseId: string;
    stockBranchId: string;
    warehouseModeEnabled: boolean;
    userId: string;
    label: string;
  }
): Promise<number> {
  let movements = (
    await client.query<StockMovement>(
      `SELECT id, item_id, quantity, unit_cost, batch_id, serial_id, location_id, variant_id
         FROM stock_movements
        WHERE business_id = $1 AND reference_type = 'purchase' AND reference_id = $2 AND item_id IS NOT NULL
        ORDER BY created_at, id`,
      [p.businessId, p.purchaseId]
    )
  ).rows;

  if (movements.length === 0) {
    // Bills finalised before stock movements were recorded: take the goods lines as received.
    movements = (
      await client.query<StockMovement>(
        `SELECT NULL::uuid AS id, pi.item_id, pi.quantity, pi.unit_price AS unit_cost,
                NULL::uuid AS batch_id, NULL::uuid AS serial_id, pi.location_id, pi.variant_id
           FROM purchase_items pi
           JOIN items i ON i.id = pi.item_id AND i.business_id = $1
          WHERE pi.purchase_id = $2 AND COALESCE(i.item_type, 'goods') = 'goods'
            AND COALESCE(i.is_bundle, false) = false`,
        [p.businessId, p.purchaseId]
      )
    ).rows;
  }

  const refreshItems = new Set<string>();
  const refreshVariants = new Set<string>();
  let n = 0;
  for (const m of movements) {
    const qty = Number(m.quantity) || 0;
    if (qty <= 0) continue;
    const consumed = () =>
      new PurchaseCancelError(
        409,
        'PURCHASE_STOCK_CONSUMED',
        'Stock received on this bill has already been sold, transferred or adjusted. Record a purchase return for what is still on hand instead of cancelling the bill.'
      );

    if (p.warehouseModeEnabled && m.location_id) {
      const row = await client.query<{ q: string }>(
        `SELECT current_stock_qty AS q FROM location_stock WHERE location_id = $1 AND item_id = $2 FOR UPDATE`,
        [m.location_id, m.item_id]
      );
      if ((Number(row.rows[0]?.q) || 0) + EPS < qty) throw consumed();
      await client.query(
        `UPDATE location_stock SET current_stock_qty = current_stock_qty - $1, last_updated = CURRENT_TIMESTAMP
          WHERE location_id = $2 AND item_id = $3`,
        [qty, m.location_id, m.item_id]
      );
    } else if (!p.warehouseModeEnabled) {
      if (m.variant_id) {
        await client.query(
          `SELECT 1 FROM branch_item_variant_stock
            WHERE business_id = $1 AND branch_id = $2 AND item_variant_id = $3 FOR UPDATE`,
          [p.businessId, p.stockBranchId, m.variant_id]
        );
        if ((await getBranchVariantQuantity(client, p.businessId, p.stockBranchId, m.variant_id)) + EPS < qty) {
          throw consumed();
        }
        await adjustBranchVariantStock(client, p.businessId, p.stockBranchId, m.variant_id, -qty);
        refreshVariants.add(m.variant_id);
      } else {
        await client.query(
          `SELECT 1 FROM branch_item_stock WHERE business_id = $1 AND branch_id = $2 AND item_id = $3 FOR UPDATE`,
          [p.businessId, p.stockBranchId, m.item_id]
        );
        if ((await getBranchItemQuantity(client, p.businessId, p.stockBranchId, m.item_id)) + EPS < qty) {
          throw consumed();
        }
        await adjustBranchItemStock(client, p.businessId, p.stockBranchId, m.item_id, -qty);
        refreshItems.add(m.item_id);
      }
    }

    if (m.batch_id) {
      const b = await client.query<{ q: string }>(
        `SELECT quantity AS q FROM item_batches WHERE id = $1 FOR UPDATE`,
        [m.batch_id]
      );
      if ((Number(b.rows[0]?.q) || 0) + EPS < qty) throw consumed();
      await client.query(`UPDATE item_batches SET quantity = quantity - $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`, [
        qty,
        m.batch_id,
      ]);
    }
    if (m.serial_id) {
      const s = await client.query<{ status: string }>(`SELECT status FROM item_serials WHERE id = $1 FOR UPDATE`, [
        m.serial_id,
      ]);
      if (s.rows[0]?.status !== 'available') throw consumed();
      await client.query(`UPDATE item_serials SET status = 'returned', updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [
        m.serial_id,
      ]);
    }

    await client.query(
      `INSERT INTO stock_movements (
         business_id, item_id, variant_id, type, quantity, reference_type, reference_id,
         notes, created_by, batch_id, serial_id, unit_cost, location_id
       ) VALUES ($1, $2, $3, 'out', $4, 'purchase_cancel', $5, $6, $7, $8, $9, $10, $11)`,
      [
        p.businessId,
        m.item_id,
        m.variant_id,
        qty,
        p.purchaseId,
        `Purchase ${p.label} cancelled`,
        p.userId,
        m.batch_id,
        m.serial_id,
        m.unit_cost,
        m.location_id,
      ]
    );
    n++;
  }

  for (const itemId of refreshItems) await refreshItemGlobalStockFromBranches(client, p.businessId, itemId);
  for (const variantId of refreshVariants) await refreshVariantGlobalStockFromBranches(client, p.businessId, variantId);
  return n;
}
