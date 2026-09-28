import { checkGstin, GST_STATE_NAMES } from '@/lib/tax/gstin';

type Queryable = {
  query: <R = any>(text: string, params?: unknown[]) => Promise<{ rows: R[] }>;
};

export interface SupplierRegistration {
  /** 'branch' when the branch holds its own GSTIN, otherwise the business registration applies. */
  source: 'branch' | 'business';
  gstin: string | null;
  stateCode: string | null;
  stateName: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  pincode: string | null;
  phone: string | null;
  email: string | null;
}

const NAME_TO_CODE: Record<string, string> = Object.fromEntries(
  Object.entries(GST_STATE_NAMES).map(([code, name]) => [name.toLowerCase().replace(/[^a-z]/g, ''), code]),
);

export function stateCodeFromName(name: string | null | undefined): string | null {
  if (!name || !name.trim()) return null;
  const s = name.trim();
  if (/^\d{1,2}$/.test(s)) return s.padStart(2, '0');
  const key = s.toLowerCase().replace(/[^a-z]/g, '');
  if (key === 'andhrapradesh') return '37';
  if (key === 'daman' || key === 'damananddiu') return '26';
  return NAME_TO_CODE[key] ?? null;
}

function stateOf(gstin: string | null, stateCode: string | null, state: string | null): string | null {
  const g = gstin ? checkGstin(gstin) : null;
  if (g?.valid) return g.stateCode;
  if (stateCode && stateCode.trim()) return stateCode.trim().padStart(2, '0');
  return stateCodeFromName(state);
}

/**
 * GST registration a document is issued under. A branch with its own GSTIN is a distinct
 * person under GST (s.25(4) CGST Act), so its state decides intra/inter-state supply and its
 * GSTIN/address print on the document. A branch without a GSTIN trades under the head office.
 */
export async function resolveSupplierRegistration(
  db: Queryable,
  businessId: string,
  branchId: string | null | undefined,
): Promise<SupplierRegistration> {
  const res = await db.query<{
    b_gstin: string | null; b_state: string | null; b_state_code: string | null;
    b_address: string | null; b_address2: string | null; b_city: string | null; b_pincode: string | null; b_phone: string | null; b_email: string | null;
    br_gstin: string | null; br_state: string | null; br_state_code: string | null;
    br_address1: string | null; br_address2: string | null; br_city: string | null; br_pincode: string | null;
    br_phone: string | null; br_email: string | null;
  }>(
    `SELECT b.gstin AS b_gstin, b.state AS b_state, b.state_code AS b_state_code,
            b.address_line1 AS b_address, b.address_line2 AS b_address2, b.city AS b_city, b.pincode AS b_pincode, b.phone AS b_phone, b.email AS b_email,
            br.gstin AS br_gstin, br.state AS br_state, br.state_code AS br_state_code,
            br.address_line1 AS br_address1, br.address_line2 AS br_address2, br.city AS br_city,
            br.pincode AS br_pincode, br.phone AS br_phone, br.email AS br_email
       FROM businesses b
       LEFT JOIN branches br ON br.id = $2::uuid AND br.business_id = b.id
      WHERE b.id = $1`,
    [businessId, branchId ?? null],
  );
  const r = res.rows[0];
  if (!r) {
    return {
      source: 'business', gstin: null, stateCode: null, stateName: null,
      addressLine1: null, addressLine2: null, city: null, pincode: null, phone: null, email: null,
    };
  }
  const branchGstin = r.br_gstin && r.br_gstin.trim() ? r.br_gstin.trim().toUpperCase() : null;
  const businessGstin = r.b_gstin && r.b_gstin.trim() ? r.b_gstin.trim().toUpperCase() : null;
  if (branchGstin && branchGstin !== businessGstin) {
    const stateCode = stateOf(branchGstin, r.br_state_code, r.br_state);
    return {
      source: 'branch',
      gstin: branchGstin,
      stateCode,
      stateName: stateCode ? GST_STATE_NAMES[stateCode] ?? r.br_state : r.br_state,
      addressLine1: r.br_address1,
      addressLine2: r.br_address2,
      city: r.br_city,
      pincode: r.br_pincode,
      phone: r.br_phone ?? r.b_phone,
      email: r.br_email ?? r.b_email,
    };
  }
  const stateCode = stateOf(businessGstin, r.b_state_code, r.b_state);
  return {
    source: 'business',
    gstin: businessGstin,
    stateCode,
    stateName: stateCode ? GST_STATE_NAMES[stateCode] ?? r.b_state : r.b_state,
    addressLine1: r.b_address,
    addressLine2: r.b_address2,
    city: r.b_city,
    pincode: r.b_pincode,
    phone: r.b_phone,
    email: r.b_email,
  };
}
