'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Eye, History as HistoryIcon, Loader2, RotateCcw, X } from 'lucide-react';
import { useToastContext } from '@/contexts/ToastContext';
import type { ThemeRow, ThemeVersionSummary } from '@/lib/store/engine/types';
import {
  VERSION_HISTORY_EMPTY,
  authorLabel,
  formatPublishedAt,
  restoredToastText,
  versionActions,
  versionRowName,
} from '@/lib/store/engine/library';
import { listVersions, restoreVersion, versionPreviewLink } from './api';

export interface VersionHistoryDrawerProps {
  open: boolean;
  onClose(): void;
  /** settings modify permission: Preview and Restore as draft need it (R17). */
  canEdit: boolean;
  /** A version was restored as a new draft (D48). */
  onRestored(theme: ThemeRow): void;
  /** When given, the "Restored as …" toast carries an "Open" action that calls it (Studio 2). */
  onOpenRestored?(theme: ThemeRow): void;
}

type Busy = { id: string; action: 'preview' | 'restore' } | null;

function errorText(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The business's publish timeline (D45, D46): a right-side drawer, full width below 640 px. Focus stays inside
 * while it is open and Escape closes it. Each version can be previewed read-only (2 h link) or restored as a draft.
 */
export function VersionHistoryDrawer({ open, onClose, canEdit, onRestored, onOpenRestored }: VersionHistoryDrawerProps) {
  const toast = useToastContext();
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [versions, setVersions] = useState<ThemeVersionSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const busyRef = useRef(false);
  const seqRef = useRef(0);
  const actions = versionActions({ canEdit });

  const load = useCallback(async () => {
    const seq = ++seqRef.current;
    setVersions(null);
    setError(null);
    try {
      const list = await listVersions();
      if (seq === seqRef.current) setVersions(list);
    } catch (e) {
      if (seq === seqRef.current) setError(errorText(e, 'Failed to load the version history'));
    }
  }, []);

  // Every opening reads the list again: a publish or a restore may have happened since.
  useEffect(() => {
    if (!open) return;
    void load();
    return () => {
      seqRef.current += 1; // a late answer after closing is ignored
    };
  }, [open, load]);

  // Focus moves in on open and back to the opener on close; Tab cycles inside; Escape closes.
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !panelRef.current) return;
      const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (!panelRef.current.contains(active)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      if (opener?.isConnected) opener.focus();
    };
  }, [open, onClose]);

  const start = (target: NonNullable<Busy>): boolean => {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(target);
    return true;
  };
  const finish = () => {
    busyRef.current = false;
    setBusy(null);
  };

  const preview = (v: ThemeVersionSummary) => {
    if (!start({ id: v.id, action: 'preview' })) return;
    // Opened synchronously in the click so popup blockers allow it; the link arrives afterwards.
    const tab = window.open('', '_blank');
    if (!tab) {
      finish();
      toast.error('Allow pop-ups for this site to preview a version');
      return;
    }
    try {
      tab.opener = null;
    } catch {
      /* ignore */
    }
    void versionPreviewLink(v.id)
      .then((url) => {
        tab.location.href = url;
      })
      .catch((e) => {
        tab.close();
        toast.error(errorText(e, 'Failed to create the preview link'));
      })
      .finally(finish);
  };

  const restore = async (v: ThemeVersionSummary) => {
    if (!start({ id: v.id, action: 'restore' })) return;
    try {
      const theme = await restoreVersion(v.id);
      // A limit (20 themes) or any other refusal shows the server's text.
      if (onOpenRestored) {
        // Longer than the default 5 s, so there is time to reach "Open".
        toast.showToast(restoredToastText(theme.name), 'success', 10_000, {
          label: 'Open',
          onClick: () => onOpenRestored(theme),
        });
      } else {
        toast.success(restoredToastText(theme.name));
      }
      onRestored(theme);
    } catch (e) {
      toast.error(errorText(e, 'Failed to restore the version'));
    } finally {
      finish();
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[95] flex justify-end bg-black/30"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex h-full w-full flex-col bg-white shadow-xl sm:w-[28rem]"
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <h2 id={titleId} className="flex items-center gap-2 text-sm font-semibold text-gray-900">
            <HistoryIcon className="h-4 w-4 text-gray-500" aria-hidden />
            Version history
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-600 hover:bg-gray-100"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {error ? (
            <div>
              <p className="text-sm text-red-600">{error}</p>
              <button type="button" onClick={() => void load()} className="mt-3 text-sm text-gray-700 underline">
                Try again
              </button>
            </div>
          ) : !versions ? (
            <div className="flex justify-center py-12" role="status" aria-label="Loading versions">
              <Loader2 className="h-6 w-6 animate-spin text-gray-400" aria-hidden />
            </div>
          ) : versions.length === 0 ? (
            <p className="py-6 text-sm text-gray-500">{VERSION_HISTORY_EMPTY}</p>
          ) : (
            <ul className="divide-y divide-gray-100" aria-label="Published versions">
              {versions.map((v, i) => (
                <li key={v.id} data-version-id={v.id} className="py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-gray-900">{formatPublishedAt(v.published_at)}</span>
                    {i === 0 ? (
                      <span className="rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-green-800">
                        Latest
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 break-words text-sm text-gray-700">{versionRowName(v)}</p>
                  <p className="text-xs text-gray-500">by {authorLabel(v.published_by_name)}</p>
                  {actions.size > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {actions.has('preview') ? (
                        <button
                          type="button"
                          onClick={() => preview(v)}
                          disabled={busy !== null}
                          className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                        >
                          {busy?.id === v.id && busy.action === 'preview' ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                          ) : (
                            <Eye className="h-3.5 w-3.5" aria-hidden />
                          )}
                          Preview
                        </button>
                      ) : null}
                      {actions.has('restore') ? (
                        <button
                          type="button"
                          onClick={() => void restore(v)}
                          disabled={busy !== null}
                          className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                        >
                          {busy?.id === v.id && busy.action === 'restore' ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                          ) : (
                            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                          )}
                          Restore as draft
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
