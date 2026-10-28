/**
 * Customer-specific pricing on the bill screens (invoice, sales order, challan).
 *
 * Catalog, customer and price-level prices are stored on the item's own GST basis (`gst_included`).
 * The line price must be on the bill's basis (`pricesIncludeGst`), so all of them are converted
 * the same way. The server picks which price applies (`lib/pricing/resolve-price.ts`); this file
 * only decides what that does to a line.
 */

/** Convert a stored item/party price into the unit price the bill line expects. */
export function storedPriceToBillUnit(
  price: number,
  storedGstIncluded: boolean | undefined,
  taxPercent: number,
  pricesIncludeGst: boolean
): number {
  const tr = Number(taxPercent || 0);
  if (tr <= 0) return price;
  if (pricesIncludeGst && !storedGstIncluded) return price * (1 + tr / 100);
  if (!pricesIncludeGst && storedGstIncluded) return price / (1 + tr / 100);
  return price;
}

export interface LastRateInfo {
  exclusivePrice: number;
  discountPercent: number;
  date: string;
  documentNumber: string | null;
}

/** What the server resolved for one line (subset of PriceLineResult). */
export interface ResolvedLinePrice {
  price: number | null;
  priceSource: 'party' | 'level' | 'catalog';
  discountPercent: number | null;
  levelName: string | null;
  costPrice: number | null;
  lastSale: LastRateInfo | null;
  /** The item's GST basis, for screens whose lines do not carry it. */
  gstIncluded?: boolean;
}

export interface PartyPricedRow {
  price: number;
  discountPercent: number;
  taxPercent: number;
  gstIncluded?: boolean;
  /** Price typed by hand, or a line loaded from a saved document / agreed on an order: never repriced. */
  priceUserOverride?: boolean;
  /** Discount % typed by hand: never replaced. */
  discountUserOverride?: boolean;
  /** Item selling price as stored in the catalog. */
  catalogPrice?: number;
  /** True while `price` came from a customer price or price level. */
  partyPriceApplied?: boolean;
  /** True while `discountPercent` came from a customer or level discount. */
  pricingDiscountApplied?: boolean;
  priceSource?: 'party' | 'level' | 'catalog';
  levelName?: string | null;
  costPrice?: number | null;
  lastSale?: LastRateInfo | null;
}

type Patch = Partial<
  Pick<
    PartyPricedRow,
    'price' | 'discountPercent' | 'gstIncluded' | 'partyPriceApplied' | 'pricingDiscountApplied' | 'priceSource' | 'levelName' | 'costPrice' | 'lastSale'
  >
>;

const close = (a: number | undefined, b: number) => typeof a === 'number' && Math.abs(a - b) < 1e-9;

/**
 * The fields to change on a line for the resolved price, or null when nothing changes.
 * Lines whose price is fixed (typed, loaded, agreed) keep price and discount and only pick up
 * the last-rate and cost information.
 */
export function pricingPatch(row: PartyPricedRow, res: ResolvedLinePrice, pricesIncludeGst: boolean): Patch | null {
  const patch: Patch = {};
  if (JSON.stringify(row.lastSale ?? null) !== JSON.stringify(res.lastSale ?? null)) patch.lastSale = res.lastSale ?? null;
  if ((row.costPrice ?? null) !== (res.costPrice ?? null)) patch.costPrice = res.costPrice ?? null;
  const gstIncluded = row.gstIncluded ?? res.gstIncluded;
  if (row.gstIncluded === undefined && res.gstIncluded !== undefined) patch.gstIncluded = res.gstIncluded;

  if (!row.priceUserOverride) {
    if (res.price != null) {
      const target = storedPriceToBillUnit(res.price, gstIncluded, row.taxPercent, pricesIncludeGst);
      const applied = res.priceSource !== 'catalog';
      if (!close(row.price, target)) patch.price = target;
      if (!!row.partyPriceApplied !== applied) patch.partyPriceApplied = applied;
    }
    if (row.priceSource !== res.priceSource) patch.priceSource = res.priceSource;
    if ((row.levelName ?? null) !== (res.levelName ?? null)) patch.levelName = res.levelName ?? null;

    if (!row.discountUserOverride) {
      const target = res.discountPercent ?? (row.pricingDiscountApplied ? 0 : null);
      if (target != null && !close(row.discountPercent, target)) patch.discountPercent = target;
      const applied = res.discountPercent != null;
      if (!!row.pricingDiscountApplied !== applied) patch.pricingDiscountApplied = applied;
    }
  }
  return Object.keys(patch).length ? patch : null;
}

/** Pre-GST unit price actually charged on a line, after its discount. */
export function lineExclusiveNet(row: Pick<PartyPricedRow, 'price' | 'discountPercent' | 'taxPercent'>, pricesIncludeGst: boolean): number {
  const tr = Number(row.taxPercent || 0);
  const exclusive = pricesIncludeGst && tr > 0 ? row.price / (1 + tr / 100) : row.price;
  return exclusive * (1 - (Number(row.discountPercent) || 0) / 100);
}

/** True when the line sells below the item's purchase price (purchase prices are pre-GST). */
export function isBelowCost(row: PartyPricedRow, pricesIncludeGst: boolean): boolean {
  if (row.costPrice == null || !(row.costPrice > 0) || !(row.price > 0)) return false;
  return lineExclusiveNet(row, pricesIncludeGst) < row.costPrice - 0.005;
}

const fmt = (n: number) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Short note under a line's price: where it came from and the last rate this customer paid. */
export function priceNote(row: PartyPricedRow): string | undefined {
  const parts: string[] = [];
  if (!row.priceUserOverride && row.priceSource === 'party') parts.push('Customer price');
  if (!row.priceUserOverride && row.priceSource === 'level' && row.levelName) parts.push(`${row.levelName} rate`);
  if (row.lastSale) {
    const d = new Date(`${row.lastSale.date}T00:00:00`);
    const when = Number.isNaN(d.getTime()) ? row.lastSale.date : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    const disc = row.lastSale.discountPercent > 0 ? ` −${row.lastSale.discountPercent}%` : '';
    parts.push(`Last ${fmt(row.lastSale.exclusivePrice)}${disc} + GST on ${when}`);
  }
  return parts.length ? parts.join(' · ') : undefined;
}
