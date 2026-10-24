import { queryRows } from '@/lib/db';
import type { GroupInfo } from '@/lib/reports/balance-sheet';

export async function loadGroupMap(businessId: string): Promise<Map<string, GroupInfo>> {
  const rows = await queryRows<{
    id: string;
    group_code: string | null;
    group_name: string | null;
    group_type: string | null;
    parent_group_id: string | null;
  }>(
    `SELECT id, group_code, group_name, group_type, parent_group_id
       FROM account_groups
      WHERE business_id = $1`,
    [businessId]
  );
  return new Map(
    rows.map((g) => [
      g.id,
      { id: g.id, code: g.group_code, name: g.group_name, type: g.group_type, parentId: g.parent_group_id },
    ])
  );
}
