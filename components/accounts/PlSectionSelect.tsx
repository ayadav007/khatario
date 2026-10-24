'use client';

import React from 'react';
import {
  allowedPlSections,
  PL_SECTION_HINTS,
  PL_SECTION_LABELS,
  type PlSection,
} from '@/lib/accounting/pl-sections';

interface Props {
  accountType: string;
  /** '' = use the default for the group. */
  value: PlSection | '';
  defaultSection: PlSection | null;
  onChange: (value: PlSection | '') => void;
  disabled?: boolean;
  disabledReason?: string;
}

export function PlSectionSelect({ accountType, value, defaultSection, onChange, disabled, disabledReason }: Props) {
  const options = allowedPlSections(accountType);
  if (options.length === 0) return null;
  const shown = (value || defaultSection) as PlSection | null;
  const contra =
    shown != null &&
    ((accountType === 'income' && (shown === 'operating_expense' || shown === 'cost_of_goods_sold')) ||
      (accountType === 'expense' && shown === 'operating_income'));

  return (
    <div>
      <label className="block text-sm font-medium text-text-secondary mb-1">Shows in Profit &amp; Loss as</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as PlSection | '')}
        className="input w-full"
        disabled={disabled}
        data-testid="pl-section-select"
      >
        {defaultSection && (
          <option value="">{PL_SECTION_LABELS[defaultSection]} (default for group)</option>
        )}
        {options
          .filter((s) => s !== defaultSection || value === s)
          .map((s) => (
            <option key={s} value={s}>
              {PL_SECTION_LABELS[s]}
            </option>
          ))}
      </select>
      <p className="text-xs text-text-secondary mt-1">
        {disabled && disabledReason
          ? disabledReason
          : shown
            ? PL_SECTION_HINTS[shown]
            : 'Pick a group first.'}
        {contra && !disabled && ' This account will show as a negative line in that section.'}
      </p>
    </div>
  );
}
