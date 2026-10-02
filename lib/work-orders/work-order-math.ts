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

export function canConvertToInvoice(wo: { status?: string | null; converted_invoice_id?: string | null }): boolean {
  return wo.status === 'completed' && !wo.converted_invoice_id;
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
