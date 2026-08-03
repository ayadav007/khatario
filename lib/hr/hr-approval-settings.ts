import { queryOne, query } from '@/lib/db';

export type HrApprovalMode = 'permission_any' | 'manager_direct_reports' | 'manager_only';

export type HrApprovalSettings = {
  leave_mode: HrApprovalMode;
  expense_mode: HrApprovalMode;
  allow_hr_override: boolean;
  /** Minimum approvers HR must pick when submitting an offer (default 1). */
  offer_min_levels: number;
  /** Max approvers per offer; null = unlimited. */
  offer_max_levels: number | null;
};

export const DEFAULT_HR_APPROVAL_SETTINGS: HrApprovalSettings = {
  leave_mode: 'permission_any',
  expense_mode: 'permission_any',
  allow_hr_override: true,
  offer_min_levels: 1,
  offer_max_levels: null,
};

function normalizeMode(value: unknown): HrApprovalMode {
  if (value === 'manager_direct_reports' || value === 'manager_only') return value;
  return 'permission_any';
}

export function parseHrApprovalSettings(raw: unknown): HrApprovalSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_HR_APPROVAL_SETTINGS };
  const o = raw as Record<string, unknown>;
  const maxLevels = o.offer_max_levels;
  return {
    leave_mode: normalizeMode(o.leave_mode),
    expense_mode: normalizeMode(o.expense_mode),
    allow_hr_override: o.allow_hr_override !== false,
    offer_min_levels: Math.max(1, Number(o.offer_min_levels) || 1),
    offer_max_levels:
      maxLevels === null || maxLevels === undefined || maxLevels === ''
        ? null
        : Math.max(1, Number(maxLevels) || 1),
  };
}

export async function getHrApprovalSettings(businessId: string): Promise<HrApprovalSettings> {
  const row = await queryOne<{ hr_approval_settings: unknown }>(
    `SELECT hr_approval_settings FROM business_settings WHERE business_id = $1`,
    [businessId]
  );
  if (!row?.hr_approval_settings) return { ...DEFAULT_HR_APPROVAL_SETTINGS };
  return parseHrApprovalSettings(row.hr_approval_settings);
}

export async function updateHrApprovalSettings(
  businessId: string,
  settings: Partial<HrApprovalSettings>
): Promise<HrApprovalSettings> {
  const current = await getHrApprovalSettings(businessId);
  const merged: HrApprovalSettings = {
    leave_mode: settings.leave_mode ?? current.leave_mode,
    expense_mode: settings.expense_mode ?? current.expense_mode,
    allow_hr_override: settings.allow_hr_override ?? current.allow_hr_override,
    offer_min_levels: settings.offer_min_levels ?? current.offer_min_levels,
    offer_max_levels:
      settings.offer_max_levels !== undefined
        ? settings.offer_max_levels
        : current.offer_max_levels,
  };

  const existing = await queryOne(`SELECT business_id FROM business_settings WHERE business_id = $1`, [
    businessId,
  ]);

  if (existing) {
    await query(
      `UPDATE business_settings SET hr_approval_settings = $2::jsonb WHERE business_id = $1`,
      [businessId, JSON.stringify(merged)]
    );
  } else {
    await query(
      `INSERT INTO business_settings (business_id, hr_approval_settings) VALUES ($1, $2::jsonb)`,
      [businessId, JSON.stringify(merged)]
    );
  }

  return merged;
}
