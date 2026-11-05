import { queryOne, queryRows } from '@/lib/db';

/**
 * Ownership checks for warehouse and branch ids taken from a request. `authorize` skips its
 * branch and warehouse checks for a business owner, so routes that accept these ids must
 * confirm them against the session business before writing anything.
 */
export async function warehouseBelongsToBusiness(warehouseId: string, businessId: string): Promise<boolean> {
  const row = await queryOne<{ id: string }>(
    `SELECT id FROM warehouses WHERE id = $1 AND business_id = $2`,
    [warehouseId, businessId],
  );
  return row != null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Returns the ids from `branchIds` that are NOT branches of `businessId` (empty when all are owned).
 * A malformed id is reported as foreign, so callers answer 400 instead of failing the uuid cast.
 */
export async function foreignBranchIds(branchIds: string[], businessId: string): Promise<string[]> {
  const wanted = [...new Set(branchIds.filter((id) => typeof id === 'string' && id.length > 0))];
  if (wanted.length === 0) return [];
  const wellFormed = wanted.filter((id) => UUID_RE.test(id));
  const rows = wellFormed.length
    ? await queryRows<{ id: string }>(
        `SELECT id FROM branches WHERE business_id = $1 AND id = ANY($2::uuid[])`,
        [businessId, wellFormed],
      )
    : [];
  const owned = new Set(rows.map((r) => r.id));
  return wanted.filter((id) => !owned.has(id));
}
