import { query, queryOne } from '@/lib/db';
import { inclusiveCalendarDays } from '@/lib/hr/salary-payroll-helpers';

export type LateDetectionMode = 'none' | 'shift_checkin' | 'manual_only' | 'both';
export type LateDeductionMode = 'none' | 'fixed_amount' | 'day_fraction';
export type DailyRateBasis =
  | 'gross_calendar_days'
  | 'gross_26'
  | 'basic_calendar_days'
  | 'basic_26';

export type AttendancePolicy = {
  late_detection_mode: LateDetectionMode;
  grace_minutes: number;
  free_lates_per_month: number;
  late_deduction_enabled: boolean;
  late_deduction_mode: LateDeductionMode;
  late_fixed_amount: number;
  late_day_fraction: number;
  half_day_lwp_enabled: boolean;
  half_day_lwp_fraction: number;
  absent_lwp_enabled: boolean;
  absent_lwp_fraction: number;
  daily_rate_basis: DailyRateBasis;
  max_attendance_deduction_per_month: number | null;
  geofence_enabled: boolean;
  geofence_lat: number | null;
  geofence_lng: number | null;
  geofence_radius_m: number | null;
};

export const DEFAULT_ATTENDANCE_POLICY: AttendancePolicy = {
  late_detection_mode: 'both',
  grace_minutes: 10,
  free_lates_per_month: 3,
  late_deduction_enabled: false,
  late_deduction_mode: 'none',
  late_fixed_amount: 0,
  late_day_fraction: 0.25,
  half_day_lwp_enabled: false,
  half_day_lwp_fraction: 0.5,
  absent_lwp_enabled: false,
  absent_lwp_fraction: 1,
  daily_rate_basis: 'gross_calendar_days',
  max_attendance_deduction_per_month: null,
  geofence_enabled: false,
  geofence_lat: null,
  geofence_lng: null,
  geofence_radius_m: null,
};

export type AttendanceRecordForPolicy = {
  date: string;
  status: string;
  is_late: boolean;
  late_excused: boolean;
  late_minutes: number;
  late_marked_manual: boolean;
};

export type AttendanceDeductionLine = {
  type: 'late' | 'half_day_lwp' | 'absent_lwp';
  date: string;
  label: string;
  amount: number;
};

export type AttendanceDeductionResult = {
  lines: AttendanceDeductionLine[];
  total: number;
  summary: {
    late_count: number;
    billable_late_count: number;
    excused_late_count: number;
    half_days: number;
    absent_days: number;
    daily_rate: number;
  };
  capped: boolean;
  policy_applied: boolean;
};

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeLateDetectionMode(v: unknown): LateDetectionMode {
  if (v === 'none' || v === 'shift_checkin' || v === 'manual_only' || v === 'both') return v;
  return DEFAULT_ATTENDANCE_POLICY.late_detection_mode;
}

function normalizeLateDeductionMode(v: unknown): LateDeductionMode {
  if (v === 'none' || v === 'fixed_amount' || v === 'day_fraction') return v;
  return 'none';
}

function normalizeDailyRateBasis(v: unknown): DailyRateBasis {
  const allowed: DailyRateBasis[] = [
    'gross_calendar_days',
    'gross_26',
    'basic_calendar_days',
    'basic_26',
  ];
  if (allowed.includes(v as DailyRateBasis)) return v as DailyRateBasis;
  return DEFAULT_ATTENDANCE_POLICY.daily_rate_basis;
}

