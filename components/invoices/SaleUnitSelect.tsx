'use client';

import { clsx } from 'clsx';
import type { SaleUnitOption } from '@/lib/invoices/use-item-units';

/**
 * The unit of a bill line. Plain text when the item has only its own unit; a small select when
 * it also sells in boxes, bags... Read-only bills always show text.
 */
export function SaleUnitSelect({
  unit,
  units,
  onChange,
  disabled,
  className,
}: {
  unit: string;
  units?: SaleUnitOption[];
  onChange: (unit: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  if (!units || units.length < 2 || disabled) {
    return (
      <span className={clsx('truncate text-[11px] font-medium text-text-muted', className)} title={unit}>
        {unit}
      </span>
    );
  }
  const current = units.find((u) => u.unit.toUpperCase() === String(unit || '').toUpperCase())?.unit ?? unit;
  return (
    <select
      value={current}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Unit"
      className={clsx(
        'h-7 rounded-md border border-border bg-surface px-1 text-[11px] font-medium text-text-primary outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:focus:ring-primary-900/40',
        className
      )}
    >
      {units.map((u, i) => (
        // Plain names keep the narrow cell readable; the note under the line gives the pieces.
        <option key={u.unit} value={u.unit} title={i === 0 ? undefined : `${u.factor} ${units[0].unit}`}>
          {u.unit}
        </option>
      ))}
    </select>
  );
}
