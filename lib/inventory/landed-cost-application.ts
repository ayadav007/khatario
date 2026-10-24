import type { PoolClient } from 'pg';
import { randomUUID } from 'crypto';
import { postInventoryAdjustment } from '@/lib/inventory/adjustment-posting';
import { replayCostItems } from '@/lib/inventory/fifo-costing';
import { reverseVoucherLedgerEntries } from '@/lib/ledger-reversal';
import { costShare, nextCostShare } from '@/lib/purchases/acquisition-cost';

export class LandedCostError extends Error {
  constructor(
    message: string,
    public code: string
  ) {
    super(message);
    this.name = 'LandedCostError';
  }
}

/**
 * Moves freight that is still expensed on a historical bill into the remaining
 * quantity of that purchase lot. A bill that already capitalized the charge is rejected.
 * The purchase line's acquisition_cost is not rewritten.
 */
export async function applyHistoricalLandedCost(
  client: PoolClient,
  args: {
    businessId: string;
    purchaseId: string;
    goodsItemId: string;
    serviceItemId: string;
    amount: number;
    adjustmentDate: string;
    branchId: string | null;
  }
): Promise<{ adjustmentId: string }> {
  const purchase = await client.query<{ acquisition_costs_capitalized: boolean; status: string }>(
    `SELECT acquisition_costs_capitalized, status FROM purchases
      WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL FOR UPDATE`,
    [args.purchaseId, args.businessId]
  );
  if (!purchase.rows[0]) throw new LandedCostError('Purchase not found', 'PURCHASE_NOT_FOUND');
  if (purchase.rows[0].acquisition_costs_capitalized) {
    throw new LandedCostError(
      'This bill already capitalized its incidental freight. A Landed Cost adjustment would capitalize it again.',
      'LANDED_COST_ALREADY_CAPITALIZED'
    );
  }

  const service = await client.query<{ id: string; taxable_value: string }>(
    `SELECT pi.id, pi.taxable_value
       FROM purchase_items pi
       LEFT JOIN items it ON it.id = pi.item_id
      WHERE pi.purchase_id = $1 AND pi.item_id = $2
        AND COALESCE(pi.line_item_type, it.item_type) = 'service'
      FOR UPDATE OF pi`,
    [args.purchaseId, args.serviceItemId]
  );
  if (!service.rows[0]) throw new LandedCostError('The expensed freight line was not found', 'LANDED_COST_LINE_MISSING');
  const applied = await client.query<{ used: string }>(
    `SELECT COALESCE(SUM(amount - reversed_amount), 0)::text AS used
       FROM acquisition_cost_applications
      WHERE business_id = $1 AND purchase_item_id = $2`,
    [args.businessId, service.rows[0].id]
  );
  const remaining = Math.round((Number(service.rows[0].taxable_value) - Number(applied.rows[0]?.used || 0)) * 100) / 100;
  if (args.amount > remaining + 0.001) {
    throw new LandedCostError(
      `Only ${remaining.toFixed(2)} of this freight is still expensed.`,
      'LANDED_COST_EXCEEDS_REMAINING'
    );
  }

  const replay = await replayCostItems(client, args.businessId, [args.goodsItemId]);
  const lots = replay.replays.get(args.goodsItemId)?.lots || [];
  const openQty = lots
    .filter((lot) => lot.kind === 'purchase' && lot.docId === args.purchaseId && lot.remaining > 0.0001)
    .reduce((sum, lot) => sum + lot.remaining, 0);
  if (openQty <= 0.0001) {
    throw new LandedCostError('None of this purchase remains in stock.', 'LANDED_COST_NOTHING_REMAINING');
  }

  const adjustmentId = randomUUID();
  const adjustmentNumber = `LC-${adjustmentId.slice(0, 8)}`;
  await client.query(
    `INSERT INTO inventory_adjustments (
       id, business_id, adjustment_number, adjustment_date, adjustment_type,
       item_id, branch_id, quantity_before, quantity_after, value_change,
       unit_cost_before, unit_cost_after, total_value_before, total_value_after,
       reason_code, purchase_id
     ) VALUES ($1,$2,$3,$4,'VALUE',$5,$6,$7,$7,$8,0,0,0,0,'LANDED_COST',$9)`,
    [
      adjustmentId,
      args.businessId,
      adjustmentNumber,
      args.adjustmentDate,
      args.goodsItemId,
      args.branchId,
      openQty,
      args.amount,
      args.purchaseId,
    ]
  );
  await client.query(
    `INSERT INTO acquisition_cost_applications (
       business_id, purchase_id, purchase_item_id, item_id, source_type, source_id, amount, open_qty
     ) VALUES ($1,$2,$3,$4,'landed_cost_adjustment',$5,$6,$7)`,
    [args.businessId, args.purchaseId, service.rows[0].id, args.goodsItemId, adjustmentId, args.amount, openQty]
  );
  await postInventoryAdjustment(client, {
    businessId: args.businessId,
    branchId: args.branchId,
    adjustmentId,
    adjustmentNumber,
    date: args.adjustmentDate,
    reason: 'LANDED_COST',
    isDecrease: false,
    amount: args.amount,
    itemId: args.goodsItemId,
    narration: `Landed cost from purchase ${args.purchaseId}`,
    quantityAdjustment: false,
    counterCodes: ['5201', '5101'],
  });
  return { adjustmentId };
}

