import { getPool } from '@/lib/db';
import { resolveSupplierRegistration } from '@/lib/gst/registration';
import { effectiveGstScheme, outwardTaxPolicy } from '@/lib/gst/scheme-policy';

type Db = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> }; // eslint-disable-line @typescript-eslint/no-explicit-any

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Whether this store's seller may charge GST: only a regular registration with a GSTIN can.
 * Composition sellers and businesses without a GSTIN issue a Bill of Supply, so what the shopper
 * is charged has to follow the same rule as the invoice. With no branch picked the order bills
 * from the default branch, so that branch's GSTIN decides.
 */
export async function storeCollectsGst(input: {
  businessId: string;
  branchId?: string | null;
  db?: Db;
}): Promise<boolean> {
  const db: Db = input.db ?? getPool();
  const res = await db.query(
    `SELECT b.gst_registration_type,
            (SELECT br.id FROM branches br
              WHERE br.business_id = b.id AND br.is_default = true AND br.is_active = true
              LIMIT 1) AS default_branch_id
       FROM businesses b
      WHERE b.id = $1`,
    [input.businessId],
  );
  const row = res.rows[0] as { gst_registration_type: string | null; default_branch_id: string | null } | undefined;
  const picked = typeof input.branchId === 'string' && UUID_RE.test(input.branchId) ? input.branchId : null;
  const registration = await resolveSupplierRegistration(db, input.businessId, picked ?? row?.default_branch_id ?? null);
  return outwardTaxPolicy({
    scheme: effectiveGstScheme(row?.gst_registration_type, registration.gstin),
    documentType: 'tax_invoice',
  }).collectTax;
}

/** A product as a shopper should see it: no GST rate or "GST extra" when the seller cannot charge it. */
export function withStoreGst<T extends { tax_rate?: unknown; gst_included?: unknown }>(
  item: T,
  collectsGst: boolean,
): T {
  return collectsGst ? item : { ...item, tax_rate: 0, gst_included: false };
}
