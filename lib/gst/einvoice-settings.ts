/**
 * Where e-invoicing applies. The government sets the start per GSTIN, so the date lives on the
 * business (head-office GSTIN) and on each branch that holds its own, different GSTIN.
 */
import type { PoolClient } from 'pg';

type Queryable = Pick<PoolClient, 'query'>;

export type EinvoiceRegistration = {
  /** 'business' for the head-office GSTIN, otherwise the branch id. */
  key: 'business' | string;
  gstin: string;
  label: string;
  /** YYYY-MM-DD, or null when e-invoicing does not apply to this GSTIN. */
  einvoice_from: string | null;
};

/** A refusal the caller can show as is (bad date, unknown registration). */
export class EinvoiceSettingError extends Error {}

const norm = (g: string | null | undefined): string => (g ?? '').trim().toUpperCase();
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** The business GSTIN plus every active branch holding a different GSTIN. */
export async function listEinvoiceRegistrations(db: Queryable, businessId: string): Promise<EinvoiceRegistration[]> {
  const biz = await db.query<{ name: string; gstin: string | null; einvoice_from: string | null }>(
    `SELECT name, gstin, einvoice_from::text AS einvoice_from FROM businesses WHERE id = $1`,
    [businessId],
  );
  const b = biz.rows[0];
  const businessGstin = norm(b?.gstin);
  if (!b || !businessGstin) return [];
  const out: EinvoiceRegistration[] = [
    { key: 'business', gstin: businessGstin, label: b.name, einvoice_from: b.einvoice_from },
  ];
  const branches = await db.query<{ id: string; name: string; gstin: string | null; einvoice_from: string | null }>(
    `SELECT id, name, gstin, einvoice_from::text AS einvoice_from FROM branches
      WHERE business_id = $1 AND COALESCE(is_active, true) AND TRIM(COALESCE(gstin, '')) <> ''
      ORDER BY created_at ASC, name ASC`,
    [businessId],
  );
  for (const r of branches.rows) {
    const g = norm(r.gstin);
    if (g && g !== businessGstin) out.push({ key: r.id, gstin: g, label: r.name, einvoice_from: r.einvoice_from });
  }
  return out;
}

/** Sets or clears (null) the start date of one registration. Throws a plain Error on bad input. */
export async function setEinvoiceFrom(
  db: Queryable,
  businessId: string,
  key: string,
  date: string | null,
): Promise<void> {
  if (date !== null && (typeof date !== 'string' || !isRealDate(date))) {
    throw new EinvoiceSettingError('Enter the date as a real calendar date.');
  }
  const regs = await listEinvoiceRegistrations(db, businessId);
  const reg = regs.find((r) => r.key === key);
  if (!reg) throw new EinvoiceSettingError('That GSTIN registration was not found for this business.');
  if (reg.key === 'business') {
    await db.query(`UPDATE businesses SET einvoice_from = $2 WHERE id = $1`, [businessId, date]);
  } else {
    await db.query(`UPDATE branches SET einvoice_from = $3 WHERE id = $2 AND business_id = $1`, [businessId, reg.key, date]);
  }
}

/** Start date of the registration this branch issues under (own GSTIN, else the business); null when not covered. */
export async function einvoiceFromFor(
  db: Queryable,
  businessId: string,
  branchId: string | null,
): Promise<string | null> {
  const res = await db.query<{
    b_gstin: string | null; b_from: string | null; br_gstin: string | null; br_from: string | null;
  }>(
    `SELECT b.gstin AS b_gstin, b.einvoice_from::text AS b_from,
            br.gstin AS br_gstin, br.einvoice_from::text AS br_from
       FROM businesses b
       LEFT JOIN branches br ON br.id = $2::uuid AND br.business_id = b.id
      WHERE b.id = $1`,
    [businessId, branchId ?? null],
  );
  const r = res.rows[0];
  if (!r) return null;
  const branchGstin = norm(r.br_gstin);
  if (branchGstin && branchGstin !== norm(r.b_gstin)) return r.br_from;
  return r.b_from;
}

const E_INVOICE_SUPPLY = new Set(['b2b', 'sez', 'export', 'deemed_export']);
const NOT_E_INVOICE_DOC = new Set(['proforma_invoice', 'bill_of_supply']);

/** Dates are YYYY-MM-DD strings, compared as text. */
export function einvoiceApplies(
  inv: { status: string; document_type: string | null; supply_type: string | null; invoice_date: string },
  einvoiceFrom: string | null,
): boolean {
  if (!einvoiceFrom) return false;
  if (inv.status !== 'final') return false;
  if (inv.document_type && NOT_E_INVOICE_DOC.has(inv.document_type)) return false;
  if (!inv.supply_type || !E_INVOICE_SUPPLY.has(inv.supply_type)) return false;
  return inv.invoice_date.slice(0, 10) >= einvoiceFrom;
}
