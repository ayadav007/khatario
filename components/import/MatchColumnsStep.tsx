'use client';

import React from 'react';
import { Button } from '@/components/ui/Button';
import type { ColumnMatches, DateOrder, ImportField } from '@/lib/import/types';

interface MatchColumnsStepProps {
  headers: string[];
  samples: string[][];
  fields: ImportField[];
  rowCount: number;
  columnMatches: ColumnMatches;
  needsDateOrder: boolean;
  dateOrder: DateOrder;
  missingRequired: string[];
  onMatch(column: number, field: string | null): void;
  onDateOrder(order: DateOrder): void;
  onBack(): void;
  onNext(): void;
}

/** One line per file column: its heading, up to 3 sample values, and the field it fills. */
export function MatchColumnsStep({
  headers,
  samples,
  fields,
  rowCount,
  columnMatches,
  needsDateOrder,
  dateOrder,
  missingRequired,
  onMatch,
  onDateOrder,
  onBack,
  onNext,
}: MatchColumnsStepProps) {
  const usedBy = new Map<string, number>();
  headers.forEach((_, i) => {
    const key = columnMatches[i];
    if (key) usedBy.set(key, i);
  });

  return (
    <div className="space-y-4">
      <p className="text-sm text-text-secondary">
        {rowCount} rows found. Choose what each column in your file holds.
      </p>

      <ul className="divide-y divide-border rounded-lg border border-border">
        {headers.map((header, i) => {
          const values = samples
            .map((row) => String(row[i] ?? '').trim())
            .filter(Boolean)
            .slice(0, 3);
          const selectId = `import-column-${i}`;
          return (
            <li key={i} className="flex flex-col gap-2 p-3 md:grid md:grid-cols-3 md:items-center md:gap-4">
              <label htmlFor={selectId} className="min-w-0 break-words font-medium text-text-primary">
                {header || `Column ${i + 1}`}
              </label>
              <p className="min-w-0 break-words text-sm text-text-secondary">{values.length > 0 ? values.join(', ') : '—'}</p>
              <select
                id={selectId}
                className="input w-full"
                value={columnMatches[i] ?? ''}
                onChange={(e) => onMatch(i, e.target.value === '' ? null : e.target.value)}
              >
                <option value="">Don&apos;t import</option>
                {fields.map((f) => {
                  const owner = usedBy.get(f.key);
                  return (
                    <option key={f.key} value={f.key} disabled={owner !== undefined && owner !== i}>
                      {f.required ? `${f.label} (required)` : f.label}
                    </option>
                  );
                })}
              </select>
            </li>
          );
        })}
      </ul>

      {needsDateOrder ? (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-text-primary">
            Is 01-04-2026 the 1st of April or the 4th of January?
          </legend>
          <label className="flex min-h-11 items-center gap-2 text-sm text-text-primary">
            <input type="radio" name="import-date-order" checked={dateOrder === 'dmy'} onChange={() => onDateOrder('dmy')} />
            1st of April
          </label>
          <label className="flex min-h-11 items-center gap-2 text-sm text-text-primary">
            <input type="radio" name="import-date-order" checked={dateOrder === 'mdy'} onChange={() => onDateOrder('mdy')} />
            4th of January
          </label>
        </fieldset>
      ) : null}

      {missingRequired.length > 0 ? (
        <p role="status" className="text-sm text-amber-700 dark:text-amber-300">
          Match a column to: {missingRequired.join(', ')}
        </p>
      ) : null}

      <div className="flex justify-between gap-2">
        <Button variant="secondary" onClick={onBack}>
          Back
        </Button>
        <Button onClick={onNext} disabled={missingRequired.length > 0}>
          Next
        </Button>
      </div>
    </div>
  );
}
