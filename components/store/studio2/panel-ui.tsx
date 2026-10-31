'use client';

import { useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import { clsx } from 'clsx';
import { lengthCounter } from '@/lib/store/engine/editor/fields';
import { FieldShell } from './fields/SettingField';
import { inputCls } from './fields/pickers';

// Shared look of the right-hand panels (sections, blocks, theme, menus).

export const actionBtn =
  'inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40';
export const dangerBtn =
  'inline-flex items-center gap-1.5 rounded-md border border-red-200 px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40';

export function PanelHeader({ title, subtitle, back }: { title: string; subtitle?: string; back?: { label: string; onClick(): void } }) {
  return (
    <div className="border-b border-gray-200 px-4 py-3">
      {back && (
        <button type="button" onClick={back.onClick} className="mb-1 inline-flex items-center gap-0.5 text-xs text-gray-500 hover:text-gray-800">
          <ChevronLeft className="h-3.5 w-3.5" />
          {back.label}
        </button>
      )}
      <h2 className="truncate text-sm font-semibold text-gray-900">{title}</h2>
      {subtitle && <p className="text-xs text-gray-500">{subtitle}</p>}
    </div>
  );
}

/**
 * A labelled text box that never stores an empty value: the server drops an item without a label (and a menu
 * name falls back to "Menu"), so while the box is empty the stored text stays and a hint shows; leaving the box
 * puts the stored text back.
 */
export function RequiredTextField({
  id,
  label,
  value,
  max,
  emptyHint,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  max: number;
  emptyHint: string;
  onChange(v: string): void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? value;
  const empty = shown.trim() === '';
  return (
    <FieldShell label={label} htmlFor={id} counter={lengthCounter(shown, max)}>
      <input
        id={id}
        className={clsx(inputCls, empty && 'border-red-400')}
        value={shown}
        maxLength={max}
        aria-invalid={empty}
        onChange={(e) => {
          setDraft(e.target.value);
          if (e.target.value.trim() !== '') onChange(e.target.value);
        }}
        onBlur={() => setDraft(null)}
      />
      {empty && <p className="text-xs text-red-600">{emptyHint}</p>}
    </FieldShell>
  );
}
