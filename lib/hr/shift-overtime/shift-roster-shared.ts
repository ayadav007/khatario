export type ShiftRosterSettings = {
  auto_mark_absent: boolean;
  absent_grace_minutes_after_shift_start: number;
};

export type ShiftRosterEntry = {
  id?: string;
  business_id: string;
  employee_id: string;
  roster_date: string;
  shift_id: string | null;
  is_day_off: boolean;
  notes?: string | null;
};

export type RosterCell = {
  shift_id: string | null;
  is_day_off: boolean;
  shift_name?: string | null;
  start_time?: string | null;
  end_time?: string | null;
};

export const DEFAULT_SHIFT_ROSTER_SETTINGS: ShiftRosterSettings = {
  auto_mark_absent: true,
  absent_grace_minutes_after_shift_start: 120,
};
