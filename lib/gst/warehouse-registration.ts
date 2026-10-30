import { checkGstin, GST_STATE_NAMES } from '@/lib/tax/gstin';
import { stateCodeFromName } from '@/lib/gst/registration';

type Queryable = {
  query: <R = any>(text: string, params?: unknown[]) => Promise<{ rows: R[] }>;
};

export interface WarehouseStateMismatch {
  warehouseId: string;
  warehouseName: string;
  warehouseStateCode: string;
  registrationStateCode: string;
  registrationGstin: string | null;
}

/** State a godown sits in: its own GSTIN if one is recorded, else its address state. */
export function warehouseStateCode(w: { gstin?: string | null; state?: string | null }): string | null {
  const g = w.gstin && w.gstin.trim() ? checkGstin(w.gstin.trim()) : null;
  if (g?.valid) return g.stateCode;
  return stateCodeFromName(w.state);
}

/**
 * GST registration is state-wise (s.22/25 CGST Act): a principal or additional place of business
 * must be in the state of the GSTIN. Goods leaving a godown in another state cannot be invoiced
 * under this registration; that godown needs its own branch with that state's GSTIN.
 * Returns the first godown whose state differs from the registration's, or null. Godowns with no
 * state recorded are not judged.
 */
export async function findWarehouseStateMismatch(
  db: Queryable,
  businessId: string,
  registration: { stateCode: string | null; gstin: string | null },
  warehouseIds: Array<string | null | undefined>,
): Promise<WarehouseStateMismatch | null> {
  const regState = registration.stateCode?.trim() ? registration.stateCode.trim().padStart(2, '0') : null;
  const ids = Array.from(new Set(warehouseIds.filter((id): id is string => !!id)));
  if (!regState || ids.length === 0) return null;
  const res = await db.query<{ id: string; name: string; state: string | null; gstin: string | null }>(
    `SELECT id, name, state, gstin FROM warehouses WHERE id = ANY($1::uuid[]) AND business_id = $2`,
    [ids, businessId],
  );
  for (const w of res.rows) {
    const code = warehouseStateCode(w);
    if (code && code !== regState) {
      return {
        warehouseId: w.id,
        warehouseName: w.name,
        warehouseStateCode: code,
        registrationStateCode: regState,
        registrationGstin: registration.gstin,
      };
    }
  }
  return null;
}

export function warehouseStateMismatchMessage(m: WarehouseStateMismatch): string {
  const godownState = GST_STATE_NAMES[m.warehouseStateCode] ?? `state ${m.warehouseStateCode}`;
  const regState = GST_STATE_NAMES[m.registrationStateCode] ?? `state ${m.registrationStateCode}`;
  const gstin = m.registrationGstin ? ` (${m.registrationGstin})` : '';
  return (
    `Godown "${m.warehouseName}" is in ${godownState}, but this branch bills under the ${regState} GSTIN${gstin}. ` +
    `A godown in another state needs its own GSTIN: add a ${godownState} branch with that GSTIN and link the godown to it.`
  );
}
