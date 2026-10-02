'use client';

import { useEffect } from 'react';
import { Keyboard, X } from 'lucide-react';
import { Kbd } from './Kbd';

const GROUPS: { title: string; items: { keys: string[]; label: string }[] }[] = [
  {
    title: 'Billing flow',
    items: [
      { keys: ['F2'], label: 'Search / change customer' },
      { keys: ['F3'], label: 'Add items (or start typing on the bar)' },
      { keys: ['F4'], label: 'Scan barcode' },
      { keys: ['F8'], label: 'Amount received' },
      { keys: ['F9'], label: 'Mark fully paid' },
      { keys: ['Alt', 'E'], label: 'Switch Domestic / Export' },
    ],
  },
  {
    title: 'Item picker',
    items: [
      { keys: ['↑', '↓'], label: 'Move between items' },
      { keys: ['Enter'], label: 'Add one more' },
      { keys: ['Shift', 'Enter'], label: 'Remove one' },
      { keys: ['F7'], label: 'Add selected to bill' },
      { keys: ['Esc'], label: 'Clear search, then close' },
    ],
  },
  {
    title: 'Items table',
    items: [
      { keys: ['Enter'], label: 'Next cell (qty → price → discount)' },
      { keys: ['↑', '↓'], label: 'Same cell, previous / next row' },
      { keys: ['Ctrl', 'Del'], label: 'Remove row' },
    ],
  },
  {
    title: 'Save',
    items: [
      { keys: ['Ctrl', 'S'], label: 'Save' },
      { keys: ['Ctrl', 'Shift', 'S'], label: 'Save & new' },
      { keys: ['Ctrl', 'P'], label: 'Toggle preview' },
      { keys: ['?'], label: 'Show this help' },
    ],
  },
];

export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === '?') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[95] flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div role="dialog" aria-modal="true" className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-2xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-base font-bold text-slate-900">
            <Keyboard className="h-5 w-5 text-primary-600" /> Keyboard shortcuts
          </h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="grid gap-6 sm:grid-cols-2">
          {GROUPS.map((g) => (
            <div key={g.title}>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{g.title}</p>
              <ul className="space-y-1.5">
                {g.items.map((it) => (
                  <li key={it.label} className="flex items-center justify-between gap-3 text-sm text-slate-700">
                    <span>{it.label}</span>
                    <span className="flex shrink-0 items-center gap-1">
                      {it.keys.map((k) => (
                        <Kbd key={k}>{k}</Kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
