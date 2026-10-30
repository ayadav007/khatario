import type { PoolClient } from 'pg';
import { writeChallan } from '@/lib/delivery-challans/challan';
import { isInterBranchTransfer } from '@/lib/inter-branch-utils';

/**
 * Goods moved between godowns on one GSTIN are not a supply, so no invoice is issued, but they
 * still travel under a delivery challan (Rule 55(1)(c)) and, above the limit, an e-way bill.
 * Creates that challan once per transfer: paperwork only (the transfer moves the stock), valued
 * at the transfer's cost snapshot, no tax. Transfers between GSTINs get an inter-branch tax invoice
 * instead (ensureInterBranchInvoiceForTransfer) and are skipped here.
 * Returns the challan id, or null when none is needed.
 */
export async function ensureTransferChallan(
  client: PoolClient,
  transferId: string,
  opts: { ewayBillNumber?: string | null; createdBy?: string | null } = {}
): Promise<string | null> {
  const t = await client.query(
    `SELECT id, business_id, transfer_number, transfer_date::text AS transfer_date, from_location_id, to_location_id,
            inter_branch_invoice_id, created_by
       FROM stock_transfers WHERE id = $1`,
    [transferId]
  );
  const transfer = t.rows[0];
  if (!transfer || transfer.inter_branch_invoice_id) return null;

  const existing = await client.query(`SELECT id FROM delivery_challans WHERE stock_transfer_id = $1`, [transferId]);
  if (existing.rows[0]) return existing.rows[0].id;

  const info = await isInterBranchTransfer(transfer.from_location_id, transfer.to_location_id);
  if (info.isInterBranch && info.hasDifferentGstin) return null;

  const rows = await client.query(
    `SELECT sti.item_id, sti.quantity_dispatched AS qty, sti.unit, sti.cost_snapshot,
            i.name, i.hsn_sac, i.purchase_price
       FROM stock_transfer_items sti
       JOIN items i ON i.id = sti.item_id
      WHERE sti.transfer_id = $1 AND COALESCE(sti.quantity_dispatched, 0) > 0`,
    [transferId]
  );
  if (rows.rows.length === 0) return null;

  const to = await client.query(
    `SELECT name, address_line1, address_line2, city, state, pincode FROM warehouses WHERE id = $1`,
    [transfer.to_location_id]
  );
  const dest = to.rows[0];
  const shipTo = dest
    ? [dest.name, dest.address_line1, dest.address_line2, dest.city, dest.state, dest.pincode].filter(Boolean).join(', ')
    : null;

  const challan = await writeChallan(client, transfer.business_id, {
    branch_id: info.fromWarehouse.branch?.id ?? null,
    stock_transfer_id: transferId,
    warehouse_id: transfer.from_location_id,
    to_warehouse_id: transfer.to_location_id,
    auto_number: true,
    challan_date: transfer.transfer_date,
    challan_kind: 'supply',
    reason_for_transportation: 'own_use',
    shipping_address: shipTo,
    place_of_delivery: dest?.city || null,
    e_way_bill_number: opts.ewayBillNumber || null,
    notes: `Stock transfer ${transfer.transfer_number}: movement between own godowns on one GSTIN, not a supply.`,
    status: 'sent',
    created_by: opts.createdBy ?? transfer.created_by ?? null,
    items: rows.rows.map((r: any) => ({
      item_id: r.item_id,
      item_name: r.name || 'Item',
      hsn_sac: r.hsn_sac,
      qty: Number(r.qty) || 0,
      unit: r.unit,
      unit_price: Number(r.cost_snapshot) || Number(r.purchase_price) || 0,
    })),
  });
  return challan?.id ?? null;
}
