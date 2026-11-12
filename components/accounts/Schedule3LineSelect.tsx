'use client';

import React from 'react';
import {
  ASSIGNABLE_SCHEDULE3_LINES,
  SCHEDULE3_LINE_LABELS,
  type Schedule3Line,
} from '@/lib/accounting/schedule3-lines';

interface Props {
  /** '' = use the default placement for the account. */
  value: Schedule3Line | '';
  onChange: (value: Schedule3Line | '') => void;
  disabled?: boolean;
}

export function Schedule3LineSelect({ value, onChange, disabled }: Props) {
  return (
    <div>
      <label className="block text-sm font-medium text-text-secondary mb-1">Schedule III line</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as Schedule3Line | '')}
        className="input w-full"
        disabled={disabled}
        data-testid="schedule3-line-select"
      >
        <option value="">Default</option>
        {ASSIGNABLE_SCHEDULE3_LINES.map((l) => (
          <option key={l} value={l}>
            {SCHEDULE3_LINE_LABELS[l]}
          </option>
        ))}
      </select>
    </div>
  );
}
