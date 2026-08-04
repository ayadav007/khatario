import { query, queryOne } from '@/lib/db';
import {
  DEFAULT_HR_PAYROLL_SETTINGS,
  parseHrPayrollSettings,
  type HrPayrollSettings,
} from '@/lib/hr/hr-payroll-settings-shared';

export type { HrPayrollSettings };
export { DEFAULT_HR_PAYROLL_SETTINGS, parseHrPayrollSettings };

async function ensureBusinessSettingsRow(businessId: string): Promise<void> {
  const existing = await queryOne(
    `SELECT business_id FROM business_settings WHERE business_id = $1`,
    [businessId],
  );
  if (!existing) {
    await query(`INSERT INTO business_settings (business_id) VALUES ($1)`, [businessId]);
  }
}

export async function getHrPayrollSettings(businessId: string): Promise<HrPayrollSettings> {
  const row = await queryOne<{ hr_payroll_settings: unknown }>(
    `SELECT hr_payroll_settings FROM business_settings WHERE business_id = $1`,
    [businessId],
  );
  if (!row?.hr_payroll_settings) return { ...DEFAULT_HR_PAYROLL_SETTINGS };
  return parseHrPayrollSettings(row.hr_payroll_settings);
}

export async function updateHrPayrollSettings(
  businessId: string,
  partial: Partial<HrPayrollSettings>,
): Promise<HrPayrollSettings> {
  const current = await getHrPayrollSettings(businessId);
  const merged = parseHrPayrollSettings({ ...current, ...partial });

  await ensureBusinessSettingsRow(businessId);
  await query(
    `UPDATE business_settings SET hr_payroll_settings = $2::jsonb WHERE business_id = $1`,
    [businessId, JSON.stringify(merged)],
  );
  return merged;
}