/**
 * Reverses a purchase-linked Landed Cost adjustment only while the adjusted lot
 * is still fully unsold. A consumed adjustment is rejected and historical COGS is left as posted.
 */
export async function reverseHistoricalLandedCost(
  client: PoolClient,
  args: { businessId: string; adjustmentId: string; reason: string }
): Promise<void> {
  const row = await client.query<{
    purchase_id: string | null;
    item_id: string;
    open_qty: string;
    amount: string;
    reversed_amount: string;
  }>(
    `SELECT a.purchase_id, a.item_id, a.open_qty::text, a.amount::text, a.reversed_amount::text
       FROM acquisition_cost_applications a
      WHERE a.business_id = $1 AND a.source_type = 'landed_cost_adjustment' AND a.source_id = $2
      FOR UPDATE`,
    [args.businessId, args.adjustmentId]
  );
  const application = row.rows[0];
  if (!application?.purchase_id) throw new LandedCostError('Landed cost application not found', 'LANDED_COST_NOT_FOUND');
  if (Number(application.reversed_amount) > 0) {
    throw new LandedCostError('This landed cost adjustment is already reversed.', 'LANDED_COST_ALREADY_REVERSED');
  }
  const replay = await replayCostItems(client, args.businessId, [application.item_id]);
  const openQty = (replay.replays.get(application.item_id)?.lots || [])
    .filter((lot) => lot.kind === 'purchase' && lot.docId === application.purchase_id && lot.remaining > 0.0001)
    .reduce((sum, lot) => sum + lot.remaining, 0);
  if (openQty + 0.0001 < Number(application.open_qty)) {
    throw new LandedCostError(
      'Some quantity from the adjusted lot has been sold. This phase does not reverse cost already in COGS.',
      'LANDED_COST_PARTIALLY_CONSUMED'
    );
  }
  await reverseVoucherLedgerEntries(client, {
    businessId: args.businessId,
    voucherType: 'stock_adjustment',
    voucherId: args.adjustmentId,
    reason: args.reason,
  });
  await client.query(
    `UPDATE acquisition_cost_applications
        SET reversed_amount = amount
      WHERE business_id = $1 AND source_id = $2`,
    [args.businessId, args.adjustmentId]
  );
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Current lot value above the original acquisition cost that leaves with a return.
 * `linked` is the share of a purchase-linked Landed Cost adjustment (credited to 5201).
 * The remainder is an unlinked value adjustment, which this phase credited to 5105.
 * acquisition_cost is not updated.
 */
export async function landedCostLeavingWithReturn(
  client: PoolClient,
  args: {
    businessId: string;
    purchaseId: string;
    itemId: string;
    quantity: number;
    acquisitionCost: number;
    returnQty: number;
  }
): Promise<{ total: number; linked: number }> {
  const replay = await replayCostItems(client, args.businessId, [args.itemId]);
  const lot = (replay.replays.get(args.itemId)?.lots || []).find(
    (row) => row.kind === 'purchase' && row.docId === args.purchaseId && row.remaining > 0.0001
  );
  if (!lot) return { total: 0, linked: 0 };
  const remaining = lot.remaining;
  const consumed = round2(args.quantity - remaining);
  const taken = consumed > 0.004 ? costShare(args.acquisitionCost, args.quantity, [consumed])[0] : 0;
  const acquisitionLeft = round2(args.acquisitionCost - taken);
  const landedLeft = round2(remaining * lot.unitCost - acquisitionLeft);
  if (landedLeft <= 0.004) return { total: 0, linked: 0 };
  const total = nextCostShare(landedLeft, remaining, [], args.returnQty);

  const apps = await client.query<{ id: string; open: string }>(
    `SELECT id, (amount - reversed_amount - consumed_amount)::text AS open
       FROM acquisition_cost_applications
      WHERE business_id = $1 AND purchase_id = $2 AND item_id = $3
        AND reversed_amount < amount - 0.004
      ORDER BY id
      FOR UPDATE`,
    [args.businessId, args.purchaseId, args.itemId]
  );
  let linkedLeft = round2(Math.min(total, apps.rows.reduce((sum, row) => sum + Math.max(0, Number(row.open) || 0), 0)));
  const linked = linkedLeft;
  for (const row of apps.rows) {
    const open = round2(Math.max(0, Number(row.open) || 0));
    if (open <= 0.004 || linkedLeft <= 0.004) continue;
    const use = round2(Math.min(open, linkedLeft));
    await client.query(
      `UPDATE acquisition_cost_applications SET consumed_amount = consumed_amount + $2 WHERE id = $1`,
      [row.id, use]
    );
    linkedLeft = round2(linkedLeft - use);
  }
  return { total, linked };
}
