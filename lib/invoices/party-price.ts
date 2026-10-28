/**
 * Customer-specific (party) pricing on the invoice screen.
 *
 * Catalog and party prices are stored on the item's own GST basis (`gst_included`).
 * The bill line price must be on the bill's basis (`pricesIncludeGst`), so both are
 * converted the same way.
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

export interface PartyPricedRow {
  price: number;
  taxPercent: number;
  gstIncluded?: boolean;
  priceUserOverride?: boolean;
  /** Item selling price as stored in the catalog, used to undo a party price. */
  catalogPrice?: number;
  /** True while `price` came from the current customer's party price. */
  partyPriceApplied?: boolean;
}

/**
 * Decide the line price for the selected customer. `partyPrice` is the customer's
 * stored price for the item, or null when they have none (or no customer is set).
 * Returns the fields to patch, or null when the line should stay as it is.
 */
export function partyPricePatch(
  row: PartyPricedRow,
  partyPrice: number | null,
  pricesIncludeGst: boolean
): { price: number; partyPriceApplied: boolean } | null {
  if (row.priceUserOverride) return null;

  let target: number;
  let applied: boolean;
  if (partyPrice != null) {
    target = storedPriceToBillUnit(partyPrice, row.gstIncluded, row.taxPercent, pricesIncludeGst);
    applied = true;
  } else if (row.partyPriceApplied && row.catalogPrice != null) {
    target = storedPriceToBillUnit(row.catalogPrice, row.gstIncluded, row.taxPercent, pricesIncludeGst);
    applied = false;
  } else {
    return null;
  }

  const samePrice = typeof row.price === 'number' && Math.abs(row.price - target) < 1e-9;
  if (samePrice && !!row.partyPriceApplied === applied) return null;
  return { price: target, partyPriceApplied: applied };
}
