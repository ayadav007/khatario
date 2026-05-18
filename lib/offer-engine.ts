/**
 * Pure offer application for invoice lines. Merges promo discounts into `discount_percent`
 * so downstream tax math (quantity × price, line discount, GST) stays unchanged.
 *
 * BOGO: default `quantity_semantics` = `total_units` (line qty includes free items). Optional
 * `paid_units_only`: line qty is paid units only; free units are added to `quantity` and the
 * same rupee discount is applied so stock matches delivered quantity.
 */

export type OfferRecord = {
  id: string;
  type: string;
  condition_json?: unknown;
  action_json?: unknown;
  priority?: number;
};

export type OfferStackingPolicy = 'sequential' | 'single_best_priority';

export type ApplyOffersOptions = {
  stackingPolicy?: OfferStackingPolicy;
};

export type OfferInvoiceItem = Record<string, unknown> & {
  item_id?: string | null;
  quantity: number;
  unit_price: number;
  discount_percent?: number;
};

export type AppliedOfferLine = {
  offerId: string;
  type: string;
  discountAmount: number;
  description?: string;
};

export type ApplyOffersResult = {
  items: OfferInvoiceItem[];
  appliedOffers: AppliedOfferLine[];
};

const round2 = (n: number) => Math.round(n * 100) / 100;

const toPaise = (rupees: number) => Math.round(rupees * 100);
const fromPaise = (paise: number) => paise / 100;

function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function lineSubtotal(item: OfferInvoiceItem): number {
  return Number(item.quantity) * Number(item.unit_price);
}

function lineSubtotalPaise(item: OfferInvoiceItem): number {
  const q = Number(item.quantity) || 0;
  const p = Number(item.unit_price) || 0;
  return Math.round(q * p * 100);
}

function lineDiscountAmount(item: OfferInvoiceItem): number {
  const sub = lineSubtotal(item);
  return (sub * (Number(item.discount_percent) || 0)) / 100;
}

function lineDiscountPaise(item: OfferInvoiceItem): number {
  const subP = lineSubtotalPaise(item);
  const pct = Number(item.discount_percent) || 0;
  return Math.round((subP * pct) / 100);
}

function lineTaxable(item: OfferInvoiceItem): number {
  return Math.max(0, round2(lineSubtotal(item) - lineDiscountAmount(item)));
}

function setDiscountFromPaise(items: OfferInvoiceItem[], index: number, discountPaise: number): void {
  const subP = lineSubtotalPaise(items[index]);
  if (subP <= 0) {
    items[index].discount_percent = 0;
    return;
  }
  const cap = Math.min(subP, Math.max(0, discountPaise));
  const pct = (cap / subP) * 100;
  items[index].discount_percent = round2(Math.min(100, pct));
}

function addLineDiscountPaise(items: OfferInvoiceItem[], index: number, extraDiscountPaise: number): void {
  if (extraDiscountPaise <= 0) return;
  const subP = lineSubtotalPaise(items[index]);
  if (subP <= 0) return;
  const current = lineDiscountPaise(items[index]);
  const newDisc = Math.min(subP, current + extraDiscountPaise);
  setDiscountFromPaise(items, index, newDisc);
}

function clampLine(item: OfferInvoiceItem): void {
  const sub = lineSubtotal(item);
  if (sub <= 0) {
    item.discount_percent = 0;
    return;
  }
  let pct = Number(item.discount_percent) || 0;
  pct = Math.max(0, Math.min(100, round2(pct)));
  item.discount_percent = pct;
  if (lineDiscountAmount(item) > sub + 1e-6) {
    item.discount_percent = 100;
  }
}

function finalizeSafety(items: OfferInvoiceItem[]): void {
  for (const row of items) {
    clampLine(row);
    if (lineTaxable(row) < 0) {
      row.discount_percent = 100;
    }
  }
}

type BillValueCondition = { min_bill: number };

function billTaxableSumPaise(items: OfferInvoiceItem[]): number {
  let s = 0;
  for (const row of items) {
    const subP = lineSubtotalPaise(row);
    const discP = lineDiscountPaise(row);
    s += Math.max(0, subP - discP);
  }
  return s;
}

/**
 * Distribute flat discount in paise; last line gets remainder so sum matches exactly.
 */
function distributeBillFlatPaise(items: OfferInvoiceItem[], amountPaise: number): number {
  if (amountPaise <= 0) return 0;
  const weights: number[] = items.map((r) => Math.max(0, lineSubtotalPaise(r) - lineDiscountPaise(r)));
  const T = weights.reduce((a, b) => a + b, 0);
  if (T <= 0) return 0;
  const target = Math.min(amountPaise, T);
  let allocated = 0;
  for (let i = 0; i < items.length; i++) {
    const isLast = i === items.length - 1;
    const share = isLast ? target - allocated : Math.floor((weights[i] * target) / T);
    addLineDiscountPaise(items, i, share);
    allocated += share;
  }
  if (allocated < target) {
    addLineDiscountPaise(items, items.length - 1, target - allocated);
  }
  return fromPaise(target);
}

