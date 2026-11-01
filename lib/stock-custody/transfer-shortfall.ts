import type { PoolClient } from 'pg';
import { changeGodownStock, GodownStockError, resolveGodown } from '@/lib/inventory/godown-stock';
import { createQuantityAdjustmentOn } from '@/lib/inventory-adjustment-service';

export interface ShortfallLine {
  item_id: string;
  qty: number;
  /** transit_loss: written off; carrier_claim: written off and claimed from the transporter. */
  reason: 'transit_loss' | 'carrier_claim';
  claim_party?: string | null;
  claim_amount?: number | null;
}

const q3 = (n: unknown) => Math.round((Number(n) || 0) * 1000) / 1000;

/**
 * Closes the part of a transfer that never arrived. The shortfall left the source godown on
 * dispatch, so it is brought back there and written off as a transit loss (ITC reversed), with
 * the carrier claim recorded when there is one. Completes the transfer when nothing is left open.
 */
export async function closeTransferShortfall(
  client: PoolClient,
  businessId: string,
  transferId: string,
  input: { date: string; lines: ShortfallLine[]; notes?: string | null },
  userId: string | null
): Promise<{ completed: boolean; adjustmentIds: string[] }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date || '')) throw new GodownStockError('Date is required');
  const t = await client.query(
    `SELECT id, transfer_number, transfer_date::text, status, from_location_id
       FROM stock_transfers WHERE id = $1 AND business_id = $2 FOR UPDATE`,
    [transferId, businessId]
  );
  const transfer = t.rows[0];
  if (!transfer) throw new GodownStockError('Transfer not found', 404);
  if (transfer.status !== 'in_transit') throw new GodownStockError('Only a transfer in transit can be closed short.', 409);
  if (input.date < transfer.transfer_date) throw new GodownStockError('The date cannot be before the transfer date.');
  const source = await resolveGodown(client, businessId, { warehouseId: transfer.from_location_id });

  const items = await client.query(
    `SELECT sti.id, sti.item_id, i.name, COALESCE(sti.quantity_dispatched, 0) AS dispatched,
            COALESCE(sti.received_qty, 0) AS received, sti.qty_short, sti.cost_snapshot
       FROM stock_transfer_items sti JOIN items i ON i.id = sti.item_id
      WHERE sti.transfer_id = $1 FOR UPDATE OF sti`,
    [transferId]
  );
  const byItem = new Map(items.rows.map((r: any) => [r.item_id, r]));
  const adjustmentIds: string[] = [];

  for (const l of input.lines) {
    const row: any = byItem.get(l.item_id);
    if (!row) throw new GodownStockError('Item is not on this transfer', 404);
    const qty = q3(l.qty);
    if (qty <= 0) continue;
    if (l.reason !== 'transit_loss' && l.reason !== 'carrier_claim') throw new GodownStockError('Choose transit loss or carrier claim');
    if (l.reason === 'carrier_claim' && !String(l.claim_party || '').trim()) {
      throw new GodownStockError('Name the carrier the shortfall is claimed from');
    }
    const open = q3(Number(row.dispatched) - Number(row.received) - Number(row.qty_short));
    if (qty > open) throw new GodownStockError(`${row.name}: only ${open} is still in transit.`, 409);

    await changeGodownStock(client, businessId, source, l.item_id, qty);
    await client.query(
      `INSERT INTO stock_movements (business_id, item_id, location_id, type, quantity, reference_type, reference_id, notes, unit_cost, created_by)
       VALUES ($1, $2, $3, 'in', $4, 'stock_transfer', $5, $6, $7, $8)`,
      [businessId, l.item_id, source.warehouseId, qty, transferId, `Transfer ${transfer.transfer_number}: ${qty} never arrived`, row.cost_snapshot, userId]
    );
    const claim = l.reason === 'carrier_claim' ? ` Claimed from ${String(l.claim_party).trim()}${l.claim_amount ? ` for ₹${l.claim_amount}` : ''}.` : '';
    const adj = await createQuantityAdjustmentOn(client, {
      businessId,
      itemId: l.item_id,
      locationId: source.warehouseId,
      branchId: source.branchId,
      direction: 'DECREASE',
      quantity: qty,
      reasonCode: 'TRANSIT_LOSS',
      reasonNotes: `Short on transfer ${transfer.transfer_number}.${claim}${input.notes ? ` ${input.notes}` : ''}`,
      adjustmentDate: input.date,
      createdBy: userId ?? undefined,
    });
    adjustmentIds.push(adj.adjustmentId);
    await client.query(
      `UPDATE stock_transfer_items
          SET qty_short = qty_short + $2, short_reason = $3, claim_party = $4, claim_amount = $5, short_adjustment_id = $6
        WHERE id = $1`,
      [row.id, qty, l.reason, l.reason === 'carrier_claim' ? String(l.claim_party).trim() : null, l.claim_amount ?? null, adj.adjustmentId]
    );
  }

  const left = await client.query(
    `SELECT COUNT(*)::int AS open FROM stock_transfer_items
      WHERE transfer_id = $1 AND COALESCE(received_qty, 0) + qty_short < COALESCE(quantity_dispatched, 0)`,
    [transferId]
  );
  const completed = left.rows[0].open === 0;
  if (completed) {
    await client.query(`UPDATE stock_transfers SET status = 'completed', updated_at = NOW() WHERE id = $1`, [transferId]);
  }
  return { completed, adjustmentIds };
}
