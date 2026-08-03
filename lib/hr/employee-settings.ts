import { queryOne } from '@/lib/db';

export type HrEmployeeSettings = {
  probation_period_value: number;
  probation_period_unit: 'months' | 'weeks';
  probation_auto_confirm: boolean;
  employee_id_prefix: string;
  employee_id_padding: number;
  employee_id_next_number: number | null;
  show_new_joiners: boolean;
  show_work_anniversaries: boolean;
  show_department_heads: boolean;
};

export const DEFAULT_HR_EMPLOYEE_SETTINGS: HrEmployeeSettings = {
  probation_period_value: 3,
  probation_period_unit: 'months',
  probation_auto_confirm: false,
  employee_id_prefix: 'EMP',
  employee_id_padding: 3,
  employee_id_next_number: null,
  show_new_joiners: true,
  show_work_anniversaries: true,
  show_department_heads: true,
};

export function parseHrEmployeeSettings(raw: unknown): HrEmployeeSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_HR_EMPLOYEE_SETTINGS };
  const o = raw as Record<string, unknown>;
  const d = DEFAULT_HR_EMPLOYEE_SETTINGS;
  const unit = o.probation_period_unit === 'weeks' ? 'weeks' : 'months';
  return {
    probation_period_value: Math.max(0, Number(o.probation_period_value ?? d.probation_period_value)),
    probation_period_unit: unit,
    probation_auto_confirm: o.probation_auto_confirm === true,
    employee_id_prefix: String(o.employee_id_prefix ?? d.employee_id_prefix).slice(0, 10) || 'EMP',
    employee_id_padding: Math.min(8, Math.max(1, Number(o.employee_id_padding ?? d.employee_id_padding))),
    employee_id_next_number:
      o.employee_id_next_number == null ? null : Math.max(1, Number(o.employee_id_next_number)),
    show_new_joiners: o.show_new_joiners !== false,
    show_work_anniversaries: o.show_work_anniversaries !== false,
    show_department_heads: o.show_department_heads !== false,
  };
}

export async function getHrEmployeeSettings(businessId: string): Promise<HrEmployeeSettings> {
  const row = await queryOne<{ hr_employee_settings: unknown }>(
    `SELECT hr_employee_settings FROM business_settings WHERE business_id = $1`,
    [businessId],
  );
  return parseHrEmployeeSettings(row?.hr_employee_settings);
}

export async function saveHrEmployeeSettings(
  businessId: string,
  settings: HrEmployeeSettings,
): Promise<HrEmployeeSettings> {
  const parsed = parseHrEmployeeSettings(settings);
  await queryOne(
    `UPDATE business_settings SET hr_employee_settings = $2::jsonb, updated_at = CURRENT_TIMESTAMP
     WHERE business_id = $1 RETURNING business_id`,
    [businessId, JSON.stringify(parsed)],
  );
  return parsed;
}

/** Compute probation end date from joining date and settings. */
export function computeProbationEndDate(
  joiningDate: Date,
  settings: HrEmployeeSettings,
): Date | null {
  if (settings.probation_period_value <= 0) return null;
  const end = new Date(joiningDate);
  if (settings.probation_period_unit === 'weeks') {
    end.setDate(end.getDate() + settings.probation_period_value * 7);
  } else {
    end.setMonth(end.getMonth() + settings.probation_period_value);
  }
  return end;
}

export async function generateNextEmployeeCode(businessId: string): Promise<string> {
  const settings = await getHrEmployeeSettings(businessId);
  const prefix = settings.employee_id_prefix.replace(/[^A-Za-z0-9]/g, '') || 'EMP';
  const padding = settings.employee_id_padding;

  const row = await queryOne<{ max_num: string | null }>(
    `SELECT MAX(
       CASE WHEN employee_code ~ ('^' || $2 || '[0-9]+$')
         THEN CAST(SUBSTRING(employee_code FROM LENGTH($2) + 1) AS INTEGER)
         ELSE NULL END
     )::text AS max_num
     FROM employees WHERE business_id = $1`,
    [businessId, prefix],
  );

  const fromDb = row?.max_num ? parseInt(row.max_num, 10) + 1 : 1;
  const next = settings.employee_id_next_number ?? fromDb;
  const code = prefix + String(next).padStart(padding, '0');

  if (settings.employee_id_next_number != null) {
    await queryOne(
      `UPDATE business_settings
       SET hr_employee_settings = jsonb_set(
         COALESCE(hr_employee_settings, '{}'::jsonb),
         '{employee_id_next_number}',
         to_jsonb($2::int)
       )
       WHERE business_id = $1`,
      [businessId, next + 1],
    );
  }

  return code;
}