function applyBillPercentPaise(items: OfferInvoiceItem[], percent: number): number {
  if (percent <= 0) return 0;
  let cutPaise = 0;
  for (let i = 0; i < items.length; i++) {
    const tP = Math.max(0, lineSubtotalPaise(items[i]) - lineDiscountPaise(items[i]));
    const lineCut = Math.round((tP * percent) / 100);
    cutPaise += lineCut;
    addLineDiscountPaise(items, i, lineCut);
  }
  return fromPaise(cutPaise);
}

function findLineIndexForItem(items: OfferInvoiceItem[], itemId: string): number {
  const id = String(itemId);
  return items.findIndex((r) => r.item_id != null && String(r.item_id) === id);
}

function applyBuyXGetY(
  items: OfferInvoiceItem[],
  itemId: string,
  buy: number,
  get: number,
  action: Record<string, unknown>
): number {
  if (buy <= 0 || get <= 0) return 0;
  const idx = findLineIndexForItem(items, itemId);
  if (idx < 0) return 0;
  const unit = Number(items[idx].unit_price) || 0;
  if (unit <= 0) return 0;
  const unitPaise = toPaise(unit);
  const semantics = String(action.quantity_semantics || 'total_units').toLowerCase();

  if (semantics === 'paid_units_only') {
    const paid = Number(items[idx].quantity) || 0;
    if (paid <= 0) return 0;
    const sets = Math.floor(paid / buy);
    const freeUnits = sets * get;
    if (freeUnits <= 0) return 0;
    const retainedPct = Number(items[idx].discount_percent) || 0;
    items[idx].quantity = paid + freeUnits;
    const subP = lineSubtotalPaise(items[idx]);
    const fromPct = Math.round((subP * retainedPct) / 100);
    const freeDiscP = Math.round(freeUnits * unitPaise);
    setDiscountFromPaise(items, idx, fromPct + freeDiscP);
    return fromPaise(freeDiscP);
  }

  const q = Number(items[idx].quantity) || 0;
  if (q <= 0) return 0;
  const group = buy + get;
  const sets = Math.floor(q / group);
  const freeUnits = sets * get;
  if (freeUnits <= 0) return 0;
  const discountPaise = Math.round(freeUnits * unitPaise);
  const cur = lineDiscountPaise(items[idx]);
  setDiscountFromPaise(items, idx, cur + discountPaise);
  return fromPaise(discountPaise);
}

// --- validation ---

export function validateOfferPayload(offer: OfferRecord): { ok: true } | { ok: false; reason: string } {
  const type = (offer.type || '').toLowerCase();
  const condition = asObj(offer.condition_json);
  const action = asObj(offer.action_json);

  if (type === 'percentage_discount' || type === 'percent_discount') {
    const pct = Number(action.percent);
    if (!Number.isFinite(pct) || pct <= 0 || pct > 100) {
      return { ok: false, reason: 'action.percent must be in (0, 100]' };
    }
    return { ok: true };
  }
  if (type === 'flat_discount') {
    const amt = Number(action.amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      return { ok: false, reason: 'action.amount must be > 0' };
    }
    return { ok: true };
  }
  if (type === 'buy_x_get_y') {
    const buy = Number(action.buy);
    const get = Number(action.get);
    const itemId = String(action.item_id || condition.item_id || '').trim();
    if (!itemId) return { ok: false, reason: 'item_id required in action or condition' };
    if (!Number.isFinite(buy) || buy <= 0) return { ok: false, reason: 'action.buy must be > 0' };
    if (!Number.isFinite(get) || get <= 0) return { ok: false, reason: 'action.get must be > 0' };
    const sem = String(action.quantity_semantics || 'total_units').toLowerCase();
    if (sem !== 'total_units' && sem !== 'paid_units_only') {
      return { ok: false, reason: 'quantity_semantics must be total_units or paid_units_only' };
    }
    return { ok: true };
  }
  if (type === 'bill_value_discount') {
    const minBill = Number(condition.min_bill);
    if (!Number.isFinite(minBill) || minBill <= 0) {
      return { ok: false, reason: 'condition.min_bill must be > 0' };
    }
    const hasPct = action.percent != null && String(action.percent).length > 0;
    const hasAmt = action.amount != null && String(action.amount).length > 0;
    if (hasPct === hasAmt) {
      return { ok: false, reason: 'exactly one of action.percent or action.amount required' };
    }
    if (hasPct) {
      const pct = Number(action.percent);
      if (!Number.isFinite(pct) || pct <= 0 || pct > 100) {
        return { ok: false, reason: 'action.percent must be in (0, 100]' };
      }
    } else {
      const amt = Number(action.amount);
      if (!Number.isFinite(amt) || amt <= 0) {
        return { ok: false, reason: 'action.amount must be > 0' };
      }
    }
    return { ok: true };
  }
  return { ok: false, reason: `unknown type ${offer.type}` };
}

