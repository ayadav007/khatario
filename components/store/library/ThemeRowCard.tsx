'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Loader2, MoreHorizontal, Paintbrush } from 'lucide-react';
import { clsx } from 'clsx';
import type { ThemeListRow } from '@/lib/store/engine/types';
import {
  ACTION_LABELS,
  BACKUP_BADGE,
  MENU_ACTIONS,
  NARROW_EDITOR_NOTICE,
  presetLabel,
  relativeEdited,
  type ThemeAction,
} from '@/lib/store/engine/library';

export type RowKind = 'live' | 'working' | 'draft';

interface ThemeRowCardProps {
  row: ThemeListRow;
  kind: RowKind;
  actions: Set<ThemeAction>;
  hasBackup: boolean;
  now: number;
  /** The action of this row whose request is running, for its spinner. */
  busyAction: ThemeAction | null;
  /** Any library request is running: every action button waits for it. */
  disabled: boolean;
  highlighted?: boolean;
  onAction(action: ThemeAction): void;
}

const secondaryBtn =
  'inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60';

/**
 * One theme: name, badges, preset and last edit, then its actions (D39). From 640 px the actions are buttons;
 * below that they sit in a "⋯" menu. Customise is a button from 1024 px; below, a note says to use a laptop.
 */
export function ThemeRowCard({ row, kind, actions, hasBackup, now, busyAction, disabled, highlighted, onAction }: ThemeRowCardProps) {
  const others = MENU_ACTIONS.filter((a) => actions.has(a));
  const canCustomise = actions.has('customise');

  return (
    <div
      data-theme-id={row.id}
      data-theme-kind={kind}
      aria-label={kind === 'working' ? `Working copy: ${row.name}` : row.name}
      role="group"
      className={clsx(
        'flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between',
        highlighted && 'rounded-lg bg-primary-50/60 ring-2 ring-primary-200 ring-offset-4',
      )}
    >
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          {kind === 'working' ? (
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-gray-600">
              Working copy
            </span>
          ) : null}
          {kind === 'live' ? (
            <span className="rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-green-800">
              Live
            </span>
          ) : null}
          <h3 className="min-w-0 break-words text-sm font-semibold text-gray-900">{row.name}</h3>
          {kind === 'working' && row.has_changes ? (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">Unpublished changes</span>
          ) : null}
          {hasBackup ? (
            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-medium text-blue-800">{BACKUP_BADGE}</span>
          ) : null}
        </div>
        <p className="text-xs text-gray-500">
          {presetLabel(row.preset)} · Edited {relativeEdited(row.updated_at, now)}
        </p>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
        {canCustomise ? (
          <>
            <button
              type="button"
              onClick={() => onAction('customise')}
              disabled={disabled}
              className="hidden items-center gap-1 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-700 disabled:opacity-60 lg:inline-flex"
            >
              {busyAction === 'customise' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <Paintbrush className="h-3.5 w-3.5" aria-hidden />
              )}
              {ACTION_LABELS.customise}
            </button>
            <span className="text-xs text-gray-500 lg:hidden">{NARROW_EDITOR_NOTICE}</span>
          </>
        ) : null}
        <div className="hidden flex-wrap items-center gap-2 sm:flex">
          {others.map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => onAction(a)}
              disabled={disabled}
              className={clsx(secondaryBtn, a === 'delete' && 'text-red-600 hover:bg-red-50')}
            >
              {busyAction === a ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
              {ACTION_LABELS[a]}
            </button>
          ))}
        </div>
        {others.length > 0 ? (
          <div className="sm:hidden">
            <RowMenu label={`Actions for ${row.name}`} actions={others} busyAction={busyAction} disabled={disabled} onAction={onAction} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function RowMenu({
  label,
  actions,
  busyAction,
  disabled,
  onAction,
}: {
  label: string;
  actions: ThemeAction[];
  busyAction: ThemeAction | null;
  disabled: boolean;
  onAction(action: ThemeAction): void;
}) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    rootRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus();
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
        buttonRef.current?.focus();
        return;
      }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const items = Array.from(rootRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? []);
      if (items.length === 0) return;
      e.preventDefault();
      const at = items.indexOf(document.activeElement as HTMLElement);
      const next = e.key === 'ArrowDown' ? (at + 1) % items.length : (at - 1 + items.length) % items.length;
      items[next]?.focus();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
      >
        {busyAction && busyAction !== 'customise' ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <MoreHorizontal className="h-4 w-4" aria-hidden />
        )}
      </button>
      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label={label}
          className="absolute right-0 z-30 mt-1 w-48 overflow-hidden rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
        >
          {actions.map((a) => (
            <button
              key={a}
              type="button"
              role="menuitem"
              disabled={disabled}
              onClick={() => {
                setOpen(false);
                onAction(a);
              }}
              className={clsx(
                'block w-full px-3 py-2.5 text-left text-sm hover:bg-gray-50 disabled:opacity-60',
                a === 'delete' ? 'text-red-600' : 'text-gray-700',
              )}
            >
              {ACTION_LABELS[a]}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