export function parseAttendancePolicy(raw: unknown): AttendancePolicy {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_ATTENDANCE_POLICY };
  const o = raw as Record<string, unknown>;
  const maxCap = o.max_attendance_deduction_per_month;
  return {
    late_detection_mode: normalizeLateDetectionMode(o.late_detection_mode),
    grace_minutes: Math.max(0, Math.floor(num(o.grace_minutes, 10))),
    free_lates_per_month: Math.max(0, Math.floor(num(o.free_lates_per_month, 0))),
    late_deduction_enabled: o.late_deduction_enabled === true,
    late_deduction_mode: normalizeLateDeductionMode(o.late_deduction_mode),
    late_fixed_amount: Math.max(0, num(o.late_fixed_amount)),
    late_day_fraction: Math.min(1, Math.max(0, num(o.late_day_fraction, 0.25))),
    half_day_lwp_enabled: o.half_day_lwp_enabled === true,
    half_day_lwp_fraction: Math.min(1, Math.max(0, num(o.half_day_lwp_fraction, 0.5))),
    absent_lwp_enabled: o.absent_lwp_enabled === true,
    absent_lwp_fraction: Math.min(1, Math.max(0, num(o.absent_lwp_fraction, 1))),
    daily_rate_basis: normalizeDailyRateBasis(o.daily_rate_basis),
    max_attendance_deduction_per_month:
      maxCap == null || maxCap === '' ? null : Math.max(0, num(maxCap)),
    geofence_enabled: o.geofence_enabled === true,
    geofence_lat:
      o.geofence_lat == null || o.geofence_lat === ''
        ? null
        : Number.isFinite(Number(o.geofence_lat))
          ? Number(o.geofence_lat)
          : null,
    geofence_lng:
      o.geofence_lng == null || o.geofence_lng === ''
        ? null
        : Number.isFinite(Number(o.geofence_lng))
          ? Number(o.geofence_lng)
          : null,
    geofence_radius_m:
      o.geofence_radius_m == null || o.geofence_radius_m === ''
        ? null
        : Math.max(0, Math.floor(num(o.geofence_radius_m))),
  };
}

export async function getAttendancePolicy(businessId: string): Promise<AttendancePolicy> {
  const row = await queryOne<{ attendance_policy: unknown }>(
    `SELECT attendance_policy FROM business_settings WHERE business_id = $1`,
    [businessId],
  );
  if (!row?.attendance_policy) return { ...DEFAULT_ATTENDANCE_POLICY };
  return parseAttendancePolicy(row.attendance_policy);
}

export async function updateAttendancePolicy(
  businessId: string,
  partial: Partial<AttendancePolicy>,
): Promise<AttendancePolicy> {
  const current = await getAttendancePolicy(businessId);
  const merged: AttendancePolicy = {
    late_detection_mode: partial.late_detection_mode ?? current.late_detection_mode,
    grace_minutes: partial.grace_minutes ?? current.grace_minutes,
    free_lates_per_month: partial.free_lates_per_month ?? current.free_lates_per_month,
    late_deduction_enabled: partial.late_deduction_enabled ?? current.late_deduction_enabled,
    late_deduction_mode: partial.late_deduction_mode ?? current.late_deduction_mode,
    late_fixed_amount: partial.late_fixed_amount ?? current.late_fixed_amount,
    late_day_fraction: partial.late_day_fraction ?? current.late_day_fraction,
    half_day_lwp_enabled: partial.half_day_lwp_enabled ?? current.half_day_lwp_enabled,
    half_day_lwp_fraction: partial.half_day_lwp_fraction ?? current.half_day_lwp_fraction,
    absent_lwp_enabled: partial.absent_lwp_enabled ?? current.absent_lwp_enabled,
    absent_lwp_fraction: partial.absent_lwp_fraction ?? current.absent_lwp_fraction,
    daily_rate_basis: partial.daily_rate_basis ?? current.daily_rate_basis,
    max_attendance_deduction_per_month:
      partial.max_attendance_deduction_per_month !== undefined
        ? partial.max_attendance_deduction_per_month
        : current.max_attendance_deduction_per_month,
    geofence_enabled: partial.geofence_enabled ?? current.geofence_enabled,
    geofence_lat: partial.geofence_lat !== undefined ? partial.geofence_lat : current.geofence_lat,
    geofence_lng: partial.geofence_lng !== undefined ? partial.geofence_lng : current.geofence_lng,
    geofence_radius_m:
      partial.geofence_radius_m !== undefined
        ? partial.geofence_radius_m
        : current.geofence_radius_m,
  };

  const existing = await queryOne(`SELECT business_id FROM business_settings WHERE business_id = $1`, [
    businessId,
  ]);

  if (existing) {
    await query(
      `UPDATE business_settings SET attendance_policy = $2::jsonb WHERE business_id = $1`,
      [businessId, JSON.stringify(merged)],
    );
  } else {
    await query(
      `INSERT INTO business_settings (business_id, attendance_policy) VALUES ($1, $2::jsonb)`,
      [businessId, JSON.stringify(merged)],
    );
  }

  return parseAttendancePolicy(merged);
}

