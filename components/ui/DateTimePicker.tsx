'use client';

import React, { useState, useRef, useEffect } from 'react';
import { DayPicker } from 'react-day-picker';
import { format, addMonths, subMonths } from 'date-fns';
import { Calendar as CalendarIcon, Clock } from 'lucide-react';
import { clsx } from 'clsx';

interface DateTimePickerProps {
  value: string; // ISO datetime string or YYYY-MM-DDTHH:mm format
  onChange: (datetime: string) => void; // Returns ISO string
  placeholder?: string;
  minDate?: string;
  maxDate?: string;
  className?: string;
}

export function DateTimePicker({ 
  value, 
  onChange, 
  placeholder = 'Select date & time',
  minDate,
  maxDate,
  className 
}: DateTimePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedDateTime, setSelectedDateTime] = useState<Date | undefined>(
    value ? new Date(value) : undefined
  );
  const [currentMonth, setCurrentMonth] = useState<Date>(
    selectedDateTime || new Date()
  );
  const [timeValue, setTimeValue] = useState<string>(
    selectedDateTime ? format(selectedDateTime, 'HH:mm') : '17:00'
  );
  const containerRef = useRef<HTMLDivElement>(null);

  // Update selectedDateTime when value prop changes
  useEffect(() => {
    if (value) {
      const date = new Date(value);
      setSelectedDateTime(date);
      setCurrentMonth(date);
      setTimeValue(format(date, 'HH:mm'));
    } else {
      setSelectedDateTime(undefined);
      setTimeValue('17:00');
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
      // Combine selected date with current time
      const [hours, minutes] = timeValue.split(':').map(Number);
      date.setHours(hours || 17, minutes || 0, 0, 0);
      setSelectedDateTime(date);
      onChange(date.toISOString());
    }
  };

  const handleTimeChange = (time: string) => {
    setTimeValue(time);
    if (selectedDateTime) {
      const [hours, minutes] = time.split(':').map(Number);
      const newDateTime = new Date(selectedDateTime);
      newDateTime.setHours(hours || 17, minutes || 0, 0, 0);
      setSelectedDateTime(newDateTime);
      onChange(newDateTime.toISOString());
    } else {
      // If no date selected yet, use today's date with the time
      const today = new Date();
      const [hours, minutes] = time.split(':').map(Number);
      today.setHours(hours || 17, minutes || 0, 0, 0);
      setSelectedDateTime(today);
      setCurrentMonth(today);
      onChange(today.toISOString());
    }
  };

  const handleMonthChange = (month: Date) => {
    setCurrentMonth(month);
  };

  const goToToday = () => {
    const today = new Date();
    const [hours, minutes] = timeValue.split(':').map(Number);
    today.setHours(hours || 17, minutes || 0, 0, 0);
    setCurrentMonth(today);
    handleDateSelect(today);
  };

  const displayValue = selectedDateTime 
    ? `${format(selectedDateTime, 'dd-MM-yyyy')} at ${format(selectedDateTime, 'HH:mm')}`
    : '';

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
        <Clock className="w-4 h-4 text-text-muted shrink-0" />
      </div>

      {/* DateTime Popup */}
      {isOpen && (
        <div
          className={clsx(
            'absolute top-full left-0 mt-2 z-50 overflow-hidden min-w-[360px] rounded-xl border shadow-xl',
            'border-border bg-surface text-text-primary',
            'dark:border-slate-600 dark:bg-slate-800 dark:[color-scheme:dark]'
          )}
        >
          {/* Header */}
          <div className="p-4 border-b border-border dark:border-slate-600">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-text-primary">Select Date & Time</h3>
              <div className="w-12 h-12 bg-warning rounded-lg flex items-center justify-center">
                <CalendarIcon className="w-6 h-6 text-white" />
              </div>
            </div>
            
            {/* Month/Year Selector */}
            <div className="flex items-center gap-2 mb-4">
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

            {/* Time Selector */}
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-warning shrink-0" />
              <label className="text-sm font-medium text-text-secondary">Time:</label>
              <input
                type="time"
                value={timeValue}
                onChange={(e) => handleTimeChange(e.target.value)}
                className="flex-1 min-w-0 px-3 py-2 rounded-lg border border-border bg-surface text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-warning/20 focus:border-warning dark:border-slate-600 dark:bg-slate-900"
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          </div>

          {/* Calendar — wrapper sets color so RDP day buttons (color: inherit) are readable */}
          <div className="p-4 text-text-primary">
            <DayPicker
              mode="single"
              selected={selectedDateTime}
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
                caption: 'hidden',
                nav: 'hidden',
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
              onClick={() => {
                setSelectedDateTime(undefined);
                setTimeValue('17:00');
                onChange('');
                setIsOpen(false);
              }}
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
