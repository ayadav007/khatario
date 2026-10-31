import type { PoolClient } from 'pg';
import { writeChallan } from '@/lib/delivery-challans/challan';
import { resolveDocumentBranchId } from '@/lib/documents/series-number';
import { resolveSupplierRegistration } from '@/lib/gst/registration';
import { getOrCreateBranchCustomer } from '@/lib/inter-branch-utils';
import { godownAddress, loadTransferGodown } from '@/lib/stock-transfers/godowns';

type Queryable = Pick<PoolClient, 'query'>;

/**
 * Delivery challan for a dispatched transfer whose two godowns are on the same GSTIN. Moving
 * goods between one registration's places of business is not a supply, so there is no tax
 * invoice, but the goods still travel under a delivery challan (Rule 55(1)(c), "other than by way
 * of supply") and need an e-way bill above Rs 50,000 (Rule 138). The challan is numbered from the
 * sending branch's challan series, carries the transfer cost as value and no tax, and is created
 * as sent: the transfer moves the stock, the challan is paperwork only.
 *
 * Returns the challan id, or null when the transfer is billed with an inter-branch invoice
 * instead (different GSTINs) or already has a challan. Must run inside the dispatch transaction.
 */
export async function issueTransferChallan(
  client: Queryable,
  transfer: {
    id: string;
    business_id: string;
    transfer_number: string;
    from_location_id: string;
    to_location_id: string;
    inter_branch_invoice_id?: string | null;
  },
  opts: { date: string; createdBy?: string | null }
): Promise<string | null> {
  if (transfer.inter_branch_invoice_id) return null;
  const existing = await client.query(
    `SELECT id FROM delivery_challans WHERE stock_transfer_id = $1 AND business_id = $2 AND status <> 'cancelled'`,
    [transfer.id, transfer.business_id]
  );
  if (existing.rows[0]) return existing.rows[0].id;

  const businessId = transfer.business_id;
  const [from, to] = await Promise.all([
    loadTransferGodown(client, businessId, transfer.from_location_id),
    loadTransferGodown(client, businessId, transfer.to_location_id),
  ]);
  if (!from || !to) throw new Error('Transfer godown not found');

  const fromBranchId = await resolveDocumentBranchId(client, businessId, from.branch_id);
  const toBranchId = to.branch_id ? await resolveDocumentBranchId(client, businessId, to.branch_id) : fromBranchId;
  const [fromReg, toReg] = await Promise.all([
    resolveSupplierRegistration(client as any, businessId, fromBranchId),
    resolveSupplierRegistration(client as any, businessId, toBranchId),
  ]);
  // Different registrations are distinct persons: that move is a supply, billed by inter-branch invoice.
  if (fromReg.gstin && toReg.gstin && fromReg.gstin !== toReg.gstin) return null;

  const lines = (
    await client.query(
      `SELECT sti.item_id, COALESCE(NULLIF(sti.quantity_dispatched, 0), sti.quantity_requested, sti.qty) AS qty,
              sti.cost_snapshot, i.unit, i.name, i.hsn_sac, i.purchase_price
         FROM stock_transfer_items sti JOIN items i ON i.id = sti.item_id
        WHERE sti.transfer_id = $1 ORDER BY i.name`,
      [transfer.id]
    )
  ).rows.filter((l) => Number(l.qty) > 0);
  if (lines.length === 0) return null;

  const consignee = await getOrCreateBranchCustomer(businessId, toBranchId as string, client as PoolClient);
  const challan = await writeChallan(client, businessId, {
    customer_id: consignee,
    branch_id: fromBranchId,
    auto_number: true,
    challan_date: opts.date,
    challan_kind: 'supply',
    reason_for_transportation: 'own_use',
    place_of_supply_state_code: fromReg.stateCode,
    dispatch_from_address: godownAddress(from),
    shipping_address: godownAddress(to),
    place_of_delivery: to.city || to.name,
    warehouse_id: from.id,
    notes: `Stock transfer ${transfer.transfer_number} from ${from.name} to ${to.name}. Movement between places of business on the same GSTIN, not a supply; no tax charged.`,
    items: lines.map((l) => ({
      item_id: l.item_id,
      item_name: l.name,
      hsn_sac: l.hsn_sac,
      qty: l.qty,
      // Transfers move base units; the item's own unit keeps the challan (and e-way) quantity 1:1.
      unit: l.unit,
      unit_price: Number(l.cost_snapshot) || Number(l.purchase_price) || 0,
      tax_rate: 0,
    })),
    status: 'sent',
    created_by: opts.createdBy ?? null,
  });
  await client.query(`UPDATE delivery_challans SET stock_transfer_id = $1 WHERE id = $2`, [transfer.id, challan.id]);
  return challan.id;
}
