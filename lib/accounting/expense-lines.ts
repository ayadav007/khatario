import type { PoolClient } from 'pg';
import { getPool } from '@/lib/db';
import { ExpenseValidationError, type ExpensePostingIdentity } from '@/lib/accounting/expense-posting';
import { gstRateError } from '@/lib/gst/rates';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ExpenseItemType = 'goods' | 'service';

export type ComputedExpenseLine = {
  lineNo: number;
  expenseItemId: string;
  itemName: string;
  itemType: ExpenseItemType;
  unit: string | null;
  hsnSac: string | null;
  quantity: string;
  unitPrice: string;
  taxRate: string;
  taxableValue: string;
  cgst: string;
  sgst: string;
  igst: string;
  lineTotal: string;
};

export type ExpenseLineBill = {
  pricesIncludeGst: boolean;
  intraState: boolean;
  lines: ComputedExpenseLine[];
  amount: number;
  cgst: number;
  sgst: number;
  igst: number;
  hashLines: NonNullable<ExpensePostingIdentity['lines']>;
};

type ItemRow = {
  id: string;
  name: string;
  item_type: string;
  unit: string | null;
  hsn_sac: string | null;
  is_active: boolean;
};

function divRound(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new ExpenseValidationError('Could not calculate this expense line.');
  const negative = numerator < 0n;
  const value = negative ? -numerator : numerator;
  const quotient = value / denominator;
  const remainder = value % denominator;
  const rounded = remainder * 2n >= denominator ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
}

/** Half away from zero, to `scale` decimal places. Extra digits past scale+1 are rejected. */
export function parseScaled(raw: unknown, scale: number): bigint | null {
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return null;
    raw = String(raw);
  }
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  const text = String(raw).trim();
  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  const [whole, fraction = ''] = text.split('.');
  if (fraction.length > scale + 1) return null;
  const padded = (fraction + '0'.repeat(scale + 1)).slice(0, scale + 1);
  const base = BigInt(whole) * 10n ** BigInt(scale) + BigInt(padded.slice(0, scale) || '0');
  const extra = BigInt(padded[scale] || '0');
  return base + (extra >= 5n ? 1n : 0n);
}

function formatScaled(value: bigint, scale: number): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const factor = 10n ** BigInt(scale);
  const whole = absolute / factor;
  const fraction = (absolute % factor).toString().padStart(scale, '0');
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

function stateCode(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  if (/^\d{2}/.test(text)) return text.slice(0, 2);
  return null;
}

export function gstinState(gstin: string | null | undefined): string | null {
  const text = gstin?.trim().toUpperCase() ?? '';
  return /^\d{2}/.test(text) ? text.slice(0, 2) : null;
}

type RawLine = { expense_item_id?: unknown; quantity?: unknown; unit_price?: unknown; tax_rate?: unknown };

/**
 * Totals for one expense bill. The header amount is GST-inclusive unless the bill is reverse charge,
 * in which case it is the taxable value and the GST is stored beside it.
 * CGST takes half of the tax, rounded half away from zero. SGST is the remainder, so the heads sum to the tax.
 */
