import { queryOne } from '@/lib/db';

/**
 * Validates category belongs to business. Returns null to clear, undefined if key omitted.
 */
export async function resolveItemCategoryId(
  businessId: string,
  categoryId: unknown
): Promise<string | null | undefined> {
  if (categoryId === undefined) {
    return undefined;
  }
  if (categoryId === null || categoryId === '') {
    return null;
  }
  const id = String(categoryId);
  const row = await queryOne<{ id: string }>(
    'SELECT id FROM categories WHERE id = $1 AND business_id = $2',
    [id, businessId]
  );
  if (!row) {
    return null;
  }
  return row.id;
}
