import { queryOne } from '@/lib/db';
import type { Gstr3BDueDateOptions, Gstr3BFilingFrequency } from '@/lib/gst/gst-interest';

/** Whether due-date inputs came from `business_settings` or an explicit API override (query/body). */
export type GstDueDateRuleSource = 'org_defaults' | 'request_override';

export interface GstOrgFilingDefaults {
  filingFrequency: Gstr3BFilingFrequency;
  qrmpDueDay: 22 | 24;
}

/**
 * Defaults for GSTR-3B due-date rules (monthly vs QRMP). Row may be missing for legacy DBs.
 */
export async function loadGstFilingOrgDefaults(businessId: string): Promise<GstOrgFilingDefaults> {
  const row = await queryOne<{ gst_filing_frequency: string | null; gst_qrmp_due_day: number | null }>(
    `SELECT gst_filing_frequency, gst_qrmp_due_day FROM business_settings WHERE business_id = $1::uuid`,
    [businessId]
  );
  const filingFrequency: Gstr3BFilingFrequency = row?.gst_filing_frequency === 'qrmp' ? 'qrmp' : 'monthly';
  const qrmpDueDay: 22 | 24 = row?.gst_qrmp_due_day === 24 ? 24 : 22;
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