export function computeExpenseLineBill(input: {
  pricesIncludeGst: boolean;
  intraState: boolean;
  isReverseCharge: boolean;
  expenseDate: string;
  rows: Array<RawLine & ItemRow>;
}): ExpenseLineBill {
  if (input.rows.length === 0) throw new ExpenseValidationError('Add at least one expense item.');
  if (input.rows.length > 100) throw new ExpenseValidationError('An expense bill can have at most 100 lines.');

  let taxable = 0n;
  let cgst = 0n;
  let sgst = 0n;
  let igst = 0n;
  let gross = 0n;
  const lines: ComputedExpenseLine[] = [];

  input.rows.forEach((row, index) => {
    const quantity = parseScaled(row.quantity, 3);
    const unitPrice = parseScaled(row.unit_price, 2);
    const rate = parseScaled(row.tax_rate, 2);
    if (quantity == null || quantity <= 0n) throw new ExpenseValidationError(`Line ${index + 1} needs a quantity greater than zero.`);
    if (quantity > 999_999_999_999n) throw new ExpenseValidationError(`Line ${index + 1} quantity is too large.`);
    if (unitPrice == null || unitPrice < 0n) throw new ExpenseValidationError(`Line ${index + 1} needs a rate.`);
    if (rate == null) throw new ExpenseValidationError(`Line ${index + 1} needs a GST percent.`);
    const rateText = formatScaled(rate, 2);
    const rateError = gstRateError(Number(rateText), input.expenseDate);
    if (rateError) throw new ExpenseValidationError(`Line ${index + 1}: ${rateError}`);
    if (row.item_type !== 'goods' && row.item_type !== 'service') {
      throw new ExpenseValidationError(`Line ${index + 1} must be goods or a service.`);
    }

    const entered = divRound(quantity * unitPrice, 1000n);
    const rateScaled = rate;
    const tax = input.pricesIncludeGst
      ? divRound(entered * rateScaled, 10000n + rateScaled)
      : divRound(entered * rateScaled, 10000n);
    const lineTaxable = input.pricesIncludeGst ? entered - tax : entered;
    const lineGross = lineTaxable + tax;
    let lineCgst = 0n;
    let lineSgst = 0n;
    let lineIgst = 0n;
    if (tax > 0n) {
      if (input.intraState) {
        lineCgst = divRound(tax, 2n);
        lineSgst = tax - lineCgst;
      } else {
        lineIgst = tax;
      }
    }

    taxable += lineTaxable;
    cgst += lineCgst;
    sgst += lineSgst;
    igst += lineIgst;
    gross += lineGross;
    lines.push({
      lineNo: index + 1,
      expenseItemId: row.id,
      itemName: row.name.trim(),
      itemType: row.item_type,
      unit: row.unit,
      hsnSac: row.hsn_sac,
      quantity: formatScaled(quantity, 3),
      unitPrice: formatScaled(unitPrice, 2),
      taxRate: rateText,
      taxableValue: formatScaled(lineTaxable, 2),
      cgst: formatScaled(lineCgst, 2),
      sgst: formatScaled(lineSgst, 2),
      igst: formatScaled(lineIgst, 2),
      lineTotal: formatScaled(lineGross, 2),
    });
  });

  const header = input.isReverseCharge ? taxable : gross;
  if (header <= 0n) throw new ExpenseValidationError('Amount must be greater than zero');
  const amount = Number(formatScaled(header, 2));
  const cgstAmount = Number(formatScaled(cgst, 2));
  const sgstAmount = Number(formatScaled(sgst, 2));
  const igstAmount = Number(formatScaled(igst, 2));
  return {
    pricesIncludeGst: input.pricesIncludeGst,
    intraState: input.intraState,
    lines,
    amount,
    cgst: cgstAmount,
    sgst: sgstAmount,
    igst: igstAmount,
    hashLines: lines.map((line) => ({
      line_no: line.lineNo,
      expense_item_id: line.expenseItemId,
      item_name: line.itemName,
      item_type: line.itemType,
      quantity: line.quantity,
      unit_price: line.unitPrice,
      tax_rate: line.taxRate,
      taxable: line.taxableValue,
      cgst: line.cgst,
      sgst: line.sgst,
      igst: line.igst,
      line_total: line.lineTotal,
    })),
  };
}

