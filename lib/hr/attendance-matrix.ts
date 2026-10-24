import { isWeeklyOffDate } from '@/lib/hr/shift-overtime/weekly-off-dates';
import type { WeeklyOffPolicy } from '@/lib/hr/shift-overtime/types';

export type AttendanceMatrixStatus = 'present' | 'absent' | 'half_day' | 'leave' | 'holiday';

export type AttendanceMatrixCellKind =
  | 'present'
  | 'overtime'
  | 'half_day'
  | 'absent'
  | 'leave'
  | 'off'
  | 'empty';

export type AttendanceCalendarCode = 'P' | 'P/A' | 'A' | 'L' | 'W' | 'H' | '';

export type AttendanceMatrixCell = {
  kind: AttendanceMatrixCellKind;
  label: string;
  hours: number;
  countsAsDay: boolean;
  /** Short mark used by the phone month calendar. */
  calendarCode: AttendanceCalendarCode;
  missingOutPunch: boolean;
  earlyMinutes: number;
  lateMinutes: number;
};

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'] as const;

const STANDARD_PRESENT_HOURS = 8;
const STANDARD_HALF_DAY_HOURS = 4;

export function formatMatrixHours(hours: number): string {
  const rounded = Math.round(hours * 10) / 10;
  if (Math.abs(rounded - Math.round(rounded)) < 0.001) return String(Math.round(rounded));
  return rounded.toFixed(1);
}

export function formatMatrixTotalHours(hours: number): string {
  return `${(Math.round(hours * 10) / 10).toFixed(1)}h`;
}

