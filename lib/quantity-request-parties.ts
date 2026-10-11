/**
 * Quantity requests always refer to the buyer's catalog item (the stock being replenished).
 * buyer_to_vendor: the buyer asked their linked vendor.
 * vendor_to_buyer: the vendor asked the buyer after seeing low stock.
 * The buyer raises the purchase order. The other party confirms the quantity.
 */

export type QuantityRequestDirection = 'buyer_to_vendor' | 'vendor_to_buyer';

export type QuantityRequestParties = {
  direction: QuantityRequestDirection;
  buyerBusinessId: string;
  vendorBusinessId: string;
  buyerItemId: string;
};

export function partiesFromItemOwner(
  requesterBusinessId: string,
  responderBusinessId: string,
  itemBusinessId: string,
  itemId: string
): QuantityRequestParties | null {
  if (!requesterBusinessId || !responderBusinessId || !itemBusinessId || !itemId) return null;
  if (requesterBusinessId === responderBusinessId) return null;

  if (itemBusinessId === requesterBusinessId) {
    return {
      direction: 'buyer_to_vendor',
      buyerBusinessId: requesterBusinessId,
      vendorBusinessId: responderBusinessId,
      buyerItemId: itemId,
    };
  }
  if (itemBusinessId === responderBusinessId) {
    return {
      direction: 'vendor_to_buyer',
      buyerBusinessId: responderBusinessId,
      vendorBusinessId: requesterBusinessId,
      buyerItemId: itemId,
    };
  }
  return null;
}

/** The business that confirms a pending request (the one who did not start it). */
export function confirmingBusinessId(parties: QuantityRequestParties): string {
  return parties.direction === 'buyer_to_vendor'
    ? parties.vendorBusinessId
    : parties.buyerBusinessId;
}

export function purchaseQtyAllowed(status: string, requestedQty: number, confirmedQty: number | null): number | null {
  if (status === 'declined' || status === 'pending') return null;
  if (confirmedQty != null && Number.isFinite(confirmedQty)) return confirmedQty;
  if (status === 'confirmed') return requestedQty;
  return null;
}