export async function loadExpenseSupplyStates(
  businessId: string,
  supplierId: string | null,
  supplierGstin: string | null
): Promise<{ businessState: string | null; supplierState: string | null }> {
  const pool = getPool();
  const business = await pool.query<{ state_code: string | null; gstin: string | null }>(
    `SELECT state_code, gstin FROM businesses WHERE id = $1`,
    [businessId]
  );
  const businessRow = business.rows[0];
  let supplierState: string | null = null;
  if (supplierId && UUID_RE.test(supplierId)) {
    const supplier = await pool.query<{ state_code: string | null; gstin: string | null }>(
      `SELECT state_code, gstin FROM suppliers WHERE id = $1 AND business_id = $2 AND is_active = true`,
      [supplierId, businessId]
    );
    const row = supplier.rows[0];
    if (!row) throw new ExpenseValidationError('Invalid supplier for this business (or supplier is inactive).');
    supplierState = stateCode(row.state_code) || gstinState(row.gstin);
  }
  return {
    businessState: stateCode(businessRow?.state_code) || gstinState(businessRow?.gstin),
    supplierState: supplierState || gstinState(supplierGstin),
  };
}

export async function buildExpenseBillFromLines(input: {
  businessId: string;
  lines: unknown;
  pricesIncludeGst: boolean;
  isReverseCharge: boolean;
  expenseDate: string;
  businessState: string | null;
  supplierState: string | null;
}): Promise<ExpenseLineBill> {
  if (!Array.isArray(input.lines)) throw new ExpenseValidationError('Expense lines are missing.');
  const drafts: RawLine[] = input.lines.map((line) => (line && typeof line === 'object' ? (line as RawLine) : {}));
  const ids = [
    ...new Set(
      drafts
        .map((line) => (line.expense_item_id == null ? '' : String(line.expense_item_id).trim()))
        .filter((id) => UUID_RE.test(id))
    ),
  ];
  const found = ids.length
    ? (
        await getPool().query<ItemRow>(
          `SELECT id, name, item_type, unit, hsn_sac, is_active
             FROM expense_items
            WHERE business_id = $1 AND id = ANY($2::uuid[])`,
          [input.businessId, ids]
        )
      ).rows
    : [];
  const byId = new Map(found.map((row) => [row.id, row]));
  const rows = drafts.map((line, index) => {
    const id = line.expense_item_id == null ? '' : String(line.expense_item_id).trim();
    const item = byId.get(id);
    if (!item || item.is_active === false) {
      throw new ExpenseValidationError(`Line ${index + 1} uses an expense item that is not on this business list.`);
    }
    return { ...line, ...item, tax_rate: line.tax_rate };
  });
  const needsTax = rows.some((row) => {
    const rate = parseScaled(row.tax_rate, 2);
    return rate != null && rate > 0n;
  });
  const businessState = stateCode(input.businessState);
  const supplierState = stateCode(input.supplierState);
  if (needsTax && (!businessState || !supplierState)) {
    throw new ExpenseValidationError(
      'Select a supplier with a state or GSTIN, and set the business state, so the bill can split CGST and IGST.'
    );
  }
  return computeExpenseLineBill({
    pricesIncludeGst: input.pricesIncludeGst,
    intraState: !needsTax || businessState === supplierState,
    isReverseCharge: input.isReverseCharge,
    expenseDate: input.expenseDate,
    rows,
  });
}

export async function replaceExpenseLines(
  client: PoolClient,
  businessId: string,
  expenseId: string,
  lines: ComputedExpenseLine[]
): Promise<void> {
  await client.query(`DELETE FROM expense_lines WHERE expense_id = $1 AND business_id = $2`, [expenseId, businessId]);
  for (const line of lines) {
    await client.query(
      `INSERT INTO expense_lines (
         expense_id, business_id, expense_item_id, line_no, item_name, item_type, unit, hsn_sac,
         quantity, unit_price, tax_rate, taxable_value, cgst_amount, sgst_amount, igst_amount, line_total
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [
        expenseId,
        businessId,
        line.expenseItemId,
        line.lineNo,
        line.itemName,
        line.itemType,
        line.unit,
        line.hsnSac,
        line.quantity,
        line.unitPrice,
        line.taxRate,
        line.taxableValue,
        line.cgst,
        line.sgst,
        line.igst,
        line.lineTotal,
      ]
    );
  }
}
