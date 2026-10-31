'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Loader2, Palette, Plus } from 'lucide-react';
import { useToastContext } from '@/contexts/ToastContext';
import { SettingsPageShell } from '@/components/settings/SettingsPageShell';
import { Card } from '@/components/ui/Card';
import type { ThemeListRow, ThemeRow } from '@/lib/store/engine/types';
import { hasBackup, sweepBackups } from '@/lib/store/engine/editor/save-queue';
import {
  DISCARD_CONFIRM,
  ENGINE_OFF_NOTICE,
  HISTORY_HIGHLIGHT_MS,
  NARROW_EDITOR_NOTICE,
  NO_EDIT_NOTICE,
  PREVIEW_COPIED,
  customiseOpensWorkingDraft,
  deleteConfirmText,
  publishConfirmText,
  splitLibrary,
  themeActions,
  themeCountLabel,
  type ThemeAction,
} from '@/lib/store/engine/library';
import {
  createTheme,
  deleteTheme,
  editorPath,
  listThemes,
  openWorkingDraft,
  previewLink,
  publishTheme,
  resetWorkingDraft,
} from './api';
import { ThemeRowCard, type RowKind } from './ThemeRowCard';
import { AddThemeModal } from './AddThemeModal';
import { ConfirmDialog } from './ConfirmDialog';
import { RenameDialog } from './RenameDialog';
import { VersionHistoryDrawer } from './VersionHistoryDrawer';

export interface ThemeLibraryProps {
  businessId: string;
  /** settings modify permission (D39): without it only History on the live card stays (R17: no preview link). */
  canEdit: boolean;
  /** `store_engine` (D52): off shows the classic-store notice and adds it to the publish confirm. */
  storeEngine: boolean;
}

type Busy = { id: string; action: ThemeAction } | null;
type Confirm = { kind: 'publish' | 'discard' | 'delete'; row: ThemeListRow } | null;

