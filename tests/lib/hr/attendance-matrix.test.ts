import { attendanceMatrixCell, buildAttendanceMatrix, monthCalendarSummary } from '@/lib/hr/attendance-matrix';
import { DEFAULT_WEEKLY_OFF_POLICY } from '@/lib/hr/shift-overtime/types';

describe('attendance matrix cells', () => {
  it('shows P for a standard present day and the hour count past 8 hours', () => {
    expect(attendanceMatrixCell({ status: 'present', totalHours: 8, isOff: false })).toMatchObject({
      kind: 'present',
      label: 'P',
      countsAsDay: true,
      hours: 8,
    });
    expect(attendanceMatrixCell({ status: 'present', totalHours: null, isOff: false }).label).toBe('P');
    expect(attendanceMatrixCell({ status: 'present', totalHours: 9.5, isOff: false })).toMatchObject({
      kind: 'overtime',
      label: '9.5',
      hours: 9.5,
    });
    expect(attendanceMatrixCell({ status: 'present', totalHours: 10, isOff: false }).label).toBe('10');
  });

  it('maps half day, absent, leave, and weekly off', () => {
    expect(attendanceMatrixCell({ status: 'half_day', totalHours: null, isOff: false })).toMatchObject({
      label: 'HD',
      hours: 4,
      countsAsDay: true,
    });
    expect(attendanceMatrixCell({ status: 'absent', totalHours: null, isOff: false }).label).toBe('A');
    expect(attendanceMatrixCell({ status: 'leave', totalHours: null, isOff: false }).label).toBe('L');
    expect(attendanceMatrixCell({ status: null, totalHours: null, isOff: true })).toMatchObject({
      kind: 'off',
      label: '–',
      countsAsDay: false,
    });
    expect(attendanceMatrixCell({ status: null, totalHours: null, isOff: false }).kind).toBe('empty');
  });

  it('sums worked days and hours, and dashes Sundays from the weekly-off policy', () => {
    const matrix = buildAttendanceMatrix({
      year: 2026,
      month: 6,
      employees: [
        {
          id: 'emp-1',
          code: 'EMP-101',
          name: 'Rajesh Sharma',
          weeklyOff: DEFAULT_WEEKLY_OFF_POLICY,
          offDates: [],
          holidayDates: ['2026-06-15'],
        },
      ],
      attendance: [
        { employeeId: 'emp-1', date: '2026-06-01', status: 'present', totalHours: 8 },
        { employeeId: 'emp-1', date: '2026-06-02', status: 'present', totalHours: 10 },
        { employeeId: 'emp-1', date: '2026-06-03', status: 'half_day', totalHours: null },
        { employeeId: 'emp-1', date: '2026-06-04', status: 'absent', totalHours: null },
      ],
    });

    expect(matrix.days).toHaveLength(30);
    expect(matrix.days[0]).toMatchObject({ day: 1, weekday: 'Mo', isSunday: false });
    const worker = matrix.workers[0];
    expect(worker.cells[0]).toMatchObject({ label: 'P' });
    expect(worker.cells[1]).toMatchObject({ label: '10' });
    expect(worker.cells[2]).toMatchObject({ label: 'HD' });
    expect(worker.cells[3]).toMatchObject({ label: 'A' });
    const sunday = matrix.days.findIndex((day) => day.date === '2026-06-07');
    expect(worker.cells[sunday]).toMatchObject({ kind: 'off', calendarCode: 'W' });
    const holiday = matrix.days.findIndex((day) => day.date === '2026-06-15');
    expect(worker.cells[holiday]).toMatchObject({ kind: 'off', calendarCode: 'H' });
    expect(worker.cells[2].calendarCode).toBe('P/A');
    expect(worker.days).toBe(3);
    expect(worker.totalHours).toBe(22);
    expect(worker.totalHoursLabel).toBe('22.0h');
    expect(monthCalendarSummary(worker.cells, 30)).toMatchObject({
      totalDaysLabel: '30.0',
      presentsLabel: '2.5',
      absentsLabel: '1.5',
      leavesLabel: '0.0',
      officeHoursLabel: '22.00',
    });
  });

  it('counts early and late minutes and a missing out punch', () => {
    const cell = attendanceMatrixCell({
      status: 'present',
      totalHours: 8,
      isOff: false,
      checkInMinutes: 9 * 60 + 20,
      shiftStartMinutes: 9 * 60,
      missingOutPunch: true,
    });
    expect(cell).toMatchObject({ calendarCode: 'P', lateMinutes: 20, earlyMinutes: 0, missingOutPunch: true });
  });
});
