'use client';

import React, { createContext, useContext, useState, useCallback, ReactNode, useEffect, useRef } from 'react';

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
}

const DateRangeContext = createContext<DateRangeContextType | undefined>(undefined);

export function DateRangeProvider({ children }: { children: ReactNode }) {
  const [dateRange, setDateRangeState] = useState<DateRange | null>(null);
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

  return (
    <DateRangeContext.Provider value={{ dateRange, setDateRange, registerHandler }}>
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
