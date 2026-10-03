import type { PoolClient } from 'pg';
import {
  createInvoiceInTransaction,
  type CreateInvoiceItemInput,
  type CreateInvoiceResult,
} from '@/lib/invoices/invoice-create-service';
import type { InvoiceChannel } from '@/lib/invoices/channel';

export type SourceLine = {
  item_id?: string | null;
  variant_id?: string | null;
  item_name: string;
  description?: string | null;
  hsn_sac?: string | null;
  quantity: number | string;
  unit?: string | null;
  unit_price: number | string;
  discount_percent?: number | string | null;
  tax_rate?: number | string | null;
};

export function todayIsoDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Converts an order / estimate into a final tax invoice using the same service as
 * POST /api/invoices, so GST is recomputed server-side and stock, COGS and the
 * ledger are posted in the caller's transaction.
 */
export async function convertLinesToInvoice(
  client: PoolClient,
  p: {
    businessId: string;
    userId: string;
    branchId?: string | null;
    customerId: string | null;
    invoiceDate: string;
    placeOfSupplyStateCode?: string | null;
    billingAddress?: string | null;
    shippingAddress?: string | null;
    notes?: string | null;
    locationId?: string | null;
    lines: SourceLine[];
    channel?: InvoiceChannel;
    salesOrderId?: string | null;
  }
): Promise<CreateInvoiceResult> {
  const items: CreateInvoiceItemInput[] = p.lines.map((l) => ({
    item_id: l.item_id || null,
    variant_id: l.variant_id || null,
    item_name: l.item_name,
    description: l.description || null,
    hsn_sac: l.hsn_sac || null,
    quantity: Number(l.quantity) || 0,
    unit: l.unit || undefined,
    unit_price: Number(l.unit_price) || 0,
    discount_percent: Number(l.discount_percent) || 0,
    tax_rate: Number(l.tax_rate) || 0,
    location_id: p.locationId || null,
  }));
  return createInvoiceInTransaction(client, {
    business_id: p.businessId,
    created_by: p.userId,
    branch_id: p.branchId || undefined,
    customer_id: p.customerId,
    invoice_date: p.invoiceDate,
    status: 'final',
    document_type: 'tax_invoice',
    items,
    place_of_supply_state_code: p.placeOfSupplyStateCode || null,
    billing_address: p.billingAddress || null,
    shipping_address: p.shippingAddress || null,
    notes: p.notes || null,
    channel: p.channel,
    sales_order_id: p.salesOrderId ?? null,
  });
}
