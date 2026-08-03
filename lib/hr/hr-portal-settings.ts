import { query, queryOne } from '@/lib/db';

export type HrPortalSettings = {
  kiosk_enabled: boolean;
};

export const DEFAULT_HR_PORTAL_SETTINGS: HrPortalSettings = {
  kiosk_enabled: true,
};

export function parseHrPortalSettings(raw: unknown): HrPortalSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_HR_PORTAL_SETTINGS };
  const o = raw as Record<string, unknown>;
  return {
    kiosk_enabled: o.kiosk_enabled !== false,
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

export async function getHrPortalSettings(businessId: string): Promise<HrPortalSettings> {
  const row = await queryOne<{ hr_portal_settings: unknown }>(
    `SELECT hr_portal_settings FROM business_settings WHERE business_id = $1`,
    [businessId],
  );
  if (!row?.hr_portal_settings) return { ...DEFAULT_HR_PORTAL_SETTINGS };
  return parseHrPortalSettings(row.hr_portal_settings);
}

export async function updateHrPortalSettings(
  businessId: string,
  partial: Partial<HrPortalSettings>,
): Promise<HrPortalSettings> {
  const current = await getHrPortalSettings(businessId);
  const merged: HrPortalSettings = {
    kiosk_enabled: partial.kiosk_enabled ?? current.kiosk_enabled,
  };

  await ensureBusinessSettingsRow(businessId);
  await query(
    `UPDATE business_settings SET hr_portal_settings = $2::jsonb WHERE business_id = $1`,
    [businessId, JSON.stringify(merged)],
  );
  return merged;
}
