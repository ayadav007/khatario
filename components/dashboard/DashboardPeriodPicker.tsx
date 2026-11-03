'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useDateRange } from '@/contexts/DateRangeContext';
import { DateRangeControls } from '@/components/layout/DateRangeControls';

/**
 * Desktop date range select beside "How the business did". Shares its preset and custom range with
 * the TopBar's mobile stepper through DateRangeContext; the TopBar computes the range and tells the
 * dashboard.
 */
export function DashboardPeriodPicker() {
  const { preset, setPreset, customRange, setCustomRange } = useDateRange();
  const [showDatePicker, setShowDatePicker] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showDatePicker) return;
    const onDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setShowDatePicker(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [showDatePicker]);

  return (
    <DateRangeControls
      dateRange={preset}
      setDateRange={setPreset}
      selectedRange={customRange}
      setSelectedRange={setCustomRange}
      showDatePicker={showDatePicker}
      setShowDatePicker={setShowDatePicker}
      datePickerRef={ref}
      numberOfMonths={2}
      align="right"
    />
  );
}
