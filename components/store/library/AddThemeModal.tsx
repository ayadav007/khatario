'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Loader2, Store, X } from 'lucide-react';
import { clsx } from 'clsx';
import { useToastContext } from '@/contexts/ToastContext';
import type { ThemePreset, ThemeRow } from '@/lib/store/engine/types';
import { LIMIT_NOTICE, MIGRATED_CHOICE, PRESET_CHOICES, THEME_NAME_MAX, canAddTheme } from '@/lib/store/engine/library';
import { createTheme } from './api';

type Choice = ThemePreset | 'migrated';

interface AddThemeModalProps {
  /** Themes the business has now (D43: Add is disabled at 20). */
  count: number;
  onClose(): void;
  onCreated(theme: ThemeRow): void;
}

/** D43: one of the five presets or the store's current design, and an optional name (empty takes the server's). */
export function AddThemeModal({ count, onClose, onCreated }: AddThemeModalProps) {
  const toast = useToastContext();
  const titleId = useId();
  const nameId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [choice, setChoice] = useState<Choice>('studio');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const full = !canAddTheme(count);

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    formRef.current?.querySelector<HTMLInputElement>('input[type="radio"]:checked')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busyRef.current) {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (opener?.isConnected) opener.focus();
    };
  }, [onClose]);

  const submit = async () => {
    if (busyRef.current || full) return;
    busyRef.current = true;
    setBusy(true);
    const trimmed = name.trim();
    try {
      const theme = await createTheme(
        choice === 'migrated'
          ? { source: 'migrated', ...(trimmed ? { name: trimmed } : {}) }
          : { preset: choice, ...(trimmed ? { name: trimmed } : {}) },
      );
      onCreated(theme);
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : 'Failed to create the theme');
      busyRef.current = false;
      setBusy(false);
    }
  };

  const optionCls = (selected: boolean) =>
    clsx(
      'flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-left transition-colors focus-within:ring-2 focus-within:ring-primary-300',
      selected ? 'border-primary-500 bg-primary-50 ring-1 ring-primary-500' : 'border-gray-200 hover:bg-gray-50',
    );

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busyRef.current) onClose();
      }}
    >
      <form
        ref={formRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex max-h-[92vh] w-full max-w-lg flex-col rounded-t-xl bg-white shadow-xl sm:rounded-xl"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3">
          <h2 id={titleId} className="text-base font-semibold text-gray-900">
            Add theme
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <fieldset className="space-y-2">
            <legend className="mb-2 text-xs font-medium text-gray-700">Start from</legend>
            {PRESET_CHOICES.map((c) => (
              <label key={c.preset} className={optionCls(choice === c.preset)}>
                <input
                  type="radio"
                  name="theme-start"
                  value={c.preset}
                  checked={choice === c.preset}
                  onChange={() => setChoice(c.preset)}
                  className="sr-only"
                />
                <span className="mt-0.5 flex shrink-0 overflow-hidden rounded-md border border-gray-200" aria-hidden>
                  <span className="h-8 w-5" style={{ background: c.canvas }} />
                  <span className="h-8 w-5" style={{ background: c.accent }} />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-gray-900">{c.label}</span>
                  <span className="block text-xs text-gray-500">{c.description}</span>
                </span>
              </label>
            ))}
            <label className={optionCls(choice === 'migrated')}>
              <input
                type="radio"
                name="theme-start"
                value="migrated"
                checked={choice === 'migrated'}
                onChange={() => setChoice('migrated')}
                className="sr-only"
              />
              <span className="mt-0.5 flex h-8 w-10 shrink-0 items-center justify-center rounded-md border border-gray-200 bg-gray-50" aria-hidden>
                <Store className="h-4 w-4 text-gray-500" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium text-gray-900">{MIGRATED_CHOICE.label}</span>
                <span className="block text-xs text-gray-500">{MIGRATED_CHOICE.description}</span>
              </span>
            </label>
          </fieldset>
          <div className="space-y-1.5">
            <label htmlFor={nameId} className="text-xs font-medium text-gray-700">
              Name <span className="font-normal text-gray-400">(optional)</span>
            </label>
            <input
              id={nameId}
              value={name}
              maxLength={THEME_NAME_MAX}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-gray-200 px-5 py-3">
          {full ? <p className="mr-auto text-xs text-amber-700">{LIMIT_NOTICE}</p> : null}
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || full}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            Add theme
          </button>
        </div>
      </form>
    </div>
  );
}
