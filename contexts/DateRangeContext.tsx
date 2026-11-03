'use client';

import React, { createContext, useContext, useState, useCallback, ReactNode, useEffect, useRef, useMemo } from 'react';
import type { DateRange as DayPickerRange } from 'react-day-picker';

interface DateRange {
  start: string;
  end: string;
  label: string;
}

interface DateRangeContextType {
  dateRange: DateRange | null;
  setDateRange: (range: DateRange) => void;
  // Register a handler callback for date range changes (provided by dashboard page)
  registerHandler: (handler: ((range: DateRange) => void) | null) => void;
  /** Picker state shared by every DateRangeControls instance: 'today' | 'this_week' | 'this_month' | 'custom'. */
  preset: string;
  setPreset: (preset: string) => void;
  customRange: DayPickerRange | undefined;
  setCustomRange: (range: DayPickerRange | undefined) => void;
}

const DateRangeContext = createContext<DateRangeContextType | undefined>(undefined);

export function DateRangeProvider({ children }: { children: ReactNode }) {
  const [dateRange, setDateRangeState] = useState<DateRange | null>(null);
  const [preset, setPreset] = useState<string>('today');
  const [customRange, setCustomRange] = useState<DayPickerRange | undefined>(undefined);
  const handlerRef = useRef<((range: DateRange) => void) | null>(null);

  const registerHandler = useCallback((handler: ((range: DateRange) => void) | null) => {
    handlerRef.current = handler;
  }, []);

  const setDateRange = useCallback((range: DateRange) => {
    setDateRangeState(range);
    // If a handler is registered, call it
    if (handlerRef.current) {
      handlerRef.current(range);
    }
  }, []);

  const value = useMemo<DateRangeContextType>(
    () => ({ dateRange, setDateRange, registerHandler, preset, setPreset, customRange, setCustomRange }),
    [dateRange, setDateRange, registerHandler, preset, customRange]
  );

  return (
    <DateRangeContext.Provider value={value}>
      {children}
    </DateRangeContext.Provider>
  );
}

export function useDateRange() {
  const context = useContext(DateRangeContext);
  if (!context) {
    throw new Error('useDateRange must be used within DateRangeProvider');
  }
  return context;
}
