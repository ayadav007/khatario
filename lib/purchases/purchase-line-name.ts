/**
 * A purchase line is stored with the name the user typed, or the catalogue
 * product name when they selected a product and the name was not sent.
 * A line with neither is rejected. No placeholder name is invented.
 */

type Queryable = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: Array<{ name?: string | null }> }>;
};

export async function resolvePurchaseItemName(
  db: Queryable,
  businessId: string,
  item: { item_id?: string | null; item_name?: string | null }
): Promise<string | null> {
  const typed = String(item.item_name ?? '').trim();
  if (typed) return typed;
  const itemId = String(item.item_id ?? '').trim();
  if (!itemId) return null;
  const found = await db.query(
    `SELECT name FROM items WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL`,
    [itemId, businessId]
  );
  const name = String(found.rows[0]?.name ?? '').trim();
  return name || null;
}
