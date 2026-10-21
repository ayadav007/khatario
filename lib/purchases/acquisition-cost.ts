import { calculatePurchaseLine } from '@/lib/purchase-gst-calculator';
import { gstRateError } from '@/lib/gst/rates';

export class AcquisitionCostError extends Error {
  constructor(
    message: string,
    public code: string
  ) {
    super(message);
    this.name = 'AcquisitionCostError';
  }
}

export type ChargeClassification = 'incidental_to_goods' | 'independent_service';

export interface PurchaseChargeInput {
  purpose?: string | null;
  amount?: number | null;
  classification?: string | null;
  hsn_sac?: string | null;
  tax_rate?: number | null;
  itc_eligible?: boolean | null;
}

export interface CostLineInput {
  taxable: number;
  tax: number;
  cess: number;
  quantity: number;
  stock: boolean;
  capital: boolean;
}

export interface ComputedCharge {
  purpose: string | null;
  classification: ChargeClassification;
  hsnSac: string | null;
  taxRate: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  tax: number;
}

export interface AllocationRow {
  chargeIndex: number;
  lineIndex: number;
  amount: number;
}

export interface AcquisitionPlan {
  charges: ComputedCharge[];
  /** Null means the line keeps the historical fallback (taxable value). */
  lineCosts: Array<number | null>;
  allocations: AllocationRow[];
  capitalized: boolean;
  subtotal: number;
  cgst: number;
  sgst: number;
  igst: number;
  tax: number;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function parsePurchaseCharges(raw: unknown, billItcEligible: boolean, billDate: string | null): PurchaseChargeInput[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) {
    throw new AcquisitionCostError('Charges must be a list', 'CHARGE_UNCLASSIFIED');
  }
  return raw.map((row) => {
    const charge = row as PurchaseChargeInput;
    if (charge.itc_eligible != null && charge.itc_eligible !== billItcEligible) {
      throw new AcquisitionCostError(
        'A charge cannot have a different ITC eligibility from the bill. Split blocked and eligible supplies onto separate bills.',
        'ITC_ELIGIBILITY_MISMATCH'
      );
    }
    const amount = Number(charge.amount) || 0;
    if (amount > 0.004 && charge.classification !== 'incidental_to_goods' && charge.classification !== 'independent_service') {
      throw new AcquisitionCostError(
        'A purchase charge must be classified as incidental to the goods or an independent service.',
        'CHARGE_UNCLASSIFIED'
      );
    }
    const rate = Number(charge.tax_rate) || 0;
    const rateError = gstRateError(rate, billDate);
    if (amount > 0.004 && rateError) {
      throw new AcquisitionCostError(rateError, 'INVALID_GST_RATE');
    }
    return charge;
  });
}

/** Split `amount` by positive weights. The last positive weight receives the paise remainder. */
export function allocateByWeight(amount: number, weights: number[]): number[] {
  const out = weights.map(() => 0);
  const indexes = weights.map((w, i) => (w > 0.004 ? i : -1)).filter((i) => i >= 0);
  if (indexes.length === 0) {
    throw new AcquisitionCostError(
      'Incidental freight cannot be allocated because no stock or capital line has a taxable value.',
      'CHARGE_NOT_APPORTIONABLE'
    );
  }
  const total = indexes.reduce((sum, i) => sum + weights[i], 0);
  let used = 0;
  indexes.forEach((line, position) => {
    if (position === indexes.length - 1) {
      out[line] = round2(amount - used);
    } else {
      const share = round2((amount * weights[line]) / total);
      out[line] = share;
      used = round2(used + share);
    }
  });
  return out;
}

export function planAcquisitionCosts(args: {
  lines: CostLineInput[];
  charges: PurchaseChargeInput[];
  itcEligible: boolean;
  /** Perpetual stock bills capitalize. Periodic bills and supplier credit notes do not. */
  capitalize: boolean;
  intraState: boolean;
  billDate: string | null;
}): AcquisitionPlan {
  const charges = parsePurchaseCharges(args.charges, args.itcEligible, args.billDate)
    .filter((c) => (Number(c.amount) || 0) > 0.004)
    .map((c) => {
      const computed = calculatePurchaseLine(
        {
          quantity: 1,
          unitPrice: Number(c.amount) || 0,
          discountPercent: 0,
          discountAmount: 0,
          gstRate: Number(c.tax_rate) || 0,
          taxMode: 'exclusive',
        },
        args.intraState
      );
      return {
        purpose: c.purpose?.trim() || null,
        classification: c.classification as ChargeClassification,
        hsnSac: c.hsn_sac?.trim() || null,
        taxRate: Number(c.tax_rate) || 0,
        taxable: computed.taxableValue,
        cgst: computed.cgstAmount,
        sgst: computed.sgstAmount,
        igst: computed.igstAmount,
        tax: computed.taxAmount,
      };
    });

  const weights = args.lines.map((line) => (line.stock || line.capital ? line.taxable : 0));
  const allocations: AllocationRow[] = [];
  const added = args.lines.map(() => 0);
  let capitalized = false;

  for (let chargeIndex = 0; chargeIndex < charges.length; chargeIndex++) {
    const charge = charges[chargeIndex];
    if (charge.classification !== 'incidental_to_goods' || !args.capitalize) continue;
    const pool = args.itcEligible ? charge.taxable : round2(charge.taxable + charge.tax);
    const shares = allocateByWeight(pool, weights);
    shares.forEach((amount, lineIndex) => {
      if (amount <= 0.004) return;
      allocations.push({ chargeIndex, lineIndex, amount });
      added[lineIndex] = round2(added[lineIndex] + amount);
    });
    capitalized = true;
  }

  const lineCosts = args.lines.map((line, index) => {
    if (!args.capitalize || (!line.stock && !line.capital)) return null;
    const own = args.itcEligible ? line.taxable : round2(line.taxable + line.tax + line.cess);
    return round2(own + added[index]);
  });

  return {
    charges,
    lineCosts,
    allocations,
    capitalized,
    subtotal: round2(charges.reduce((sum, c) => sum + c.taxable, 0)),
    cgst: round2(charges.reduce((sum, c) => sum + c.cgst, 0)),
    sgst: round2(charges.reduce((sum, c) => sum + c.sgst, 0)),
    igst: round2(charges.reduce((sum, c) => sum + c.igst, 0)),
    tax: round2(charges.reduce((sum, c) => sum + c.tax, 0)),
  };
}

/** The acquisition cost, or freight allocation, removed by this return quantity. */
export function nextCostShare(total: number, originalQty: number, priorQuantities: number[], returnQty: number): number {
  const shares = costShare(total, originalQty, [...priorQuantities, returnQty]);
  return shares[shares.length - 1] || 0;
}

/** Sequential paise split. The slice that finishes the quantity takes the remainder. */
export function costShare(total: number, originalQty: number, quantities: number[]): number[] {
  let leftQty = originalQty;
  let leftCost = round2(total);
  return quantities.map((qty) => {
    const last = qty >= leftQty - 1e-9;
    const share = last || originalQty <= 0 ? leftCost : round2((total * qty) / originalQty);
    leftCost = round2(leftCost - share);
    leftQty -= qty;
    return share;
  });
}
