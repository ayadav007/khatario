'use client';

import React from 'react';
import { Input } from '@/components/ui/Input';
import type { CustomFieldDefinition, CustomFieldValues } from '@/types/custom-fields';

interface CustomFieldValuesFormProps {
  definitions: CustomFieldDefinition[];
  values: CustomFieldValues;
  onChange: (values: CustomFieldValues) => void;
  disabled?: boolean;
  className?: string;
}

export function CustomFieldValuesForm({
  definitions,
  values,
  onChange,
  disabled = false,
  className = '',
}: CustomFieldValuesFormProps) {
  if (definitions.length === 0) return null;

  const setValue = (key: string, raw: string) => {
    onChange({
      ...values,
      [key]: raw === '' ? null : raw,
    });
  };

  return (
    <div className={`space-y-3 ${className}`}>
      {definitions.map((def) => {
        const val = values[def.field_key];
        const strVal = val === null || val === undefined ? '' : String(val);

        if (def.field_type === 'dropdown' && def.options.length > 0) {
          return (
            <div key={def.id}>
              <label className="block text-xs font-semibold uppercase text-text-secondary mb-1">
                {def.label}
                {def.is_required ? <span className="text-error"> *</span> : null}
              </label>
              <select
                className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary-500"
                value={strVal}
                disabled={disabled}
                onChange={(e) => setValue(def.field_key, e.target.value)}
              >
                <option value="">—</option>
                {def.options.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>
          );
        }

        if (def.field_type === 'date') {
          return (
            <div key={def.id}>
              <label className="block text-xs font-semibold uppercase text-text-secondary mb-1">
                {def.label}
                {def.is_required ? <span className="text-error"> *</span> : null}
              </label>
              <Input
                type="date"
                value={strVal}
                disabled={disabled}
                onChange={(e) => setValue(def.field_key, e.target.value)}
              />
            </div>
          );
        }

        return (
          <div key={def.id}>
            <label className="block text-xs font-semibold uppercase text-text-secondary mb-1">
              {def.label}
              {def.is_required ? <span className="text-error"> *</span> : null}
            </label>
            <Input
              type={def.field_type === 'number' ? 'number' : 'text'}
              value={strVal}
              disabled={disabled}
              onChange={(e) => setValue(def.field_key, e.target.value)}
              placeholder={def.label}
            />
          </div>
        );
      })}
    </div>
  );
}