function localStore(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function errorText(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

/** D39: the live card with its working copy, the drafts, and every library action. */
export function ThemeLibrary({ businessId, canEdit, storeEngine }: ThemeLibraryProps) {
  const router = useRouter();
  const toast = useToastContext();
  const [rows, setRows] = useState<ThemeListRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [backups, setBackups] = useState<Set<string>>(new Set());
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState<Busy>(null);
  const busyRef = useRef(false);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [renaming, setRenaming] = useState<ThemeListRow | null>(null);
  const [adding, setAdding] = useState(false);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const loadedRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const list = await listThemes();
      const storage = localStore();
      const t = Date.now();
      // D51: drop this store's backups of themes that are gone or two weeks old; badge the rest.
      // Edits kept from a deleted theme whose move failed (marked gone, final review M1) go to the working copy.
      sweepBackups(storage, businessId, {
        keepThemeIds: list.map((r) => r.id),
        now: t,
        adoptInto: list.find((r) => r.is_working)?.id ?? null,
      });
      setBackups(new Set(list.filter((r) => hasBackup(storage, businessId, r.id)).map((r) => r.id)));
      setRows(list);
      loadedRef.current = true;
      setNow(t);
      setLoadError(null);
    } catch (e) {
      // The plan gate (402/403) and other refusals show the API's text in place of the library.
      const message = errorText(e, 'Failed to load themes');
      setLoadError(message);
      // A failed reload keeps the list on screen; say so instead of showing stale rows silently.
      if (loadedRef.current) toast.error(message);
    }
  }, [businessId, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, []);

  // A new row (added, duplicated or restored) is highlighted for a few seconds.
  useEffect(() => {
    if (!highlight) return;
    const t = window.setTimeout(() => setHighlight(null), HISTORY_HIGHLIGHT_MS);
    return () => window.clearTimeout(t);
  }, [highlight]);

  /** Runs one request at a time, so a double click can never send two. Returns false when it failed or was refused. */
  const run = useCallback(
    async (target: NonNullable<Busy>, fn: () => Promise<void>, fallback: string, opts?: { keepBusy?: boolean }) => {
      if (busyRef.current) return false;
      busyRef.current = true;
      setBusy(target);
      let ok = false;
      try {
        await fn();
        ok = true;
      } catch (e) {
        toast.error(errorText(e, fallback));
      } finally {
        // Customise stays busy while the editor route loads.
        if (!ok || !opts?.keepBusy) {
          busyRef.current = false;
          setBusy(null);
        }
      }
      return ok;
    },
    [toast],
  );

  const customise = useCallback(
    (row: ThemeListRow | null) => {
      const id = row?.id ?? 'live';
      void run(
        { id, action: 'customise' },
        async () => {
          if (!row || customiseOpensWorkingDraft(row)) {
            const draft = await openWorkingDraft(businessId);
            router.push(editorPath(draft.id));
          } else {
            router.push(editorPath(row.id));
          }
        },
        'Failed to open the editor',
        { keepBusy: true },
      );
    },
    [businessId, router, run],
  );

  const onAction = useCallback(
    (row: ThemeListRow, action: ThemeAction) => {
      switch (action) {
        case 'customise':
          customise(row);
          return;
        case 'preview':
          void run(
            { id: row.id, action },
            async () => {
              const url = await previewLink(businessId, row.id, 'share', '/');
              await navigator.clipboard.writeText(url);
              toast.success(PREVIEW_COPIED);
            },
            'Could not copy the preview link',
          );
          return;
        case 'duplicate':
          void run(
            { id: row.id, action },
            async () => {
              const theme = await createTheme({ duplicateOf: row.id });
              setHighlight(theme.id);
              toast.success(`Added '${theme.name}'`);
              await load();
            },
            'Failed to duplicate the theme',
          );
          return;
        case 'rename':
          setRenaming(row);
          return;
        case 'publish':
        case 'discard':
        case 'delete':
          setConfirm({ kind: action, row });
          return;
        case 'history':
          setHistoryOpen(true);
          return;
      }
    },
    [businessId, customise, load, run, toast],
  );

  const confirmAction = useCallback(async () => {
    if (!confirm) return;
    const { kind, row } = confirm;
    await run(
      { id: row.id, action: kind },
      async () => {
        if (kind === 'publish') {
          await publishTheme(businessId, row.id);
          toast.success(`Published '${row.name}'`);
        } else if (kind === 'discard') {
          await resetWorkingDraft();
          toast.success('Changes discarded');
        } else {
          await deleteTheme(row.id);
          toast.success(`Deleted '${row.name}'`);
        }
        await load();
      },
      kind === 'publish' ? 'Failed to publish the theme' : kind === 'discard' ? 'Failed to discard the changes' : 'Failed to delete the theme',
    );
    setConfirm(null);
  }, [businessId, confirm, load, run, toast]);

  const closeConfirm = useCallback(() => setConfirm(null), []);
  const closeRename = useCallback(() => setRenaming(null), []);
  const closeAdd = useCallback(() => setAdding(false), []);
  const closeHistory = useCallback(() => setHistoryOpen(false), []);
  const onRestored = useCallback(
    (theme: ThemeRow) => {
      // The drawer toasts "Restored as …"; close it so the new draft's highlight is in view.
      setHistoryOpen(false);
      setHighlight(theme.id);
      void load();
    },
    [load],
  );

  const split = useMemo(() => splitLibrary(rows ?? []), [rows]);
  const count = rows?.length ?? 0;

  const renderRow = (row: ThemeListRow, kind: RowKind) => (
    <ThemeRowCard
      row={row}
      kind={kind}
      actions={themeActions(row, { canEdit })}
      hasBackup={backups.has(row.id)}
      now={now}
      busyAction={busy?.id === row.id ? busy.action : null}
      disabled={busy !== null}
      highlighted={highlight === row.id}
      onAction={(a) => onAction(row, a)}
    />
  );

  const headerActions = (
    <div className="flex items-center gap-2">
      <Link
        href="/settings/online-store"
        className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        Online store
      </Link>
      {canEdit && rows ? (
        <button
          type="button"
          onClick={() => setAdding(true)}
          disabled={busy !== null}
          className="inline-flex items-center gap-1 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-700 disabled:opacity-60"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />
          Add theme
        </button>
      ) : null}
    </div>
  );

  return (
    <SettingsPageShell
      title="Themes"
      description={rows ? themeCountLabel(count) : undefined}
      icon={Palette}
      actions={headerActions}
    >
      {!storeEngine ? (
        <div role="note" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {ENGINE_OFF_NOTICE}
        </div>
      ) : null}
      {!canEdit ? (
        <div role="note" className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
          {NO_EDIT_NOTICE}
        </div>
      ) : null}

      {loadError && !rows ? (
        <Card>
          <p className="text-sm text-red-600">{loadError}</p>
          <button type="button" onClick={() => void load()} className="mt-3 text-sm text-gray-700 underline">
            Try again
          </button>
        </Card>
      ) : !rows ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      ) : (
        <>
          <section aria-labelledby="theme-library-live" className="space-y-2">
            <h2 id="theme-library-live" className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              Live theme
            </h2>
            <Card>
              {split.live ? (
                renderRow(split.live, 'live')
              ) : (
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm text-gray-700">
                    Your store doesn&apos;t use a theme yet. Customise sets one up from your current store design.
                  </p>
                  {canEdit ? (
                    <>
                      <button
                        type="button"
                        onClick={() => customise(null)}
                        disabled={busy !== null}
                        className="hidden items-center gap-1 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-700 disabled:opacity-60 lg:inline-flex"
                      >
                        {busy?.id === 'live' ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
                        Customise
                      </button>
                      <span className="text-xs text-gray-500 lg:hidden">{NARROW_EDITOR_NOTICE}</span>
                    </>
                  ) : null}
                </div>
              )}
              {split.working ? <div className="mt-4 border-t border-gray-100 pt-4">{renderRow(split.working, 'working')}</div> : null}
            </Card>
          </section>

          <section aria-labelledby="theme-library-drafts" className="space-y-2">
            <h2 id="theme-library-drafts" className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              Drafts
            </h2>
            {split.drafts.length === 0 ? (
              <Card>
                <p className="text-sm text-gray-500">No drafts yet. Add a theme to try a new look without changing your store.</p>
              </Card>
            ) : (
              <ul className="space-y-3">
                {split.drafts.map((row) => (
                  <li key={row.id}>
                    <Card>{renderRow(row, 'draft')}</Card>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {confirm ? (
        <ConfirmDialog
          message={
            confirm.kind === 'publish'
              ? publishConfirmText(confirm.row.name, storeEngine)
              : confirm.kind === 'discard'
                ? DISCARD_CONFIRM
                : deleteConfirmText(confirm.row.name)
          }
          confirmLabel={confirm.kind === 'publish' ? 'Publish' : confirm.kind === 'discard' ? 'Discard changes' : 'Delete'}
          destructive={confirm.kind !== 'publish'}
          busy={busy !== null}
          onConfirm={() => void confirmAction()}
          onCancel={closeConfirm}
        />
      ) : null}
      {renaming ? (
        <RenameDialog
          themeId={renaming.id}
          currentName={renaming.name}
          onClose={closeRename}
          onRenamed={() => {
            setRenaming(null);
            void load();
          }}
        />
      ) : null}
      <VersionHistoryDrawer open={historyOpen} onClose={closeHistory} canEdit={canEdit} onRestored={onRestored} />
      {adding ? (
        <AddThemeModal
          count={count}
          onClose={closeAdd}
          onCreated={(theme) => {
            setAdding(false);
            setHighlight(theme.id);
            toast.success(`Added '${theme.name}'`);
            void load();
          }}
        />
      ) : null}
    </SettingsPageShell>
  );
}