export function formatClockMinutes(totalMinutes: number): string {
  const mins = Math.max(0, Math.round(totalMinutes));
  const hours = Math.floor(mins / 60);
  const minutes = mins % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function clockToMinutes(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = /^(\d{1,2}):(\d{2})/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export function attendanceMatrixCell(input: {
  status: AttendanceMatrixStatus | null;
  totalHours: number | null;
  isOff: boolean;
  isHoliday?: boolean;
  checkInMinutes?: number | null;
  shiftStartMinutes?: number | null;
  missingOutPunch?: boolean;
}): AttendanceMatrixCell {
  const { status, totalHours, isOff, isHoliday = false } = input;
  const workedHoliday = status === 'holiday' && totalHours != null && totalHours > 0;

  let base: Pick<AttendanceMatrixCell, 'kind' | 'label' | 'hours' | 'countsAsDay' | 'calendarCode'>;
  if (status === 'absent') {
    base = { kind: 'absent', label: 'A', hours: 0, countsAsDay: false, calendarCode: 'A' };
  } else if (status === 'leave') {
    base = { kind: 'leave', label: 'L', hours: 0, countsAsDay: false, calendarCode: 'L' };
  } else if (status === 'half_day') {
    const hours = totalHours != null && totalHours > 0 ? totalHours : STANDARD_HALF_DAY_HOURS;
    base = { kind: 'half_day', label: 'HD', hours, countsAsDay: true, calendarCode: 'P/A' };
  } else if (status === 'present' || workedHoliday) {
    const hours = totalHours != null && totalHours > 0 ? totalHours : STANDARD_PRESENT_HOURS;
    if (hours > STANDARD_PRESENT_HOURS) {
      base = { kind: 'overtime', label: formatMatrixHours(hours), hours, countsAsDay: true, calendarCode: 'P' };
    } else {
      base = { kind: 'present', label: 'P', hours, countsAsDay: true, calendarCode: 'P' };
    }
  } else if (status === 'holiday' || isHoliday) {
    base = { kind: 'off', label: '–', hours: 0, countsAsDay: false, calendarCode: 'H' };
  } else if (isOff) {
    base = { kind: 'off', label: '–', hours: 0, countsAsDay: false, calendarCode: 'W' };
  } else {
    base = { kind: 'empty', label: '', hours: 0, countsAsDay: false, calendarCode: '' };
  }

  const worked = base.kind === 'present' || base.kind === 'overtime' || base.kind === 'half_day';
  let earlyMinutes = 0;
  let lateMinutes = 0;
  if (worked && input.checkInMinutes != null && input.shiftStartMinutes != null) {
    const delta = input.checkInMinutes - input.shiftStartMinutes;
    if (delta < 0) earlyMinutes = -delta;
    else lateMinutes = delta;
  }

  return {
    ...base,
    missingOutPunch: worked && Boolean(input.missingOutPunch),
    earlyMinutes,
    lateMinutes,
  };
}

export type MonthCalendarSummary = {
  totalDaysLabel: string;
  presentsLabel: string;
  absentsLabel: string;
  leavesLabel: string;
  officeHoursLabel: string;
  earlyLabel: string;
  lateLabel: string;
};

export function monthCalendarSummary(cells: AttendanceMatrixCell[], totalDays: number): MonthCalendarSummary {
  let presents = 0;
  let absents = 0;
  let leaves = 0;
  let officeHours = 0;
  let earlyMinutes = 0;
  let lateMinutes = 0;
  for (const cell of cells) {
    if (cell.kind === 'present' || cell.kind === 'overtime') presents += 1;
    else if (cell.kind === 'half_day') {
      presents += 0.5;
      absents += 0.5;
    } else if (cell.kind === 'absent') absents += 1;
    else if (cell.kind === 'leave') leaves += 1;
    officeHours += cell.hours;
    earlyMinutes += cell.earlyMinutes;
    lateMinutes += cell.lateMinutes;
  }
  return {
    totalDaysLabel: totalDays.toFixed(1),
    presentsLabel: presents.toFixed(1),
    absentsLabel: absents.toFixed(1),
    leavesLabel: leaves.toFixed(1),
    officeHoursLabel: (Math.round(officeHours * 100) / 100).toFixed(2),
    earlyLabel: formatClockMinutes(earlyMinutes),
    lateLabel: formatClockMinutes(lateMinutes),
  };
}

export type AttendanceMatrixEmployee = {
  id: string;
  code: string;
  name: string;
  weeklyOff: WeeklyOffPolicy;
  /** Roster day-off dates, YYYY-MM-DD. Weekly-off policy is applied separately. */
  offDates: string[];
  /** Holiday calendar dates, YYYY-MM-DD. */
  holidayDates?: string[];
};

export type AttendanceMatrixRecord = {
  employeeId: string;
  date: string;
  status: AttendanceMatrixStatus;
  totalHours: number | null;
  checkInMinutes?: number | null;
  shiftStartMinutes?: number | null;
  missingOutPunch?: boolean;
};

export type AttendanceMatrixDay = {
  date: string;
  day: number;
  weekday: string;
  isSunday: boolean;
};

export type AttendanceMatrixWorker = {
  id: string;
  code: string;
  name: string;
  cells: AttendanceMatrixCell[];
  days: number;
  totalHours: number;
  totalHoursLabel: string;
};

export function monthDateRange(year: number, month: number): { start: string; end: string; days: AttendanceMatrixDay[] } {
  const last = new Date(year, month, 0).getDate();
  const days: AttendanceMatrixDay[] = [];
  for (let day = 1; day <= last; day++) {
    const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const weekdayIndex = new Date(year, month - 1, day).getDay();
    days.push({
      date,
      day,
      weekday: WEEKDAYS[weekdayIndex],
      isSunday: weekdayIndex === 0,
    });
  }
  return { start: days[0]?.date ?? '', end: days[days.length - 1]?.date ?? '', days };
}

export function parseAttendanceMatrixMonth(value: string | null): { year: number; month: number } | null {
  if (!value || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return null;
  const [year, month] = value.split('-').map(Number);
  return { year, month };
}

export function buildAttendanceMatrix(input: {
  year: number;
  month: number;
  employees: AttendanceMatrixEmployee[];
  attendance: AttendanceMatrixRecord[];
}): { days: AttendanceMatrixDay[]; workers: AttendanceMatrixWorker[] } {
  const { days } = monthDateRange(input.year, input.month);
  const byEmployee = new Map<string, Map<string, AttendanceMatrixRecord>>();
  for (const record of input.attendance) {
    const date = record.date.slice(0, 10);
    let dates = byEmployee.get(record.employeeId);
    if (!dates) {
      dates = new Map();
      byEmployee.set(record.employeeId, dates);
    }
    dates.set(date, record);
  }

  const workers = input.employees.map((employee) => {
    const marks = byEmployee.get(employee.id);
    const extraOff = new Set(employee.offDates.map((d) => d.slice(0, 10)));
    const holidays = new Set((employee.holidayDates ?? []).map((d) => d.slice(0, 10)));
    const cells = days.map((day) => {
      const mark = marks?.get(day.date);
      const isHoliday = holidays.has(day.date) || mark?.status === 'holiday';
      const isOff = extraOff.has(day.date) || isWeeklyOffDate(day.date, employee.weeklyOff);
      return attendanceMatrixCell({
        status: mark?.status ?? null,
        totalHours: mark?.totalHours ?? null,
        isOff,
        isHoliday,
        checkInMinutes: mark?.checkInMinutes,
        shiftStartMinutes: mark?.shiftStartMinutes,
        missingOutPunch: mark?.missingOutPunch,
      });
    });
    const totalHours = cells.reduce((sum, cell) => sum + cell.hours, 0);
    const workedDays = cells.reduce((sum, cell) => sum + (cell.countsAsDay ? 1 : 0), 0);
    return {
      id: employee.id,
      code: employee.code,
      name: employee.name,
      cells,
      days: workedDays,
      totalHours,
      totalHoursLabel: formatMatrixTotalHours(totalHours),
    };
  });

  return { days, workers };
}
