import { getPool, queryOne } from '@/lib/db';
import { resolveSupplierRegistration } from '@/lib/gst/registration';
import type { Gstr3BDueDateOptions, Gstr3BFilingFrequency } from '@/lib/gst/gst-interest';

/** Whether due-date inputs came from `business_settings` or an explicit API override (query/body). */
export type GstDueDateRuleSource = 'org_defaults' | 'request_override';

export interface GstOrgFilingDefaults {
  filingFrequency: Gstr3BFilingFrequency;
  qrmpDueDay: 22 | 24;
}

/**
 * QRMP GSTR-3B due day by the state of the registration (Notification 76/2020-CT as amended):
 * the 22nd for these states and UTs, the 24th for the rest.
 */
const QRMP_DAY_22_STATES = new Set([
  '22', '23', '24', '25', '26', '27', '29', '30', '31', '32', '33', '34', '35', '36', '37',
]);

export function qrmpDueDayForState(stateCode: string | null | undefined): 22 | 24 | null {
  const code = stateCode && /^\d{1,2}$/.test(stateCode.trim()) ? stateCode.trim().padStart(2, '0') : null;
  if (!code) return null;
  return QRMP_DAY_22_STATES.has(code) ? 22 : 24;
}

/**
 * Defaults for GSTR-3B due-date rules (monthly vs QRMP). Row may be missing for legacy DBs.
 * The QRMP due day follows the state of the GSTIN being filed (the branch's registration when a
 * branch is given); the saved setting is only used when that state is unknown.
 */
export async function loadGstFilingOrgDefaults(businessId: string, branchId?: string | null): Promise<GstOrgFilingDefaults> {
  const row = await queryOne<{ gst_filing_frequency: string | null; gst_qrmp_due_day: number | null }>(
    `SELECT gst_filing_frequency, gst_qrmp_due_day FROM business_settings WHERE business_id = $1::uuid`,
    [businessId]
  );
  const filingFrequency: Gstr3BFilingFrequency = row?.gst_filing_frequency === 'qrmp' ? 'qrmp' : 'monthly';
  const reg = await resolveSupplierRegistration(getPool(), businessId, branchId ?? null);
  const qrmpDueDay: 22 | 24 = qrmpDueDayForState(reg.stateCode) ?? (row?.gst_qrmp_due_day === 24 ? 24 : 22);
  return { filingFrequency, qrmpDueDay };
}

/**
 * Per-request overrides (e.g. POST /api/gst/file query/body) take precedence over org defaults.
 */
export function mergeGstDueDateOptions(
  org: GstOrgFilingDefaults,
  override?: { filingFrequency?: Gstr3BFilingFrequency | null; qrmpDueDay?: 22 | 24 | null }
): Gstr3BDueDateOptions {
  const filingFrequency = override?.filingFrequency ?? org.filingFrequency;
  const qrmpDueDay = override?.qrmpDueDay ?? org.qrmpDueDay;
  if (filingFrequency === 'qrmp') {
    return { filingFrequency: 'qrmp', qrmpDueDay };
  }
  return { filingFrequency: 'monthly' };
}

/** Same parsing as GET /api/gst/charges — use for status/charges parity. */
export function parseGstDueDateQueryOverrides(searchParams: URLSearchParams): {
  override: { filingFrequency: Gstr3BFilingFrequency | null; qrmpDueDay: 22 | 24 | null };
  due_date_inputs_from_request: boolean;
} {
  const filingFreqParam = searchParams.get('filing_frequency');
  const qrmpDueParam = searchParams.get('qrmp_due_day');
  const due_date_inputs_from_request =
    searchParams.has('filing_frequency') || searchParams.has('qrmp_due_day');

  const filingFrequency =
    filingFreqParam === 'qrmp' ? 'qrmp' : filingFreqParam === 'monthly' ? 'monthly' : null;
  const qrmpDueDay =
    qrmpDueParam === '24' ? 24 : qrmpDueParam === '22' ? 22 : null;

  return {
    override: { filingFrequency, qrmpDueDay },
    due_date_inputs_from_request,
  };
}

/** Parse POST /api/gst/file body fields the same way as query overrides. */
export function parseGstDueDateBodyOverrides(body: Record<string, unknown>): {
  override: { filingFrequency: Gstr3BFilingFrequency | null; qrmpDueDay: 22 | 24 | null };
  due_date_inputs_from_request: boolean;
} {
  const due_date_inputs_from_request =
    Object.prototype.hasOwnProperty.call(body ?? {}, 'filing_frequency') ||
    Object.prototype.hasOwnProperty.call(body ?? {}, 'qrmp_due_day');

  const ff = body?.filing_frequency;
  const qd = body?.qrmp_due_day;

  const filingFrequency =
    ff === 'qrmp' ? 'qrmp' : ff === 'monthly' ? 'monthly' : null;
  const qrmpDueDay = qd === 24 ? 24 : qd === 22 ? 22 : null;

  return {
    override: { filingFrequency, qrmpDueDay },
    due_date_inputs_from_request,
  };
}