/** Minutes late after grace (0 if on time). */
export function computeLateMinutes(
  checkIn: Date,
  shiftStartTime: string,
  graceMinutes: number,
  dateYmd: string,
): number {
  const [sh, sm] = shiftStartTime.split(':').map(Number);
  const scheduled = new Date(`${dateYmd}T00:00:00`);
  scheduled.setHours(sh, sm ?? 0, 0, 0);
  const diffMs = checkIn.getTime() - scheduled.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  return Math.max(0, diffMin - graceMinutes);
}

export function computeDailyRate(
  basis: DailyRateBasis,
  monthlyGross: number,
  monthlyBasic: number,
  periodFrom: string,
  periodTo: string,
): number {
  const calendarDays = Math.max(1, inclusiveCalendarDays(periodFrom, periodTo));
  const divisor = basis.endsWith('_26') ? 26 : calendarDays;
  const base = basis.startsWith('basic') ? monthlyBasic : monthlyGross;
  return Math.round((base / divisor) * 100) / 100;
}

export function recordCountsAsLate(
  record: AttendanceRecordForPolicy,
  policy: AttendancePolicy,
): boolean {
  if (record.status !== 'present') return false;
  if (record.late_excused) return false;

  switch (policy.late_detection_mode) {
    case 'none':
      return false;
    case 'manual_only':
      return record.late_marked_manual && record.is_late;
    case 'shift_checkin':
      return record.is_late && !record.late_marked_manual && record.late_minutes > 0;
    case 'both':
      return record.is_late;
    default:
      return false;
  }
}

