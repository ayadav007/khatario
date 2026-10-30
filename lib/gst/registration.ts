import { checkGstin, GST_STATE_NAMES, resolveGstinAndState } from '@/lib/tax/gstin';
import { effectiveGstScheme, type GstScheme } from '@/lib/gst/scheme-policy';

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

export interface PlaceRegistrationError {
  code: 'BRANCH_NEEDS_STATE_GSTIN' | 'WAREHOUSE_OUTSIDE_REGISTRATION_STATE' | 'GSTIN_STATE_MISMATCH' | 'INVALID_GSTIN';
  error: string;
}

/**
 * GST registration is per state (s.22 and s.25(1) CGST Act): a principal or additional place of
 * business must sit in the state of the GSTIN it trades under, and a place in another state needs
 * its own registration there. Skipped when the business is not registered or the state is unknown.
 */
export function placeOutsideRegistration(
  kind: 'branch' | 'warehouse',
  place: { state?: string | null; stateCode?: string | null },
  registration: { gstin: string | null; stateCode: string | null },
): PlaceRegistrationError | null {
  if (!registration.gstin) return null;
  const placeCode = place.stateCode?.trim() ? place.stateCode.trim().padStart(2, '0') : stateCodeFromName(place.state);
  const regCode = registration.stateCode || registration.gstin.slice(0, 2);
  if (!placeCode || placeCode === regCode) return null;
  const placeName = GST_STATE_NAMES[placeCode] ?? place.state ?? placeCode;
  const regName = GST_STATE_NAMES[regCode] ?? regCode;
  return kind === 'branch'
    ? {
        code: 'BRANCH_NEEDS_STATE_GSTIN',
        error: `This branch is in ${placeName}, but it has no GSTIN of its own and the business is registered in ${regName}. GST registration is per state, so add this branch's ${placeName} GSTIN.`,
      }
    : {
        code: 'WAREHOUSE_OUTSIDE_REGISTRATION_STATE',
        error: `This godown is in ${placeName}, but it falls under the ${regName} GST registration. Stock can only be kept at places in the registration's state, so link it to a branch with a ${placeName} GSTIN.`,
      };
}

/** Rule above for a branch: its own GSTIN must match its state, otherwise it trades under the head office's. */
export async function checkBranchPlace(
  db: Queryable,
  businessId: string,
  branch: { gstin?: string | null; state?: string | null; state_code?: string | null },
): Promise<PlaceRegistrationError | null> {
  const headOffice = await resolveSupplierRegistration(db, businessId, null);
  const own = branch.gstin?.trim().toUpperCase() || null;
  if (own && own !== headOffice.gstin) {
    const check = resolveGstinAndState({ gstin: own, state: branch.state, state_code: branch.state_code });
    return check.ok ? null : { code: check.code, error: check.error };
  }
  return placeOutsideRegistration('branch', { state: branch.state, stateCode: branch.state_code }, headOffice);
}

/** Rule above for a godown: checked against its branch's registration, or the head office's without a branch. */
export async function checkWarehousePlace(
  db: Queryable,
  businessId: string,
  branchId: string | null | undefined,
  warehouse: { state?: string | null },
): Promise<PlaceRegistrationError | null> {
  const registration = await resolveSupplierRegistration(db, businessId, branchId || null);
  return placeOutsideRegistration('warehouse', { state: warehouse.state }, registration);
}

/** Effective GST scheme of the registration a document is issued / received under. */
export async function resolveGstScheme(
  db: Queryable,
  businessId: string,
  branchId: string | null | undefined,
): Promise<GstScheme> {
  const [reg, biz] = await Promise.all([
    resolveSupplierRegistration(db, businessId, branchId),
    db.query<{ gst_registration_type: string | null }>(
      'SELECT gst_registration_type FROM businesses WHERE id = $1',
      [businessId],
    ),
  ]);
  return effectiveGstScheme(biz.rows[0]?.gst_registration_type, reg.gstin);
}

/**
 * Every branch that files under the same GSTIN as `branchId`. GSTR-1 and GSTR-3B are one return
 * per registration (s.25(2) CGST Act), so shops without their own GSTIN are reported together with
 * the head office, and a branch with a separate GSTIN only with branches holding that GSTIN.
 */
export async function registrationBranchIds(db: Queryable, businessId: string, branchId: string): Promise<string[]> {
  const res = await db.query<{ id: string; gstin: string | null; b_gstin: string | null }>(
    `SELECT br.id, br.gstin, b.gstin AS b_gstin
       FROM branches br JOIN businesses b ON b.id = br.business_id
      WHERE br.business_id = $1`,
    [businessId],
  );
  const ownGstin = (r: { gstin: string | null; b_gstin: string | null }) => {
    const g = r.gstin?.trim().toUpperCase() || null;
    return g && g !== (r.b_gstin?.trim().toUpperCase() || null) ? g : null;
  };
  const target = res.rows.find((r) => r.id === branchId);
  if (!target) return [branchId];
  const key = ownGstin(target);
  return res.rows.filter((r) => ownGstin(r) === key).map((r) => r.id);
}
