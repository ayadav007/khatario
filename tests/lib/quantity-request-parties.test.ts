import { partiesFromItemOwner, purchaseQtyAllowed, confirmingBusinessId } from '@/lib/quantity-request-parties';

describe('quantity request parties', () => {
  const buyer = 'buyer';
  const vendor = 'vendor';
  const item = 'item-1';

  it('treats a buyer-owned item as a buyer request the vendor confirms', () => {
    const parties = partiesFromItemOwner(buyer, vendor, buyer, item);
    expect(parties).toEqual({
      direction: 'buyer_to_vendor',
      buyerBusinessId: buyer,
      vendorBusinessId: vendor,
      buyerItemId: item,
    });
    expect(confirmingBusinessId(parties!)).toBe(vendor);
  });

  it('treats a buyer-owned item sent by the vendor as a vendor request the buyer confirms', () => {
    const parties = partiesFromItemOwner(vendor, buyer, buyer, item);
    expect(parties?.direction).toBe('vendor_to_buyer');
    expect(parties?.buyerBusinessId).toBe(buyer);
    expect(parties?.vendorBusinessId).toBe(vendor);
    expect(confirmingBusinessId(parties!)).toBe(buyer);
  });

  it('rejects an item that belongs to neither party', () => {
    expect(partiesFromItemOwner(buyer, vendor, 'someone-else', item)).toBeNull();
  });

  it('allows a purchase order only after confirmation and only up to the confirmed quantity', () => {
    expect(purchaseQtyAllowed('pending', 10, null)).toBeNull();
    expect(purchaseQtyAllowed('declined', 10, null)).toBeNull();
    expect(purchaseQtyAllowed('confirmed', 10, 10)).toBe(10);
    expect(purchaseQtyAllowed('partial', 10, 4)).toBe(4);
  });
});
