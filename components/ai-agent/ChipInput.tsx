'use client';

import React, { useState } from 'react';
import { Plus, X } from 'lucide-react';

export function ChipInput({
  values,
  onChange,
  placeholder,
  max = 20,
  maxLength = 60,
  addLabel = 'Add',
}: {
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  max?: number;
  maxLength?: number;
  addLabel?: string;
}) {
  const [draft, setDraft] = useState('');

  const add = () => {
    const v = draft.trim().slice(0, maxLength);
    if (!v || values.length >= max) return;
    if (!values.some((x) => x.toLowerCase() === v.toLowerCase())) onChange([...values, v]);
    setDraft('');
  };

  return (
    <div>
      {values.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {values.map((v) => (
            <span
              key={v}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-gray-50 py-0.5 pl-2.5 pr-1 text-xs text-text-primary dark:bg-slate-800"
            >
              {v}
              <button
                type="button"
                onClick={() => onChange(values.filter((x) => x !== v))}
                className="rounded-full p-0.5 text-text-muted hover:bg-gray-200 hover:text-text-primary dark:hover:bg-slate-700"
                aria-label={`Remove ${v}`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      {values.length < max && (
        <div className="flex gap-2">
          <input
            className="input flex-1"
            value={draft}
            maxLength={maxLength}
            placeholder={placeholder}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              }
            }}
          />
          <button
            type="button"
            onClick={add}
            disabled={!draft.trim()}
            className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-border px-3 text-sm font-medium text-text-primary hover:bg-gray-50 disabled:opacity-50 dark:hover:bg-slate-800"
          >
            <Plus className="h-4 w-4" /> {addLabel}
          </button>
        </div>
      )}
    </div>
  );
}
