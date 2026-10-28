'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import type { CustomFieldDefinition } from '@/types/custom-fields';
import { ALWAYS_PRINTED_COLUMNS, DEFAULT_DISTRIBUTOR_COLUMNS, ITEM_COLUMNS } from '@/lib/print/item-columns';
import { isStatutoryDocument } from '@/lib/invoice-statutory';

/** Above this many columns an A4 portrait page gets cramped. */
const CROWDED_AT = 16;

/**
 * Tick and order the item-table columns for templates that print a chosen column set.
 * `value` empty means the template default; the first change saves the full ordered list.
 */
export function ItemColumnChooser({
  value,
  onChange,
  documentType,
}: {
  value: string[] | undefined;
  onChange: (next: string[]) => void;
  documentType: string;
}) {
  const { business, user } = useAuth();
  const [itemDefs, setItemDefs] = useState<CustomFieldDefinition[]>([]);

  useEffect(() => {
    if (!business?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/custom-fields?business_id=${business.id}&user_id=${user?.id || ''}`);
        const data = await res.json();
        if (!cancelled && res.ok) {
          setItemDefs(((data.definitions || []) as CustomFieldDefinition[]).filter((d) => d.entity_type === 'item'));
        }
      } catch {
        // Custom columns are optional; the built-in ones still work.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [business?.id, user?.id]);

  const all = useMemo(
    () => [
      ...ITEM_COLUMNS.map((c) => ({ id: c.id, label: c.label })),
      ...itemDefs.map((d) => ({ id: `cf:${d.field_key}`, label: `${d.label} (custom)` })),
    ],
    [itemDefs],
  );
  const labelOf = (id: string) => all.find((c) => c.id === id)?.label || id;
  const locked = isStatutoryDocument(documentType) ? ALWAYS_PRINTED_COLUMNS : [];

  const chosen = (value && value.length ? value : DEFAULT_DISTRIBUTOR_COLUMNS).filter((id) => all.some((c) => c.id === id));
  const unchosen = all.filter((c) => !chosen.includes(c.id));

  const move = (i: number, by: number) => {
    const next = [...chosen];
    const j = i + by;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  return (
    <div>
      <p className="mb-2 text-xs text-gray-500 dark:text-slate-400">
        Tick the columns to print and use the arrows to set their order. Columns with nothing to show on a bill
        (for example MRP when no item has one) are left out automatically.
      </p>
      <div className="space-y-0.5">
        {chosen.map((id, i) => {
          const isLocked = locked.includes(id);
          return (
            <div key={id} className="flex items-center gap-2 py-0.5">
              <input
                type="checkbox"
                checked
                disabled={isLocked}
                onChange={() => onChange(chosen.filter((x) => x !== id))}
                className="h-4 w-4 rounded accent-primary-600"
                aria-label={`Print ${labelOf(id)}`}
              />
              <span className="flex-1 text-[13px] text-gray-800 dark:text-slate-200">{labelOf(id)}</span>
              {isLocked && <span className="text-[11px] text-gray-400">Required by GST</span>}
              <button
                type="button"
                onClick={() => move(i, -1)}
                disabled={i === 0}
                className="p-1 text-gray-500 hover:text-gray-900 disabled:opacity-30"
                aria-label={`Move ${labelOf(id)} up`}
              >
                <ArrowUp className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => move(i, 1)}
                disabled={i === chosen.length - 1}
                className="p-1 text-gray-500 hover:text-gray-900 disabled:opacity-30"
                aria-label={`Move ${labelOf(id)} down`}
              >
                <ArrowDown className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })}
        {unchosen.length > 0 && <div className="border-t border-gray-100 my-2" />}
        {unchosen.map((c) => (
          <label key={c.id} className="flex items-center gap-2 py-0.5 cursor-pointer">
            <input
              type="checkbox"
              checked={false}
              onChange={() => onChange([...chosen, c.id])}
              className="h-4 w-4 rounded accent-primary-600"
            />
            <span className="text-[13px] text-gray-500 dark:text-slate-400">{c.label}</span>
          </label>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-3">
        <button type="button" onClick={() => onChange([])} className="text-xs font-medium text-primary-600 hover:text-primary-700">
          Reset to default
        </button>
        {chosen.length > CROWDED_AT && (
          <span className="text-xs text-amber-700">
            {chosen.length} columns is crowded on A4 portrait. Consider landscape under Page.
          </span>
        )}
      </div>
      {locked.length > 0 && (
        <p className="mt-1 text-[11px] text-gray-400">
          A quantity column and the GST amount columns always print on tax invoices.
        </p>
      )}
    </div>
  );
}
