'use client';

import React, { useState, useRef, useEffect } from 'react';
import { DayPicker } from 'react-day-picker';
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, addMonths, subMonths, isSameDay } from 'date-fns';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon } from 'lucide-react';
import { clsx } from 'clsx';

interface DatePickerProps {
  value: string; // YYYY-MM-DD format
  onChange: (date: string) => void;
  placeholder?: string;
  minDate?: string;
  maxDate?: string;
  className?: string;
}

export function DatePicker({ 
  value, 
  onChange, 
  placeholder = 'Select Date',
  minDate,
  maxDate,
  className 
}: DatePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(
    value ? new Date(value + 'T00:00:00') : undefined
  );
  const [currentMonth, setCurrentMonth] = useState<Date>(
    selectedDate || new Date()
  );
  const containerRef = useRef<HTMLDivElement>(null);

  // Update selectedDate when value prop changes
  useEffect(() => {
    if (value) {
      const date = new Date(value + 'T00:00:00');
      setSelectedDate(date);
      setCurrentMonth(date);
    } else {
      setSelectedDate(undefined);
    }
  }, [value]);

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  const handleDateSelect = (date: Date | undefined) => {
    if (date) {
      setSelectedDate(date);
      onChange(format(date, 'yyyy-MM-dd'));
      setIsOpen(false);
    }
  };

  const handleMonthChange = (month: Date) => {
    setCurrentMonth(month);
  };

  const goToPreviousMonth = () => {
    setCurrentMonth(subMonths(currentMonth, 1));
  };

  const goToNextMonth = () => {
    setCurrentMonth(addMonths(currentMonth, 1));
  };

  const goToToday = () => {
    const today = new Date();
    setCurrentMonth(today);
    handleDateSelect(today);
  };

  const displayValue = selectedDate ? format(selectedDate, 'dd-MM-yyyy') : '';

  return (
    <div ref={containerRef} className={clsx('relative', className)}>
      {/* Input Field */}
      <div
        onClick={() => setIsOpen(!isOpen)}
        className={clsx(
          'w-full h-10 px-3 border border-border rounded-lg bg-surface text-text-primary',
          'flex items-center justify-between cursor-pointer',
          'hover:border-warning/50 focus-within:border-warning focus-within:ring-2 focus-within:ring-warning/20',
          'transition-colors'
        )}
      >
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <CalendarIcon className="w-4 h-4 text-warning shrink-0" />
          <span className={clsx('text-sm truncate', !displayValue && 'text-text-muted')}>
            {displayValue || placeholder}
          </span>
        </div>
      </div>

      {/* Calendar Popup */}
      {isOpen && (
        <div
          className={clsx(
            'absolute top-full left-0 mt-2 z-50 overflow-hidden min-w-[320px] rounded-xl border shadow-xl',
            'border-border bg-surface text-text-primary',
            'dark:border-slate-600 dark:bg-slate-800 dark:[color-scheme:dark]'
          )}
        >
          {/* Header */}
          <div className="p-4 border-b border-border dark:border-slate-600">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-text-primary">Select Date</h3>
              <div className="w-12 h-12 bg-warning rounded-lg flex items-center justify-center">
                <CalendarIcon className="w-6 h-6 text-white" />
              </div>
            </div>
            
            {/* Month/Year Selector */}
            <div className="flex items-center gap-2">
              <select
                value={format(currentMonth, 'MMMM')}
                onChange={(e) => {
                  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                    'July', 'August', 'September', 'October', 'November', 'December'];
                  const monthIndex = monthNames.indexOf(e.target.value);
                  const newDate = new Date(currentMonth);
                  newDate.setMonth(monthIndex);
                  setCurrentMonth(newDate);
                }}
                className="flex-1 px-3 py-2 rounded-lg border border-border bg-surface text-sm font-medium text-text-primary focus:outline-none focus:ring-2 focus:ring-warning/20 focus:border-warning dark:border-slate-600 dark:bg-slate-900"
                onClick={(e) => e.stopPropagation()}
              >
                {['January', 'February', 'March', 'April', 'May', 'June',
                  'July', 'August', 'September', 'October', 'November', 'December'].map((month) => (
                  <option key={month} value={month}>{month}</option>
                ))}
              </select>
              <select
                value={currentMonth.getFullYear()}
                onChange={(e) => {
                  const newDate = new Date(currentMonth);
                  newDate.setFullYear(parseInt(e.target.value));
                  setCurrentMonth(newDate);
                }}
                className="flex-1 px-3 py-2 rounded-lg border border-border bg-surface text-sm font-medium text-text-primary focus:outline-none focus:ring-2 focus:ring-warning/20 focus:border-warning dark:border-slate-600 dark:bg-slate-900"
                onClick={(e) => e.stopPropagation()}
              >
                {Array.from({ length: 10 }, (_, i) => new Date().getFullYear() - 5 + i).map((year) => (
                  <option key={year} value={year}>{year}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Calendar */}
          <div className="p-4 text-text-primary">
            <DayPicker
              mode="single"
              selected={selectedDate}
              onSelect={handleDateSelect}
              month={currentMonth}
              onMonthChange={handleMonthChange}
              disabled={(date) => {
                if (minDate) {
                  const min = new Date(minDate + 'T00:00:00');
                  if (date < min) return true;
                }
                if (maxDate) {
                  const max = new Date(maxDate + 'T23:59:59');
                  if (date > max) return true;
                }
                return false;
              }}
              classNames={{
                months: 'flex flex-col',
                month: 'space-y-4',
                caption: 'hidden', // Hide default caption since we have custom header
                nav: 'hidden', // Hide default nav buttons
                table: 'w-full border-collapse',
                head_row: 'flex',
                head_cell:
                  'text-text-secondary rounded-md w-10 h-10 font-normal text-xs flex items-center justify-center [&:first-child]:text-warning [&:first-child]:font-semibold',
                row: 'flex w-full mt-1',
                cell: 'text-center text-sm p-0 relative w-10 h-10 flex items-center justify-center',
                day: 'h-10 w-10 p-0 font-normal rounded-lg transition-colors text-text-primary hover:bg-warning/15 dark:hover:bg-warning/25',
                day_selected:
                  'bg-warning text-white hover:bg-warning/90 hover:text-white focus:bg-warning focus:text-white font-semibold',
                day_today: 'bg-warning/15 text-warning font-semibold dark:bg-warning/25',
                day_outside: 'text-text-muted opacity-60',
                day_disabled: 'text-text-muted opacity-40 cursor-not-allowed',
                day_hidden: 'invisible',
              }}
              modifiersClassNames={{
                selected: 'bg-warning text-white',
                today: 'bg-warning/10 text-warning',
              }}
            />
          </div>

          {/* Footer */}
          <div className="p-4 border-t border-border dark:border-slate-600 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary transition-colors"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={goToToday}
              className="px-6 py-2 bg-warning text-white text-sm font-medium rounded-lg hover:bg-warning/90 transition-colors"
            >
              Today
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
