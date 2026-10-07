import { queryOne } from '@/lib/db';
import type { PartnerProgramSettings } from '@/lib/partners/types';

const DEFAULTS: PartnerProgramSettings = {
  id: 1,
  default_hold_days: 14,
  default_commission_type: 'percentage',
  default_commission_value: 20,
  default_commission_basis: 'first_payment',
  tds_enabled: true,
  tds_section: '194H',
  tds_rate_percent: 2,
  tds_annual_threshold: 20000,
  updated_at: new Date(0).toISOString(),
};

export async function getPartnerProgramSettings(): Promise<PartnerProgramSettings> {
  const row = await queryOne<PartnerProgramSettings>(
    `SELECT id, default_hold_days, default_commission_type, default_commission_value,
            default_commission_basis, tds_enabled, tds_section, tds_rate_percent,
            tds_annual_threshold, updated_at
     FROM partner_program_settings WHERE id = 1`,
  );
  if (!row) return { ...DEFAULTS };
  return {
    ...row,
    default_hold_days: Number(row.default_hold_days),
    default_commission_value: Number(row.default_commission_value),
    tds_rate_percent: Number(row.tds_rate_percent),
    tds_annual_threshold: Number(row.tds_annual_threshold),
  };
}

export async function updatePartnerProgramSettings(
  patch: Partial<
    Omit<PartnerProgramSettings, 'id' | 'updated_at'>
  >,
): Promise<PartnerProgramSettings> {
  const current = await getPartnerProgramSettings();
  const next = { ...current, ...patch };
  await queryOne(
    `INSERT INTO partner_program_settings (
       id, default_hold_days, default_commission_type, default_commission_value,
       default_commission_basis, tds_enabled, tds_section, tds_rate_percent,
       tds_annual_threshold, updated_at
     ) VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
     ON CONFLICT (id) DO UPDATE SET
       default_hold_days = EXCLUDED.default_hold_days,
       default_commission_type = EXCLUDED.default_commission_type,
       default_commission_value = EXCLUDED.default_commission_value,
       default_commission_basis = EXCLUDED.default_commission_basis,
       tds_enabled = EXCLUDED.tds_enabled,
       tds_section = EXCLUDED.tds_section,
       tds_rate_percent = EXCLUDED.tds_rate_percent,
       tds_annual_threshold = EXCLUDED.tds_annual_threshold,
       updated_at = CURRENT_TIMESTAMP`,
    [
      next.default_hold_days,
      next.default_commission_type,
      next.default_commission_value,
      next.default_commission_basis,
      next.tds_enabled,
      next.tds_section,
      next.tds_rate_percent,
      next.tds_annual_threshold,
    ],
  );
  return getPartnerProgramSettings();
}
