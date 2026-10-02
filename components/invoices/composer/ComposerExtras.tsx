'use client';

import { useEffect, useRef, useState } from 'react';
import { clsx } from 'clsx';
import { Keyboard, Loader2, Paperclip, StickyNote, X } from 'lucide-react';
import type { ComposerAttachment } from './types';
import { Kbd, SectionLabel } from './ui';

export function NotesAndAttachments({
  notes,
  setNotes,
  attachments,
  onUpload,
  onRemoveAttachment,
  uploading,
  readOnly,
}: {
  notes: string;
  setNotes: (v: string) => void;
  attachments: ComposerAttachment[];
  onUpload: (files: File[]) => void;
  onRemoveAttachment: (id: string) => void;
  uploading: boolean;
  readOnly: boolean;
}) {
  const [showNotes, setShowNotes] = useState(!!notes.trim());
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (notes.trim()) setShowNotes(true);
  }, [notes]);

  return (
    <div className="flex min-w-0 flex-col gap-4 p-4">
      <div>
        <div className="mb-2 flex items-center justify-between">
          <SectionLabel>Notes &amp; terms</SectionLabel>
        </div>
        {showNotes || readOnly ? (
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={readOnly}
            autoFocus={!readOnly && !notes}
            rows={4}
            placeholder="Thank you for your business. Goods once sold will not be taken back."
            className="w-full resize-none rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none transition placeholder:text-text-muted focus:border-primary-500 focus:ring-4 focus:ring-primary-100 disabled:bg-slate-50 dark:disabled:bg-slate-800/50"
          />
        ) : (
          <button
            type="button"
            onClick={() => setShowNotes(true)}
            className="flex w-full items-center gap-2 rounded-lg border border-dashed border-border px-3 py-3 text-left text-sm text-text-secondary transition hover:border-primary-300 hover:bg-primary-50/40 hover:text-primary-700"
          >
            <StickyNote className="h-4 w-4" /> Add notes or terms printed on the invoice
          </button>
        )}
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <SectionLabel>Attachments</SectionLabel>
          {attachments.length > 0 && <span className="text-[11px] text-text-muted">{attachments.length} file(s)</span>}
        </div>
        {attachments.length > 0 && (
          <ul className="mb-2 space-y-1.5">
            {attachments.map((f) => (
              <li
                key={f.id}
                className="flex items-center gap-2 rounded-lg border border-border bg-slate-50/60 px-2.5 py-1.5 text-sm dark:bg-slate-800/40"
              >
                <Paperclip className="h-3.5 w-3.5 shrink-0 text-text-muted" />
                <a
                  href={f.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-w-0 flex-1 truncate text-text-primary hover:text-primary-700 hover:underline"
                >
                  {f.name}
                </a>
                {f.size ? <span className="shrink-0 text-xs text-text-muted">{(f.size / 1024).toFixed(0)} KB</span> : null}
                {!readOnly && (
                  <button
                    type="button"
                    onClick={() => onRemoveAttachment(f.id)}
                    className="rounded p-0.5 text-text-muted hover:text-rose-600"
                    aria-label={`Remove ${f.name}`}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {!readOnly && (
          <>
            <input
              ref={fileRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                const files = Array.from(e.target.files || []);
                if (files.length) onUpload(files);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
              className={clsx(
                'inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-text-secondary transition hover:border-primary-300 hover:text-primary-700',
                uploading && 'cursor-wait opacity-70'
              )}
            >
              {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Paperclip className="h-3.5 w-3.5" />}
              {uploading ? 'Uploading…' : 'Attach files'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

const SHORTCUT_GROUPS: { title: string; items: { keys: string[]; label: string }[] }[] = [
  {
    title: 'Billing flow',
    items: [
      { keys: ['F2'], label: 'Search / change customer' },
      { keys: ['F3'], label: 'Add items (or start typing on the bar)' },
      { keys: ['F4'], label: 'Barcode / item code box' },
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
      { keys: ['↑'], label: 'From Add items bar: edit last row' },
      { keys: ['Enter'], label: 'Next cell (qty → price → discount)' },
      { keys: ['↑', '↓'], label: 'Same cell, previous / next row' },
      { keys: ['Ctrl', 'Del'], label: 'Remove row' },
    ],
  },
  {
    title: 'Save',
    items: [
      { keys: ['Ctrl', 'S'], label: 'Save' },
      { keys: ['Ctrl', 'Shift', 'S'], label: 'Save as draft' },
      { keys: ['Ctrl', 'P'], label: 'Preview' },
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
      <div role="dialog" aria-modal="true" className="w-full max-w-2xl rounded-2xl bg-surface p-6 shadow-2xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-base font-bold text-text-primary">
            <Keyboard className="h-5 w-5 text-primary-600" /> Keyboard shortcuts
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-text-muted hover:bg-slate-100 dark:hover:bg-slate-800"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="grid gap-6 sm:grid-cols-2">
          {SHORTCUT_GROUPS.map((g) => (
            <div key={g.title}>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-text-muted">{g.title}</p>
              <ul className="space-y-1.5">
                {g.items.map((it) => (
                  <li key={it.label} className="flex items-center justify-between gap-3 text-sm text-text-secondary">
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
