import type { SourceLine } from '@/lib/invoices/convert-to-invoice';

export const WORK_ORDER_STATUSES = ['draft', 'scheduled', 'in_progress', 'completed', 'cancelled'] as const;
export type WorkOrderStatus = (typeof WORK_ORDER_STATUSES)[number];

export const WORK_ORDER_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;

/** Allowed moves between statuses; completed and cancelled are final. */
const TRANSITIONS: Record<WorkOrderStatus, WorkOrderStatus[]> = {
  draft: ['scheduled', 'in_progress', 'cancelled'],
  scheduled: ['in_progress', 'cancelled'],
  in_progress: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

export function canTransition(from: string, to: string): boolean {
  return (TRANSITIONS[from as WorkOrderStatus] || []).includes(to as WorkOrderStatus);
}

export function isWorkOrderEditable(status: string): boolean {
  return status === 'draft' || status === 'scheduled' || status === 'in_progress';
}

export function canConvertToInvoice(wo: {
  status?: string | null;
  converted_invoice_id?: string | null;
  converted_invoice_status?: string | null;
}): boolean {
  if (wo.status !== 'completed') return false;
  if (!wo.converted_invoice_id) return true;
  return wo.converted_invoice_status === 'cancelled';
}

export const STATUS_LABELS: Record<WorkOrderStatus, string> = {
  draft: 'Draft',
  scheduled: 'Scheduled',
  in_progress: 'In Progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

/** SAC heading for maintenance, repair and installation services. */
export const DEFAULT_LABOR_SAC = '9987';
export const DEFAULT_LABOR_TAX_RATE = 18;

export interface WorkOrderLineInput {
  item_id?: string | null;
  item_name?: string;
  name?: string;
  description?: string | null;
  hsn_sac?: string | null;
  qty?: number | string;
  quantity?: number | string;
  unit?: string | null;
  unit_price?: number | string;
  tax_rate?: number | string;
}

export interface WorkOrderLine {
  item_id: string | null;
  item_name: string;
  description: string | null;
  hsn_sac: string | null;
  qty: number;
  unit: string;
  unit_price: number;
  tax_rate: number;
  total_cost: number;
}

export interface WorkOrderCosts {
  labor_cost: number;
  material_cost: number;
  other_cost: number;
  /** Before GST: tax is charged on the invoice raised when the work is done. */
  total_cost: number;
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export function computeWorkOrderCosts(
  items: WorkOrderLineInput[],
  labor: unknown,
  other: unknown
): { lines: WorkOrderLine[]; costs: WorkOrderCosts } {
  const lines: WorkOrderLine[] = items
    .map((it) => {
      const qty = num(it.qty ?? it.quantity);
      const unitPrice = Math.max(0, num(it.unit_price));
      return {
        item_id: it.item_id || null,
        item_name: String(it.item_name || it.name || '').trim(),
        description: it.description || null,
        hsn_sac: it.hsn_sac || null,
        qty,
        unit: it.unit || 'PCS',
        unit_price: unitPrice,
        tax_rate: Math.max(0, num(it.tax_rate)),
        total_cost: r2(qty * unitPrice),
      };
    })
    .filter((l) => l.item_name && l.qty > 0);

  const labor_cost = r2(Math.max(0, num(labor)));
  const other_cost = r2(Math.max(0, num(other)));
  const material_cost = r2(lines.reduce((s, l) => s + l.total_cost, 0));
  return {
    lines,
    costs: { labor_cost, material_cost, other_cost, total_cost: r2(labor_cost + material_cost + other_cost) },
  };
}

/** Lines a work order would bill, before any invoice is saved. Prices stay as entered; GST is on each line. */
export function workOrderInvoiceLineDrafts(
  wo: {
    work_order_number?: string | null;
    work_description?: string | null;
    labor_cost?: unknown;
    other_cost?: unknown;
    labor_sac?: string | null;
    labor_tax_rate?: unknown;
  },
  items: Array<{
    item_id?: string | null;
    item_name?: string;
    description?: string | null;
    hsn_sac?: string | null;
    qty?: unknown;
    used_qty?: unknown;
    unit?: string | null;
    unit_price?: unknown;
    tax_rate?: unknown;
  }>,
): SourceLine[] {
  const lines: SourceLine[] = items
    .filter((r) => num(r.qty) > 0)
    .map((r) => ({
      item_id: r.item_id || null,
      item_name: r.item_name || '',
      description: r.description || null,
      hsn_sac: r.hsn_sac || null,
      quantity: num(r.used_qty) > 0 ? num(r.used_qty) : num(r.qty),
      unit: r.unit || 'PCS',
      unit_price: num(r.unit_price),
      tax_rate: num(r.tax_rate),
    }));
  const sac = wo.labor_sac || DEFAULT_LABOR_SAC;
  const rate = wo.labor_tax_rate ?? DEFAULT_LABOR_TAX_RATE;
  if (num(wo.labor_cost) > 0) {
    lines.push({
      item_id: null,
      item_name: 'Labour charges',
      description: `Work order ${wo.work_order_number || ''}: ${String(wo.work_description || '').slice(0, 400)}`,
      hsn_sac: sac,
      quantity: 1,
      unit: 'NOS',
      unit_price: num(wo.labor_cost),
      tax_rate: num(rate),
    });
  }
  if (num(wo.other_cost) > 0) {
    lines.push({
      item_id: null,
      item_name: 'Other charges',
      description: `Work order ${wo.work_order_number || ''}`,
      hsn_sac: sac,
      quantity: 1,
      unit: 'NOS',
      unit_price: num(wo.other_cost),
      tax_rate: num(rate),
    });
  }
  return lines;
}