function sortOffersSequential(offers: OfferRecord[]): OfferRecord[] {
  return [...offers].sort((a, b) => {
    const pa = a.priority ?? 0;
    const pb = b.priority ?? 0;
    if (pa !== pb) return pa - pb;
    return String(a.id).localeCompare(String(b.id));
  });
}

function sortOffersBestPriority(offers: OfferRecord[]): OfferRecord[] {
  return [...offers].sort((a, b) => {
    const pa = a.priority ?? 0;
    const pb = b.priority ?? 0;
    if (pa !== pb) return pb - pa;
    return String(a.id).localeCompare(String(b.id));
  });
}

function runSingleOfferEffect(items: OfferInvoiceItem[], offer: OfferRecord): number {
  const type = (offer.type || '').toLowerCase();
  const condition = asObj(offer.condition_json);
  const action = asObj(offer.action_json);

  if (type === 'percentage_discount' || type === 'percent_discount') {
    const pct = Number(action.percent);
    const targetItem =
      action.item_id != null ? String(action.item_id) : condition.item_id != null ? String(condition.item_id) : '';
    if (targetItem) {
      const idx = findLineIndexForItem(items, targetItem);
      if (idx < 0) return 0;
      const subP = lineSubtotalPaise(items[idx]);
      const extraP = Math.round((subP * pct) / 100);
      addLineDiscountPaise(items, idx, extraP);
      return round2(fromPaise(extraP));
    }
    return round2(applyBillPercentPaise(items, pct));
  }

  if (type === 'flat_discount') {
    const amt = Number(action.amount);
    const targetPaise = toPaise(amt);
    return round2(distributeBillFlatPaise(items, targetPaise));
  }

  if (type === 'buy_x_get_y') {
    const itemId = String(action.item_id || condition.item_id || '');
    const buy = Number(action.buy);
    const get = Number(action.get);
    return round2(applyBuyXGetY(items, itemId, buy, get, action));
  }

  if (type === 'bill_value_discount') {
    const minBill = Number((condition as BillValueCondition).min_bill);
    const billPaise = billTaxableSumPaise(items);
    if (billPaise < toPaise(minBill)) return 0;

    if (action.percent != null) {
      const pct = Number(action.percent);
      if (Number.isFinite(pct) && pct > 0) {
        return round2(applyBillPercentPaise(items, pct));
      }
    } else if (action.amount != null) {
      const amt = Number(action.amount);
      if (Number.isFinite(amt) && amt > 0) {
        return round2(distributeBillFlatPaise(items, toPaise(amt)));
      }
    }
  }

  return 0;
}

function applyOneValidatedOffer(
  items: OfferInvoiceItem[],
  offer: OfferRecord,
  appliedOffers: AppliedOfferLine[]
): number {
  const v = validateOfferPayload(offer);
  if (!v.ok) return 0;

  const before = items.map((r) => ({ ...r }));
  const disc = runSingleOfferEffect(items, offer);
  finalizeSafety(items);

  if (disc <= 0) {
    for (let i = 0; i < items.length; i++) {
      items[i] = before[i];
    }
    return 0;
  }

  appliedOffers.push({
    offerId: offer.id,
    type: offer.type,
    discountAmount: disc,
    description: undefined,
  });
  return disc;
}

/**
 * Applies active offers. Mutates a deep copy of invoice lines.
 * Expects `offers` to already be filtered by business, active flag, date window, and plan gates.
 */
export function applyOffers(
  invoiceItems: OfferInvoiceItem[],
  offers: OfferRecord[],
  options?: ApplyOffersOptions
): ApplyOffersResult {
  const stackingPolicy = options?.stackingPolicy ?? 'sequential';
  const initial = invoiceItems.map((row) => ({ ...row }));

  if (stackingPolicy === 'single_best_priority') {
    const ordered = sortOffersBestPriority(offers);
    for (const offer of ordered) {
      const trial = initial.map((row) => ({ ...row }));
      const applied: AppliedOfferLine[] = [];
      const disc = applyOneValidatedOffer(trial, offer, applied);
      if (disc > 0) {
        return { items: trial, appliedOffers: applied };
      }
    }
    return { items: initial, appliedOffers: [] };
  }

  const items = initial;
  const appliedOffers: AppliedOfferLine[] = [];
  const ordered = sortOffersSequential(offers);

  for (const offer of ordered) {
    applyOneValidatedOffer(items, offer, appliedOffers);
  }

  finalizeSafety(items);
  return { items, appliedOffers };
}
