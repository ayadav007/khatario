import { stateCodeFromName } from '@/lib/gst/registration';
import { gstRateError } from '@/lib/gst/rates';
import {
  issueSeriesNumber,
  peekSeriesNumber,
  resolveDocumentBranchId,
  WORK_ORDER_SERIES,
  type Queryable,
} from '@/lib/documents/series-number';
import type { SourceLine } from '@/lib/invoices/convert-to-invoice';
import {
  computeWorkOrderCosts,
  DEFAULT_LABOR_SAC,
  DEFAULT_LABOR_TAX_RATE,
  WORK_ORDER_PRIORITIES,
  type WorkOrderLineInput,
} from '@/lib/work-orders/work-order-math';

export * from '@/lib/work-orders/work-order-math';

export class WorkOrderInputError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

/** Number the next work order would get, without reserving it. */
export async function peekWorkOrderNumber(db: Queryable, businessId: string, branchId?: string | null) {
  return peekSeriesNumber(db, WORK_ORDER_SERIES, businessId, branchId);
}

export interface WorkOrderWriteInput {
  customer_id?: string | null;
  branch_id?: string | null;
  work_order_number?: string | null;
  /** True when the number in the form is the suggested one: the server issues the next free number. */
  auto_number?: boolean;
  work_order_date?: string;
  scheduled_start_date?: string | null;
  scheduled_end_date?: string | null;
  work_description?: string;
  work_location?: string | null;
  assigned_to?: string | null;
  priority?: string;
  labor_cost?: number | string;
  other_cost?: number | string;
  labor_sac?: string | null;
  labor_tax_rate?: number | string | null;
  estimated_hours?: number | string | null;
  actual_hours?: number | string | null;
  place_of_supply_state_code?: string | null;
  notes?: string | null;
  terms?: string | null;
  status?: string;
  items?: WorkOrderLineInput[];
}

const optionalNumber = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new WorkOrderInputError('Hours must be a positive number');
  return n;
};

/**
 * Create (no `existingId`) or replace a work order and its materials. Must run inside a
 * transaction. Costs are recomputed here; the client's figures are only a preview.
 */
