import {
  addDays,
  addMonths,
  differenceInCalendarDays,
  endOfMonth,
  endOfWeek,
  format,
  isAfter,
  min,
  parseISO,
  startOfMonth,
  startOfWeek,
  subDays,
  subMonths,
} from 'date-fns';

export type SalesTrendPreset = 'day' | 'week' | 'month' | 'custom';

export type DateRangeStrings = { start: string; end: string };

export function deriveSalesTrendPreset(
  label: string,
  start: string,
  end: string
): SalesTrendPreset {
  if (label === 'Today' || start === end) return 'day';
  if (label === 'This Week') return 'week';
  if (label === 'This Month') return 'month';
  return 'custom';
}

export function salesTrendGranularity(start: string, end: string): 'hour' | 'day' | 'week' {
  if (start === end) return 'hour';
  const days = differenceInCalendarDays(parseISO(end), parseISO(start)) + 1;
  if (days > 31) return 'week';
  return 'day';
}

export function formatSalesTrendNavLabel(
  preset: SalesTrendPreset,
  start: string,
  end: string
): string {
  const s = parseISO(start);
  const e = parseISO(end);

  switch (preset) {
    case 'day':
      return format(s, 'd MMM yyyy');
    case 'week':
      if (format(s, 'yyyy-MM') === format(e, 'yyyy-MM')) {
        return `${format(s, 'd')} – ${format(e, 'd MMM yyyy')}`;
      }
      return `${format(s, 'd MMM')} – ${format(e, 'd MMM yyyy')}`;
    case 'month':
      return format(s, 'MMMM yyyy');
    case 'custom':
    default:
      if (start === end) return format(s, 'd MMM yyyy');
      if (format(s, 'yyyy') === format(e, 'yyyy')) {
        return `${format(s, 'd MMM')} – ${format(e, 'd MMM yyyy')}`;
      }
      return `${format(s, 'd MMM yyyy')} – ${format(e, 'd MMM yyyy')}`;
  }
}

function capEndAtToday(end: Date): Date {
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  return min([end, today]);
}

export function stepSalesTrendRange(
  preset: SalesTrendPreset,
  start: string,
  end: string,
  direction: -1 | 1
): DateRangeStrings {
  const s = parseISO(start);
  const e = parseISO(end);
  const today = new Date();

  if (direction === 1) {
    const endDay = parseISO(end);
    if (differenceInCalendarDays(today, endDay) <= 0) {
      return { start, end };
    }
  }

  switch (preset) {
    case 'day': {
      const next = addDays(s, direction);
      if (direction === 1 && isAfter(next, today)) {
        return { start, end };
      }
      const d = format(next, 'yyyy-MM-dd');
      return { start: d, end: d };
    }
    case 'week': {
      if (direction === -1) {
        const thisWeekStart = startOfWeek(s, { weekStartsOn: 1 });
        const prevWeekEnd = subDays(thisWeekStart, 1);
        const prevWeekStart = startOfWeek(prevWeekEnd, { weekStartsOn: 1 });
        return {
          start: format(prevWeekStart, 'yyyy-MM-dd'),
          end: format(prevWeekEnd, 'yyyy-MM-dd'),
        };
      }
      const nextWeekStart = addDays(endOfWeek(s, { weekStartsOn: 1 }), 1);
      if (isAfter(nextWeekStart, today)) {
        return { start, end };
      }
      const nextWeekEnd = capEndAtToday(endOfWeek(nextWeekStart, { weekStartsOn: 1 }));
      return {
        start: format(nextWeekStart, 'yyyy-MM-dd'),
        end: format(nextWeekEnd, 'yyyy-MM-dd'),
      };
    }
    case 'month': {
      const shifted = direction === -1 ? subMonths(s, 1) : addMonths(s, 1);
      const ms = startOfMonth(shifted);
      if (direction === 1 && isAfter(ms, today)) {
        return { start, end };
      }
      const me = capEndAtToday(endOfMonth(shifted));
      return {
        start: format(ms, 'yyyy-MM-dd'),
        end: format(me, 'yyyy-MM-dd'),
      };
    }
    case 'custom':
    default: {
      const span = differenceInCalendarDays(e, s) + 1;
      if (direction === -1) {
        return {
          start: format(subDays(s, span), 'yyyy-MM-dd'),
          end: format(subDays(s, 1), 'yyyy-MM-dd'),
        };
      }
      const newStart = addDays(e, 1);
      if (isAfter(newStart, today)) {
        return { start, end };
      }
      const newEnd = capEndAtToday(addDays(newStart, span - 1));
      return {
        start: format(newStart, 'yyyy-MM-dd'),
        end: format(newEnd, 'yyyy-MM-dd'),
      };
    }
  }
}

export function canStepSalesTrendForward(end: string): boolean {
  const todayStr = format(new Date(), 'yyyy-MM-dd');
  return end < todayStr;
}
