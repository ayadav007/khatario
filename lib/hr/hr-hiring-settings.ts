import { query, queryOne } from '@/lib/db';

export type HrHiringSettings = {
  auto_send_onboarding_invite: boolean;
};

export const DEFAULT_HR_HIRING_SETTINGS: HrHiringSettings = {
  auto_send_onboarding_invite: false,
};

export function parseHrHiringSettings(raw: unknown): HrHiringSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_HR_HIRING_SETTINGS };
  const o = raw as Record<string, unknown>;
  return {
    auto_send_onboarding_invite: o.auto_send_onboarding_invite === true,
  };
}

async function ensureBusinessSettingsRow(businessId: string): Promise<void> {
  const existing = await queryOne(
    `SELECT business_id FROM business_settings WHERE business_id = $1`,
    [businessId],
  );
  if (!existing) {
    await query(`INSERT INTO business_settings (business_id) VALUES ($1)`, [businessId]);
  }
}

export async function getHrHiringSettings(businessId: string): Promise<HrHiringSettings> {
  const row = await queryOne<{ hr_hiring_settings: unknown }>(
    `SELECT hr_hiring_settings FROM business_settings WHERE business_id = $1`,
    [businessId],
  );
  if (!row?.hr_hiring_settings) return { ...DEFAULT_HR_HIRING_SETTINGS };
  return parseHrHiringSettings(row.hr_hiring_settings);
}

export async function updateHrHiringSettings(
  businessId: string,
  partial: Partial<HrHiringSettings>,
): Promise<HrHiringSettings> {
  const current = await getHrHiringSettings(businessId);
  const merged: HrHiringSettings = {
    auto_send_onboarding_invite:
      partial.auto_send_onboarding_invite ?? current.auto_send_onboarding_invite,
  };

  await ensureBusinessSettingsRow(businessId);
  await query(
    `UPDATE business_settings SET hr_hiring_settings = $2::jsonb WHERE business_id = $1`,
    [businessId, JSON.stringify(merged)],
  );
  return merged;
}
