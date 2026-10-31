import type { PoolClient } from 'pg';

type Queryable = Pick<PoolClient, 'query'>;

export interface TransferGodown {
  id: string;
  name: string;
  branch_id: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
}

/** Godown with the branch it belongs to (its own branch, else its primary branch mapping). */
export async function loadTransferGodown(db: Queryable, businessId: string, warehouseId: string): Promise<TransferGodown | null> {
  const r = await db.query(
    `SELECT w.id, w.name, w.address_line1, w.address_line2, w.city, w.state, w.pincode,
            COALESCE(w.branch_id, (SELECT bw.branch_id FROM branch_warehouses bw
                                    WHERE bw.warehouse_id = w.id ORDER BY bw.is_primary DESC NULLS LAST LIMIT 1)) AS branch_id
       FROM warehouses w WHERE w.id = $1 AND w.business_id = $2`,
    [warehouseId, businessId]
  );
  return r.rows[0] ?? null;
}

/** One-line address for a challan: "12 MG Road, Andheri, Mumbai, Maharashtra 400053". */
export function godownAddress(g: Pick<TransferGodown, 'name' | 'address_line1' | 'address_line2' | 'city' | 'state' | 'pincode'>): string {
  const parts = [g.address_line1, g.address_line2, g.city].map((p) => p?.trim()).filter(Boolean);
  const tail = [g.state?.trim(), g.pincode?.trim()].filter(Boolean).join(' ');
  if (tail) parts.push(tail);
  return parts.length ? `${g.name}: ${parts.join(', ')}` : g.name;
}
