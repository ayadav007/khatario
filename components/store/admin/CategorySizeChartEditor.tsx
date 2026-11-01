'use client';

import React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import type { SizeChart } from '@/lib/store/product-extras';
import {
  CHART_MAX_COLUMNS,
  CHART_MAX_ROWS,
  addColumn,
  addRow,
  emptyChart,
  removeColumn,
  removeRow,
  setCell,
  setHeader,
} from '@/lib/store/size-chart-grid';

interface Props {
  value: SizeChart | null;
  onChange: (next: SizeChart | null) => void;
}

const cellClass = 'input w-28 min-w-[7rem] px-2 py-1.5 text-sm';

/** Editable size chart grid. The first line of boxes is the column headings. */
export function CategorySizeChartEditor({ value, onChange }: Props) {
  if (!value) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-text-secondary dark:text-text-secondary-dark">
          No size chart yet. Shoppers see it as a "Size chart" button on the product page.
        </p>
        <Button type="button" variant="secondary" onClick={() => onChange(emptyChart())}>
          <Plus className="mr-2 h-4 w-4" />
          Add size chart
        </Button>
      </div>
    );
  }

  const chart = value;
  return (
    <div className="space-y-3">
      <p className="text-xs text-text-secondary dark:text-text-secondary-dark">
        The first line is the column headings (for example Size, Chest, Waist).
      </p>
      <div className="max-w-full overflow-x-auto pb-1">
        <table className="border-separate border-spacing-1">
          <thead>
            <tr>
              {chart.columns.map((col, ci) => (
                <th key={ci} className="align-top font-normal">
                  <input
                    className={`${cellClass} font-semibold`}
                    value={col}
                    maxLength={40}
                    placeholder={`Heading ${ci + 1}`}
                    aria-label={`Column ${ci + 1} heading`}
                    onChange={(e) => onChange(setHeader(chart, ci, e.target.value))}
                  />
                  {chart.columns.length > 1 ? (
                    <button
                      type="button"
                      className="mt-1 text-xs text-red-600 hover:underline"
                      onClick={() => onChange(removeColumn(chart, ci))}
                    >
                      Remove column
                    </button>
                  ) : null}
                </th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {chart.rows.map((row, ri) => (
              <tr key={ri}>
                {row.map((cell, ci) => (
                  <td key={ci}>
                    <input
                      className={cellClass}
                      value={cell}
                      maxLength={40}
                      aria-label={`Row ${ri + 1}, ${chart.columns[ci] || `column ${ci + 1}`}`}
                      onChange={(e) => onChange(setCell(chart, ri, ci, e.target.value))}
                    />
                  </td>
                ))}
                <td>
                  <button
                    type="button"
                    className="rounded-lg p-2 text-red-600 hover:bg-red-50"
                    aria-label={`Remove row ${ri + 1}`}
                    onClick={() => onChange(removeRow(chart, ri))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          disabled={chart.rows.length >= CHART_MAX_ROWS}
          onClick={() => onChange(addRow(chart))}
        >
          <Plus className="mr-1 h-4 w-4" />
          Add row ({chart.rows.length} of {CHART_MAX_ROWS})
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={chart.columns.length >= CHART_MAX_COLUMNS}
          onClick={() => onChange(addColumn(chart))}
        >
          <Plus className="mr-1 h-4 w-4" />
          Add column ({chart.columns.length} of {CHART_MAX_COLUMNS})
        </Button>
        <Button type="button" variant="secondary" onClick={() => onChange(null)}>
          Clear chart
        </Button>
      </div>
    </div>
  );
}
