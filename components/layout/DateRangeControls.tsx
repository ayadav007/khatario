'use client';

import React, { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  addDays,
  addMonths,
  differenceInCalendarDays,
  endOfMonth,
  endOfWeek,
  format,
  isAfter,
  isSameDay,
  isSameMonth,
  startOfDay,
  startOfMonth,
  startOfWeek,
  subDays,
} from 'date-fns';
import { DayPicker } from 'react-day-picker';
import 'react-day-picker/dist/style.css';
import type { DateRange } from 'react-day-picker';

/**
 * Dashboard date controls: the mobile stepper in the TopBar, the desktop select in the TopBar
 * (HR dashboard) or beside "How the business did" (main dashboard). The chosen preset and custom
 * range live in DateRangeContext so every instance shows the same period.
 */
export function DateRangeControls({
  dateRange,
  setDateRange,
  selectedRange,
  setSelectedRange,
  showDatePicker,
  setShowDatePicker,
  datePickerRef,
  numberOfMonths,
  className,
  variant = 'select',
  align = 'left',
}: {
  dateRange: string;
  setDateRange: (v: string) => void;
  selectedRange: DateRange | undefined;
  setSelectedRange: (v: DateRange | undefined) => void;
  showDatePicker: boolean;
  setShowDatePicker: (v: boolean) => void;
  datePickerRef: React.RefObject<HTMLDivElement | null>;
  numberOfMonths: number;
  className?: string;
  variant?: 'select' | 'stepper';
  /** Which edge the calendar popover lines up with (select variant). */
  align?: 'left' | 'right';
}) {
  const [showPresetMenu, setShowPresetMenu] = useState(false);
  const today = startOfDay(new Date());

  useEffect(() => {
    if (variant !== 'stepper') return;
    const onDown = (event: MouseEvent) => {
      if (!datePickerRef.current?.contains(event.target as Node)) {
        setShowPresetMenu(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [variant, datePickerRef]);

  const bounds = (): { start: Date; end: Date } | null => {
    if (dateRange === 'today') return { start: today, end: today };
    if (dateRange === 'this_week') return { start: startOfWeek(today, { weekStartsOn: 1 }), end: today };
    if (dateRange === 'this_month') return { start: startOfMonth(today), end: today };
    if (dateRange === 'custom' && selectedRange?.from && selectedRange?.to) {
      return { start: startOfDay(selectedRange.from), end: startOfDay(selectedRange.to) };
    }
    return null;
  };

  const barLabel = () => {
    const current = bounds();
    if (!current) return 'Select dates';
    if (isSameDay(current.start, current.end)) return format(current.start, 'd MMM');
    if (isSameMonth(current.start, current.end)) {
      return `${format(current.start, 'd')}–${format(current.end, 'd MMM')}`;
    }
    return `${format(current.start, 'd MMM')} – ${format(current.end, 'd MMM')}`;
  };

  const canStepForward = () => {
    const current = bounds();
    if (!current) return false;
    return isAfter(today, startOfDay(current.end));
  };

  const applyPreset = (id: 'yesterday' | 'today' | 'this_week' | 'this_month' | 'custom') => {
    setShowPresetMenu(false);
    if (id === 'custom') {
      setDateRange('custom');
      setShowDatePicker(true);
      return;
    }
    if (id === 'yesterday') {
      const day = subDays(today, 1);
      setDateRange('custom');
      setSelectedRange({ from: day, to: day });
      setShowDatePicker(false);
      return;
    }
    setSelectedRange(undefined);
    setShowDatePicker(false);
    setDateRange(id);
  };

  const stepRange = (direction: -1 | 1) => {
    const current = bounds() ?? { start: today, end: today };
    let start = current.start;
    let end = current.end;
    if (dateRange === 'this_week') {
      const weekStart = addDays(startOfWeek(start, { weekStartsOn: 1 }), direction * 7);
      start = weekStart;
      end = endOfWeek(weekStart, { weekStartsOn: 1 });
    } else if (dateRange === 'this_month') {
      const month = addMonths(startOfMonth(start), direction);
      start = startOfMonth(month);
      end = endOfMonth(month);
    } else if (isSameDay(start, end)) {
      start = addDays(start, direction);
      end = start;
    } else {
      const span = differenceInCalendarDays(end, start) + 1;
      start = addDays(start, direction * span);
      end = addDays(end, direction * span);
    }
    if (direction === 1 && isAfter(start, today)) return;
    if (isAfter(end, today)) end = today;
    setShowPresetMenu(false);
    setShowDatePicker(false);
    setDateRange('custom');
    setSelectedRange({ from: start, to: end });
  };

  if (variant === 'stepper') {
    return (
      <div className="relative" ref={datePickerRef as React.Ref<HTMLDivElement>}>
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => stepRange(-1)}
            className="flex h-9 w-9 items-center justify-center text-text-secondary"
            aria-label="Previous dates"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={() => {
              setShowDatePicker(false);
              setShowPresetMenu((open) => !open);
            }}
            className="min-w-0 flex-1 text-center text-sm font-semibold uppercase tracking-wide text-text-primary"
            aria-expanded={showPresetMenu}
            aria-haspopup="listbox"
          >
            {barLabel()}
          </button>
          <button
            type="button"
            onClick={() => stepRange(1)}
            disabled={!canStepForward()}
            className="flex h-9 w-9 items-center justify-center text-text-secondary disabled:opacity-40"
            aria-label="Next dates"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
        {showPresetMenu && (
          <div className="absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-xl border border-border bg-surface shadow-xl">
            {(
              [
                ['yesterday', 'Yesterday'],
                ['today', 'Today'],
                ['this_week', 'This week'],
                ['this_month', 'This month'],
                ['custom', 'Custom'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => applyPreset(id)}
                className="block w-full px-4 py-3 text-left text-sm text-text-primary active:bg-slate-50"
              >
                {label}
              </button>
            ))}
          </div>
        )}
        {showDatePicker && dateRange === 'custom' && (
          <div className="absolute left-0 right-0 top-full z-50 mt-2 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-border bg-surface shadow-xl">
            <DayPicker
              mode="range"
              selected={selectedRange}
              onSelect={(range) => {
                setSelectedRange(range);
                if (range?.from && range?.to) setShowDatePicker(false);
              }}
              numberOfMonths={1}
              disabled={{ after: today }}
              className="p-4"
            />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={className ?? 'flex items-center gap-2 relative'} ref={datePickerRef as React.Ref<HTMLDivElement>}>
      <select
        className="input w-auto max-w-full text-sm"
        value={dateRange}
        onChange={(e) => {
          setDateRange(e.target.value);
          if (e.target.value === 'custom') {
            setShowDatePicker(true);
          } else {
            setShowDatePicker(false);
            setSelectedRange(undefined);
          }
        }}
      >
        <option value="today">Today</option>
        <option value="this_week">This Week</option>
        <option value="this_month">This Month</option>
        <option value="custom">Custom Range</option>
      </select>

      {showDatePicker && dateRange === 'custom' && (
        <div
          className={`absolute top-full mt-2 bg-surface border border-border rounded-xl shadow-xl z-50 overflow-hidden max-w-[calc(100vw-2rem)] lg:max-w-none ${
            align === 'right' ? 'right-0' : 'left-0 right-0 lg:right-auto lg:left-0'
          }`}
        >
          <DayPicker
            mode="range"
            selected={selectedRange}
            onSelect={setSelectedRange}
            numberOfMonths={numberOfMonths}
            className="p-4"
            classNames={{
              months: 'flex flex-col sm:flex-row space-y-4 sm:space-x-4 sm:space-y-0',
              month: 'space-y-4',
              caption: 'flex justify-center pt-1 relative items-center',
              caption_label: 'text-sm font-medium text-text-primary',
              nav: 'space-x-1 flex items-center',
              nav_button: 'h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100 text-text-primary',
              nav_button_previous: 'absolute left-1',
              nav_button_next: 'absolute right-1',
              table: 'w-full border-collapse space-y-1',
              head_row: 'flex',
              head_cell: 'text-text-secondary rounded-md w-9 font-normal text-[0.8rem]',
              row: 'flex w-full mt-2',
              cell: 'text-center text-sm p-0 relative [&:has([aria-selected])]:bg-slate-50 dark:[&:has([aria-selected])]:bg-primary-900/35 first:[&:has([aria-selected])]:rounded-l-md last:[&:has([aria-selected])]:rounded-md focus-within:relative focus-within:z-20',
              day: 'h-9 w-9 p-0 font-normal aria-selected:opacity-100 text-text-primary hover:bg-slate-100 dark:hover:bg-slate-700 rounded-md',
              day_selected: 'bg-primary-500 text-white hover:bg-primary-600 hover:text-white focus:bg-primary-500 focus:text-white',
              day_today: 'bg-slate-100 dark:bg-slate-800/50 text-primary-900 dark:text-primary-100 font-semibold',
              day_outside: 'text-text-muted opacity-50',
              day_disabled: 'text-text-muted opacity-50',
              day_range_middle: 'aria-selected:bg-slate-50 dark:aria-selected:bg-primary-900/25 aria-selected:text-primary-900 dark:aria-selected:text-primary-100',
              day_hidden: 'invisible',
            }}
          />
          <div className="border-t border-border p-3 flex gap-2">
            <button
              type="button"
              onClick={() => {
                setShowDatePicker(false);
                if (!selectedRange?.from || !selectedRange?.to) {
                  setSelectedRange(undefined);
                }
              }}
              className="flex-1 px-4 py-2 border border-border text-text-primary rounded-md text-sm font-medium hover:bg-slate-100/80 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                if (selectedRange?.from && selectedRange?.to) {
                  setShowDatePicker(false);
                }
              }}
              className="flex-1 px-4 py-2 bg-primary-500 text-white rounded-md text-sm font-medium hover:bg-primary-600 disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={!selectedRange?.from || !selectedRange?.to}
            >
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
