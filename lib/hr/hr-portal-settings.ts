import { query, queryOne } from '@/lib/db';

export type HrPortalSettings = {
  kiosk_enabled: boolean;
  /** Bumped to revoke every registered kiosk device (lib/employee-portal/kiosk-device). */
  kiosk_device_generation: number;
};

/** Kiosk stays off until a business turns it on: a kiosk login needs only an employee code. */
export const DEFAULT_HR_PORTAL_SETTINGS: HrPortalSettings = {
  kiosk_enabled: false,
  kiosk_device_generation: 0,
};

export function parseHrPortalSettings(raw: unknown): HrPortalSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_HR_PORTAL_SETTINGS };
  const o = raw as Record<string, unknown>;
  const generation = Number(o.kiosk_device_generation);
  return {
    kiosk_enabled: o.kiosk_enabled === true,
    kiosk_device_generation: Number.isInteger(generation) && generation >= 0 ? generation : 0,
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
    kiosk_device_generation: partial.kiosk_device_generation ?? current.kiosk_device_generation,
  };

  await ensureBusinessSettingsRow(businessId);
  await query(
    `UPDATE business_settings SET hr_portal_settings = $2::jsonb WHERE business_id = $1`,
    [businessId, JSON.stringify(merged)],
  );
  return merged;
}
