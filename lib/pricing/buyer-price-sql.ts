/**
 * A connected Supplier Hub buyer's price is the supplier's customer price (party_item_prices)
 * for the customer linked to that buyer: one list for billing and for the hub (migration 434).
 * Joins as `bp` with a `price` column, whole-item prices valid today only.
 */
export const BUYER_PRICE_JOIN = (vendor: string, buyer: string, item: string) => `
  LEFT JOIN LATERAL (
    SELECT p.price
      FROM party_item_prices p
      JOIN customers bc ON bc.id = p.party_id
     WHERE bc.business_id = ${vendor} AND bc.linked_business_id = ${buyer} AND bc.deleted_at IS NULL
       AND p.business_id = ${vendor} AND p.item_id = ${item} AND p.variant_id IS NULL AND p.price IS NOT NULL
       AND (p.valid_from IS NULL OR p.valid_from <= CURRENT_DATE)
       AND (p.valid_to IS NULL OR p.valid_to >= CURRENT_DATE)
     ORDER BY bc.created_at
     LIMIT 1
  ) bp ON true`;