export async function writeWorkOrder(
  client: Queryable,
  businessId: string,
  input: WorkOrderWriteInput,
  opts: { existingId?: string; userId?: string | null } = {}
): Promise<any> {
  const { existingId } = opts;
  const date = input.work_order_date ? String(input.work_order_date).slice(0, 10) : '';
  if (!date) throw new WorkOrderInputError('Work order date is required');
  const description = String(input.work_description || '').trim();
  if (!description) throw new WorkOrderInputError('Describe the work to be done');
  const start = input.scheduled_start_date ? String(input.scheduled_start_date).slice(0, 10) : null;
  const end = input.scheduled_end_date ? String(input.scheduled_end_date).slice(0, 10) : null;
  if (start && end && end < start) {
    throw new WorkOrderInputError('Scheduled end date cannot be before the start date');
  }
  const priority = (WORK_ORDER_PRIORITIES as readonly string[]).includes(String(input.priority))
    ? String(input.priority)
    : 'medium';

  let customerId: string | null = input.customer_id || null;
  let customerState: { state_code?: string | null; state?: string | null } | undefined;
  if (customerId) {
    const c = await client.query(
      'SELECT id, state, state_code FROM customers WHERE id = $1 AND business_id = $2',
      [customerId, businessId]
    );
    if (!c.rows[0]) throw new WorkOrderInputError('Customer not found');
    customerState = c.rows[0];
    customerId = c.rows[0].id;
  }

  const branchId = await resolveDocumentBranchId(client, businessId, input.branch_id);
  const posCode = input.place_of_supply_state_code
    ? String(input.place_of_supply_state_code).padStart(2, '0')
    : customerState?.state_code || stateCodeFromName(customerState?.state) || null;

  const { lines, costs } = computeWorkOrderCosts(input.items || [], input.labor_cost, input.other_cost);
  if (costs.total_cost <= 0 && lines.length === 0) {
    throw new WorkOrderInputError('Enter the labour cost or add materials');
  }

  const laborTaxRate =
    input.labor_tax_rate === null || input.labor_tax_rate === undefined || input.labor_tax_rate === ''
      ? DEFAULT_LABOR_TAX_RATE
      : Number(input.labor_tax_rate);
  for (const [label, rate] of [
    ['Labour', laborTaxRate],
    ...lines.map((l) => [l.item_name, l.tax_rate] as const),
  ] as const) {
    const err = gstRateError(rate, date);
    if (err) throw new WorkOrderInputError(`${label}: ${err}`);
  }
  const laborSac = String(input.labor_sac ?? DEFAULT_LABOR_SAC).trim() || null;

  let number = String(input.work_order_number || '').trim();
  if (!existingId && (input.auto_number || !number)) {
    number = await issueSeriesNumber(client, WORK_ORDER_SERIES, businessId, branchId);
  }
  if (!number) throw new WorkOrderInputError('Work order number is required');

  const values = [
    businessId,
    customerId,
    number,
    date,
    start,
    end,
    description,
    input.work_location || null,
    input.assigned_to || null,
    costs.labor_cost,
    costs.material_cost,
    costs.other_cost,
    costs.total_cost,
    optionalNumber(input.estimated_hours),
    priority,
    input.notes || null,
    input.terms || null,
    branchId,
    posCode,
    laborSac,
    laborTaxRate,
  ];

  let workOrder: any;
  if (existingId) {
    const res = await client.query(
      `UPDATE work_orders SET
         customer_id = $2, work_order_number = $3, work_order_date = $4, scheduled_start_date = $5,
         scheduled_end_date = $6, work_description = $7, work_location = $8, assigned_to = $9,
         labor_cost = $10, material_cost = $11, other_cost = $12, total_cost = $13, estimated_hours = $14,
         priority = $15, notes = $16, terms = $17, branch_id = $18, place_of_supply_state_code = $19,
         labor_sac = $20, labor_tax_rate = $21, actual_hours = COALESCE($23, actual_hours)
       WHERE id = $22 AND business_id = $1
       RETURNING *`,
      [...values, existingId, optionalNumber(input.actual_hours)]
    );
    workOrder = res.rows[0];
    if (!workOrder) throw new WorkOrderInputError('Work order not found', 404);
    await client.query('DELETE FROM work_order_items WHERE work_order_id = $1', [existingId]);
  } else {
    const status = input.status === 'scheduled' ? 'scheduled' : 'draft';
    const res = await client.query(
      `INSERT INTO work_orders (
         business_id, customer_id, work_order_number, work_order_date, scheduled_start_date,
         scheduled_end_date, work_description, work_location, assigned_to, labor_cost, material_cost,
         other_cost, total_cost, estimated_hours, priority, notes, terms, branch_id,
         place_of_supply_state_code, labor_sac, labor_tax_rate, created_by, status
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
       RETURNING *`,
      [...values, opts.userId || null, status]
    );
    workOrder = res.rows[0];
  }

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    await client.query(
      `INSERT INTO work_order_items (
         work_order_id, item_id, item_name, description, hsn_sac, qty, unit, unit_price, total_cost,
         tax_rate, sort_order
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [workOrder.id, l.item_id, l.item_name, l.description, l.hsn_sac, l.qty, l.unit, l.unit_price, l.total_cost, l.tax_rate, i]
    );
  }

  return workOrder;
}

/** Invoice lines for a completed work order: its materials, then labour and other charges. */
export function buildWorkOrderInvoiceLines(wo: any, items: any[]): SourceLine[] {
  const lines: SourceLine[] = items
    .filter((r) => Number(r.qty) > 0)
    .map((r) => ({
      item_id: r.item_id,
      item_name: r.item_name,
      description: r.description,
      hsn_sac: r.hsn_sac,
      quantity: Number(r.used_qty) > 0 ? r.used_qty : r.qty,
      unit: r.unit,
      unit_price: r.unit_price,
      tax_rate: r.tax_rate,
    }));
  const sac = wo.labor_sac || DEFAULT_LABOR_SAC;
  const rate = wo.labor_tax_rate ?? DEFAULT_LABOR_TAX_RATE;
  if (Number(wo.labor_cost) > 0) {
    lines.push({
      item_name: 'Labour charges',
      description: `Work order ${wo.work_order_number}: ${String(wo.work_description || '').slice(0, 400)}`,
      hsn_sac: sac,
      quantity: 1,
      unit: 'NOS',
      unit_price: wo.labor_cost,
      tax_rate: rate,
    });
  }
  if (Number(wo.other_cost) > 0) {
    lines.push({
      item_name: 'Other charges',
      description: `Work order ${wo.work_order_number}`,
      hsn_sac: sac,
      quantity: 1,
      unit: 'NOS',
      unit_price: wo.other_cost,
      tax_rate: rate,
    });
  }
  return lines;
}