export function computeAttendanceDeductions(params: {
  policy: AttendancePolicy;
  records: AttendanceRecordForPolicy[];
  monthlyGross: number;
  monthlyBasic: number;
  periodFrom: string;
  periodTo: string;
}): AttendanceDeductionResult {
  const { policy, records, monthlyGross, monthlyBasic, periodFrom, periodTo } = params;
  const empty: AttendanceDeductionResult = {
    lines: [],
    total: 0,
    summary: {
      late_count: 0,
      billable_late_count: 0,
      excused_late_count: 0,
      half_days: 0,
      absent_days: 0,
      daily_rate: 0,
    },
    capped: false,
    policy_applied: false,
  };

  const anyEnabled =
    (policy.late_deduction_enabled && policy.late_deduction_mode !== 'none') ||
    policy.half_day_lwp_enabled ||
    policy.absent_lwp_enabled;

  if (!anyEnabled) return empty;

  const dailyRate = computeDailyRate(
    policy.daily_rate_basis,
    monthlyGross,
    monthlyBasic,
    periodFrom,
    periodTo,
  );

  const lines: AttendanceDeductionLine[] = [];
  const lateDates: string[] = [];
  let excusedLateCount = 0;

  for (const r of records) {
    const date = String(r.date).slice(0, 10);
    if (r.status === 'half_day' && policy.half_day_lwp_enabled) {
      const amount = Math.round(dailyRate * policy.half_day_lwp_fraction * 100) / 100;
      if (amount > 0) {
        lines.push({
          type: 'half_day_lwp',
          date,
          label: `Half day LWP (${date})`,
          amount,
        });
      }
    } else if (r.status === 'absent' && policy.absent_lwp_enabled) {
      const amount = Math.round(dailyRate * policy.absent_lwp_fraction * 100) / 100;
      if (amount > 0) {
        lines.push({
          type: 'absent_lwp',
          date,
          label: `Absent LWP (${date})`,
          amount,
        });
      }
    }

    if (r.status === 'present' && r.is_late && r.late_excused) {
      excusedLateCount++;
    } else if (recordCountsAsLate(r, policy)) {
      lateDates.push(date);
    }
  }

  const sortedLates = [...lateDates].sort();
  const free = policy.free_lates_per_month;
  let billableLate = 0;

  if (policy.late_deduction_enabled && policy.late_deduction_mode !== 'none') {
    sortedLates.forEach((date, index) => {
      if (index < free) return;
      billableLate++;
      let amount = 0;
      if (policy.late_deduction_mode === 'fixed_amount') {
        amount = policy.late_fixed_amount;
      } else if (policy.late_deduction_mode === 'day_fraction') {
        amount = Math.round(dailyRate * policy.late_day_fraction * 100) / 100;
      }
      if (amount > 0) {
        lines.push({
          type: 'late',
          date,
          label: `Late deduction (${date})`,
          amount,
        });
      }
    });
  }

  let total = lines.reduce((s, l) => s + l.amount, 0);
  let capped = false;
  if (
    policy.max_attendance_deduction_per_month != null &&
    total > policy.max_attendance_deduction_per_month
  ) {
    total = policy.max_attendance_deduction_per_month;
    capped = true;
  }

  return {
    lines,
    total: Math.round(total * 100) / 100,
    summary: {
      late_count: sortedLates.length,
      billable_late_count: billableLate,
      excused_late_count: excusedLateCount,
      half_days: records.filter((r) => r.status === 'half_day').length,
      absent_days: records.filter((r) => r.status === 'absent').length,
      daily_rate: dailyRate,
    },
    capped,
    policy_applied: lines.length > 0 || total > 0,
  };
}

/** Resolve shift start time for late calc: explicit shift, or sole active shift for business. */
export async function resolveShiftStartForEmployee(
  businessId: string,
  shiftId: string | null | undefined,
): Promise<string | null> {
  if (shiftId) {
    const shift = await queryOne<{ start_time: string }>(
      `SELECT start_time FROM shifts WHERE id = $1 AND business_id = $2 AND is_active = true`,
      [shiftId, businessId],
    );
    return shift?.start_time ?? null;
  }

  const shifts = await queryOne<{ start_time: string; cnt: string }>(
    `SELECT MIN(start_time::text) AS start_time, COUNT(*)::text AS cnt
     FROM shifts WHERE business_id = $1 AND is_active = true`,
    [businessId],
  );
  if (shifts && Number(shifts.cnt) === 1) return shifts.start_time;
  return null;
}

export async function applyLateFieldsOnCheckIn(params: {
  businessId: string;
  checkIn: Date;
  dateYmd: string;
  shiftId?: string | null;
}): Promise<{ is_late: boolean; late_minutes: number }> {
  const policy = await getAttendancePolicy(params.businessId);
  if (policy.late_detection_mode === 'none' || policy.late_detection_mode === 'manual_only') {
    return { is_late: false, late_minutes: 0 };
  }

  const shiftStart = await resolveShiftStartForEmployee(params.businessId, params.shiftId);
  if (!shiftStart) return { is_late: false, late_minutes: 0 };

  const lateMinutes = computeLateMinutes(
    params.checkIn,
    shiftStart,
    policy.grace_minutes,
    params.dateYmd,
  );
  return { is_late: lateMinutes > 0, late_minutes: lateMinutes };
}
