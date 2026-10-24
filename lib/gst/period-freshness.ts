/**
 * Financial-year freshness for GSTR-9 and monthly return periods.
 * A date move marks both the year left behind and the year arrived in.
 */

export type MonthlyReturnKind = 'gstr1' | 'gstr3b' | 'gstr2b';
export type ReturnKind = MonthlyReturnKind | 'gstr9';
export type PeriodState = 'not_checked' | 'awaiting_gstr2b' | 'stale' | 'ready';

export interface ReadinessTarget {
  kind: ReturnKind;
  periodKey: string;
}

/** Indian financial year key, April–March, e.g. 2025-09-15 → "2025-26". */
export function financialYearKey(isoDate: string | null | undefined): string | null {
  if (!isoDate) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (!year || month < 1 || month > 12) return null;
  const start = month >= 4 ? year : year - 1;
  return `${start}-${String(start + 1).slice(2)}`;
}

export function filingMonthKey(isoDate: string | null | undefined): string | null {
  if (!isoDate) return null;
  const m = /^(\d{4})-(\d{2})-\d{2}/.exec(isoDate);
  return m ? `${m[1]}-${m[2]}` : null;
}

/**
 * Years whose GSTR-9 readiness must be marked stale.
 * `from` and `to` together cover an edit that moves the document date.
 */
export function financialYearsToStale(input: {
  dates?: Array<string | null | undefined>;
  from?: string | null;
  to?: string | null;
}): string[] {
  const dates = [...(input.dates ?? [])];
  if (input.from) dates.push(input.from);
  if (input.to) dates.push(input.to);
  const years = new Set<string>();
  for (const d of dates) {
    const fy = financialYearKey(d);
    if (fy) years.add(fy);
  }
  return [...years].sort();
}

export function monthlyPeriodsToStale(dates: Array<string | null | undefined>): string[] {
  const periods = new Set<string>();
  for (const d of dates) {
    const p = filingMonthKey(d);
    if (p) periods.add(p);
  }
  return [...periods].sort();
}

/** True only when the last reconciliation is strictly newer than the last invalidating change. */
export function annualReadinessIsCurrent(row: { state: PeriodState; reconciledAt: string | null; changedAt: string | null } | null): boolean {
  if (!row || row.state !== 'ready' || !row.reconciledAt) return false;
  if (!row.changedAt) return true;
  return row.reconciledAt > row.changedAt;
}

type Queryable = { query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }> };

/**
 * Books changed. GSTR-2B with no import for that month is awaiting portal data.
 * Every other affected return is stale. Does not rebuild a return.
 */
export async function markGstReadinessStale(
  db: Queryable,
  businessId: string,
  input: {
    dates?: Array<string | null | undefined>;
    from?: string | null;
    to?: string | null;
    monthly?: MonthlyReturnKind[];
  }
): Promise<void> {
  const dates = [...(input.dates ?? [])];
  if (input.from) dates.push(input.from);
  if (input.to) dates.push(input.to);
  const months = monthlyPeriodsToStale(dates);
  const years = financialYearsToStale({ dates });
  const monthly = input.monthly ?? ['gstr1', 'gstr3b', 'gstr2b'];

  for (const periodKey of months) {
    for (const kind of monthly) {
      let state: PeriodState = 'stale';
      if (kind === 'gstr2b') {
        const imported = await db.query(
          `SELECT EXISTS (
             SELECT 1 FROM gstr2b_reconciliation
              WHERE business_id = $1 AND filing_period = $2
           ) AS ran`,
          [businessId, periodKey]
        );
        if (imported.rows[0]?.ran !== true) state = 'awaiting_gstr2b';
      }
      await upsertPeriod(db, businessId, kind, periodKey, state, false);
    }
  }
  for (const year of years) {
    await upsertPeriod(db, businessId, 'gstr9', year, 'stale', false);
  }
}

export async function markReturnReconciled(
  db: Queryable,
  businessId: string,
  kind: ReturnKind,
  periodKey: string
): Promise<void> {
  await upsertPeriod(db, businessId, kind, periodKey, 'ready', true);
}

async function upsertPeriod(
  db: Queryable,
  businessId: string,
  kind: ReturnKind,
  periodKey: string,
  state: PeriodState,
  reconciled: boolean
): Promise<void> {
  await db.query(
    `INSERT INTO gst_period_status (business_id, kind, period_key, state, changed_at, reconciled_at)
     VALUES ($1, $2, $3, $4, clock_timestamp(), CASE WHEN $5 THEN clock_timestamp() ELSE NULL END)
     ON CONFLICT (business_id, kind, period_key) DO UPDATE SET
       state = EXCLUDED.state,
       changed_at = CASE WHEN $5 THEN gst_period_status.changed_at ELSE clock_timestamp() END,
       reconciled_at = CASE WHEN $5 THEN clock_timestamp() ELSE gst_period_status.reconciled_at END`,
    [businessId, kind, periodKey, state, reconciled]
  );
}
