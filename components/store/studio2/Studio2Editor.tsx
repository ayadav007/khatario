'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useToastContext } from '@/contexts/ToastContext';
import type { ThemeData, ThemeRow } from '@/lib/store/engine/types';
import type { GroupKey, OpError, OpResult, SectionRef } from '@/lib/store/engine/editor/ops';
import { canRedo, canUndo, createHistory, record, redo, undo, type History } from '@/lib/store/engine/editor/history';
import { SaveQueue, backupKey, type SaveStatus } from '@/lib/store/engine/editor/save-queue';
import { BRIDGE_SOURCE, type EditorToPreview, type PreviewToEditor } from '@/lib/store/engine/editor/bridge';
import {
  isEditableTarget,
  pruneSelection,
  resolvePendingScroll,
  selectionRef,
  shellView,
  shortcutFor,
  shouldWarnOnLeave,
  toSelection,
  type LeaveState,
  type PendingScroll,
  type Selection,
} from '@/lib/store/engine/editor/shell';
import { editorPath, fetchCategories, openWorkingDraft, previewLink, publishTheme, putTheme } from './api';
import { TopBar } from './TopBar';
import { PreviewPane, type Device } from './PreviewPane';
import { SectionTree } from './SectionTree';
import { AddSectionModal } from './AddSectionModal';

export type { Selection };

export interface Studio2Api {
  theme: ThemeData;
  templateKey: 'home';
  selection: Selection;
  apply(fn: (t: ThemeData) => OpResult | ThemeData, opts: { mergeKey: string | null; immediate: boolean }): OpError | null;
  /** `afterSave`: the section is new, so scroll again once the preview shows the save that adds it. */
  select(sel: Selection, opts?: { scroll?: boolean; afterSave?: boolean }): void;
  hover(ref: SectionRef | null): void;
  openAddSection(group: GroupKey, index: number): void;
  categories: { id: string; name: string }[];
  /** Section hovered in the preview or the tree (tree highlight). */
  hovered: SectionRef | null;
  /** Where the Add section modal inserts; null while it is closed. */
  addSectionTarget: { group: GroupKey; index: number } | null;
  closeAddSection(): void;
  /** Publishing or leaving for the next working draft: edits are blocked, so the panes disable their controls. */
  readOnly: boolean;
}

export const Studio2Context = createContext<Studio2Api | null>(null);

export function useStudio2(): Studio2Api {
  const api = useContext(Studio2Context);
  if (!api) throw new Error('useStudio2 must be used inside Studio2Editor');
  return api;
}

const TEMPLATE_KEY = 'home' as const;

function isOpResult(r: OpResult | ThemeData): r is OpResult {
  return typeof (r as OpResult).ok === 'boolean';
}

function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

interface Props {
  businessId: string;
  userId: string;
  theme: ThemeRow;
  /** The data to start from: the server copy, or a restored backup. */
  initialData: ThemeData;
  /** initialData is a restored backup: save it straight away. */
  restored: boolean;
  /** A backup made before the server copy changed; the merchant chooses. */
  staleBackup: ThemeData | null;
}

export function Studio2Editor({ businessId, userId, theme: row, initialData, restored, staleBackup }: Props) {
  const router = useRouter();
  const toast = useToastContext();

  const [history, setHistory] = useState<History<ThemeData>>(() => createHistory(initialData));
  const historyRef = useRef(history);
  const [selection, setSelection] = useState<Selection>(null);
  const selectionRefState = useRef<Selection>(null);
  const [hovered, setHovered] = useState<SectionRef | null>(null);
  const [addSectionTarget, setAddSectionTarget] = useState<{ group: GroupKey; index: number } | null>(null);
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [status, setStatus] = useState<{ status: SaveStatus; message?: string }>({ status: 'saved' });
  const statusRef = useRef<SaveStatus>('saved');
  const [device, setDevice] = useState<Device>('desktop');
  const [backupChoice, setBackupChoice] = useState<ThemeData | null>(staleBackup);

  const queueRef = useRef<SaveQueue | null>(null);
  const postRef = useRef<((msg: EditorToPreview) => void) | null>(null);
  const revRef = useRef(0);
  const pendingScrollRef = useRef<PendingScroll | null>(null);
  // Publishing or moving to the next working draft: the editor is read-only meanwhile.
  const [leave, setLeaveState] = useState<LeaveState>('idle');
  const leaveRef = useRef<LeaveState>('idle');
  const setLeave = useCallback((l: LeaveState) => {
    leaveRef.current = l;
    setLeaveState(l);
  }, []);
  const restoreDoneRef = useRef(false);
  const goingRef = useRef(false);

  const post = useCallback((msg: EditorToPreview) => postRef.current?.(msg), []);

  const setHistoryBoth = useCallback((h: History<ThemeData>) => {
    historyRef.current = h;
    setHistory(h);
  }, []);

  // Leave this theme for the business's working draft (after publish, or when it went live elsewhere).
  // The queue is disposed only once the next draft is known; on failure the editor stays read-only
  // behind a reload banner (edits are blocked, so nothing can be dropped silently).
  const goToWorkingDraft = useCallback(async () => {
    if (leaveRef.current === 'failed' || goingRef.current) return;
    goingRef.current = true;
    setLeave('leaving');
    try {
      const next = await openWorkingDraft(businessId);
      queueRef.current?.dispose();
      router.replace(editorPath(next.id));
    } catch {
      setLeave('failed');
    }
  }, [businessId, router, setLeave]);
  const goToWorkingDraftRef = useRef(goToWorkingDraft);
  goToWorkingDraftRef.current = goToWorkingDraft;

  // Save queue, one per theme.
  useEffect(() => {
    const queue = new SaveQueue(row.id, row.updated_at, {
      put: (id, data, updatedAt) => putTheme(businessId, id, data, updatedAt),
      storage: safeStorage(),
      onStatus: (s, message) => {
        statusRef.current = s;
        setStatus({ status: s, message });
        if (s === 'locked') void goToWorkingDraftRef.current();
      },
      onSaved: () => {
        revRef.current += 1;
        postRef.current?.({ source: BRIDGE_SOURCE, type: 'refresh', rev: revRef.current });
      },
    });
    queueRef.current = queue;
    // Deferred so StrictMode's simulated unmount cancels it before queue A can PUT; the ref makes
    // the restore save and its notice happen once per mounted editor.
    const restoreTimer =
      restored && !restoreDoneRef.current
        ? setTimeout(() => {
            restoreDoneRef.current = true;
            queue.schedule(historyRef.current.present, true);
            toast.info("Restored changes that hadn't saved");
          }, 0)
        : null;
    return () => {
      if (restoreTimer) clearTimeout(restoreTimer);
      void queue.flush(); // client-side navigation away: send a debounced edit now
      queue.dispose();
      if (queueRef.current === queue) queueRef.current = null;
    };
    // The queue lives as long as this theme; `restored` only matters on the first run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.id, row.updated_at, businessId]);

  useEffect(() => {
    let cancelled = false;
    fetchCategories(businessId, userId)
      .then((rows) => !cancelled && setCategories(rows))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [businessId, userId]);

  const select = useCallback(
    (sel: Selection, opts?: { scroll?: boolean; afterSave?: boolean }) => {
      selectionRefState.current = sel;
      setSelection(sel);
      const ref = selectionRef(sel);
      // Any later selection replaces a scroll still waiting for its save.
      pendingScrollRef.current = opts?.scroll && opts.afterSave && ref ? { ref, afterRev: revRef.current } : null;
      post({ source: BRIDGE_SOURCE, type: 'select', ref });
      if (opts?.scroll && ref) post({ source: BRIDGE_SOURCE, type: 'scroll-to', ref });
    },
    [post],
  );

  // Undo, redo or a remove can take away what is selected.
  useEffect(() => {
    const cur = selectionRefState.current;
    const next = pruneSelection(history.present, TEMPLATE_KEY, cur);
    if (next !== cur) select(next);
  }, [history.present, select]);

  const apply = useCallback<Studio2Api['apply']>(
    (fn, opts) => {
      if (leaveRef.current !== 'idle') return null;
      const result = fn(historyRef.current.present);
      let next: ThemeData;
      if (isOpResult(result)) {
        if (!result.ok) return result.reason;
        next = result.theme;
      } else {
        next = result;
      }
      const h = record(historyRef.current, next, opts.mergeKey, Date.now());
      if (h === historyRef.current) return null;
      setHistoryBoth(h);
      setBackupChoice(null); // a new edit replaces the stored backup
      queueRef.current?.schedule(next, opts.immediate);
      return null;
    },
    [setHistoryBoth],
  );

  const doUndo = useCallback(() => {
    if (leaveRef.current !== 'idle') return;
    const h = undo(historyRef.current);
    if (h === historyRef.current) return;
    setHistoryBoth(h);
    queueRef.current?.schedule(h.present, true);
  }, [setHistoryBoth]);

  const doRedo = useCallback(() => {
    if (leaveRef.current !== 'idle') return;
    const h = redo(historyRef.current);
    if (h === historyRef.current) return;
    setHistoryBoth(h);
    queueRef.current?.schedule(h.present, true);
  }, [setHistoryBoth]);

  // Keyboard shortcuts; fields keep the browser's own undo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const action = shortcutFor(e);
      if (!action) return;
      if (isEditableTarget(e.target) || isEditableTarget(document.activeElement)) return;
      e.preventDefault();
      if (action === 'undo') doUndo();
      else doRedo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [doUndo, doRedo]);

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!shouldWarnOnLeave(statusRef.current)) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  const hover = useCallback(
    (ref: SectionRef | null) => {
      setHovered(ref);
      post({ source: BRIDGE_SOURCE, type: 'hover', ref });
    },
    [post],
  );

  const openAddSection = useCallback((group: GroupKey, index: number) => setAddSectionTarget({ group, index }), []);
  const closeAddSection = useCallback(() => setAddSectionTarget(null), []);

  const onPreviewMessage = useCallback(
    (msg: PreviewToEditor) => {
      switch (msg.type) {
        case 'ready':
          // A fresh frame (or one that finished an older refresh) learns the selection, and catches up.
          post({ source: BRIDGE_SOURCE, type: 'select', ref: selectionRef(selectionRefState.current) });
          // A reloaded frame (rev null) may have missed a refresh sent while it was loading.
          if (revRef.current > 0 && (msg.rev === null || msg.rev < revRef.current)) {
            post({ source: BRIDGE_SOURCE, type: 'refresh', rev: revRef.current });
          }
          {
            // A section added or duplicated before its save was in the frame: scroll to it now.
            const r = resolvePendingScroll(pendingScrollRef.current, msg.rev);
            pendingScrollRef.current = r.pending;
            if (r.resend) {
              post({ source: BRIDGE_SOURCE, type: 'select', ref: r.resend });
              post({ source: BRIDGE_SOURCE, type: 'scroll-to', ref: r.resend });
            }
          }
          break;
        case 'select': {
          const sel = toSelection(msg.ref);
          pendingScrollRef.current = null;
          selectionRefState.current = sel;
          setSelection(sel);
          break;
        }
        case 'hover':
          setHovered(msg.ref);
          break;
        case 'add-at':
          openAddSection('template', msg.index);
          break;
      }
    },
    [post, openAddSection],
  );

  const copyPreview = useCallback(async () => {
    try {
      const url = await previewLink(businessId, row.id, 'share');
      await navigator.clipboard.writeText(url);
      toast.success('Preview link copied');
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : 'Could not copy the preview link');
    }
  }, [businessId, row.id, toast]);

  const publish = useCallback(async () => {
    const queue = queueRef.current;
    if (!queue || leaveRef.current !== 'idle') return;
    setLeave('leaving'); // no edits (or undo) while publishing
    await queue.flush();
    if (statusRef.current !== 'saved') {
      setLeave('idle');
      toast.error('Save your changes before publishing');
      return;
    }
    try {
      await publishTheme(businessId, row.id);
    } catch (e) {
      setLeave('idle');
      toast.error(e instanceof Error ? e.message : 'Failed to publish theme');
      return;
    }
    toast.success('Published');
    await goToWorkingDraft();
  }, [businessId, row.id, toast, goToWorkingDraft, setLeave]);

  const keepBackup = useCallback(() => {
    const data = backupChoice;
    if (!data) return;
    apply(() => data, { mergeKey: null, immediate: true });
  }, [backupChoice, apply]);

  const discardBackup = useCallback(() => {
    try {
      safeStorage()?.removeItem(backupKey(row.id));
    } catch {
      /* ignore */
    }
    setBackupChoice(null);
  }, [row.id]);

  const api = useMemo<Studio2Api>(
    () => ({
      theme: history.present,
      templateKey: TEMPLATE_KEY,
      selection,
      apply,
      select,
      hover,
      openAddSection,
      categories,
      hovered,
      addSectionTarget,
      closeAddSection,
      readOnly: leave !== 'idle',
    }),
    [history.present, selection, apply, select, hover, openAddSection, categories, hovered, addSectionTarget, closeAddSection, leave],
  );

  const s = status.status;
  const view = shellView(leave, s, status.message);
  return (
    <Studio2Context.Provider value={api}>
      <div className="fixed inset-0 z-[90] flex flex-col bg-white text-gray-900">
        <TopBar
          themeName={row.name}
          canUndo={canUndo(history)}
          canRedo={canRedo(history)}
          onUndo={doUndo}
          onRedo={doRedo}
          device={device}
          onDevice={setDevice}
          statusLabel={view.statusLabel}
          statusIsError={leave === 'failed' || s === 'error' || s === 'conflict' || s === 'locked'}
          onCopyPreview={copyPreview}
          onPublish={publish}
        />

        {view.blockingBanner && (
          <Banner tone="error">
            {view.blockingBanner}
            <BannerButton onClick={() => window.location.reload()}>Reload</BannerButton>
          </Banner>
        )}
        {s === 'conflict' && (
          <Banner tone="error">
            This theme changed in another tab.
            <BannerButton onClick={() => window.location.reload()}>Reload</BannerButton>
          </Banner>
        )}
        {s === 'locked' && !view.blockingBanner && <Banner tone="error">This theme is now live.</Banner>}
        {s === 'offline' && <Banner tone="warn">Offline, retrying…</Banner>}
        {s === 'error' && (
          <Banner tone="error">
            {status.message || 'Your changes could not be saved.'}
            <BannerButton onClick={() => queueRef.current?.retry()}>Retry</BannerButton>
          </Banner>
        )}
        {backupChoice && (
          <Banner tone="warn">
            You have changes that hadn&apos;t saved, made before this theme last changed.
            <BannerButton onClick={keepBackup}>Keep my changes</BannerButton>
            <BannerButton onClick={discardBackup}>Discard</BannerButton>
          </Banner>
        )}

        <div className="flex min-h-0 flex-1">
          <aside className="w-72 shrink-0 overflow-y-auto border-r border-gray-200 bg-white">
            <SectionTree />
          </aside>
          <PreviewPane
            themeId={row.id}
            businessId={businessId}
            device={device}
            postRef={postRef}
            onMessage={onPreviewMessage}
          />
          <aside className="w-80 shrink-0 overflow-y-auto border-l border-gray-200 bg-white">
            <SettingsPlaceholder />
          </aside>
        </div>
      </div>
      <AddSectionModal />
    </Studio2Context.Provider>
  );
}

function Banner({ tone, children }: { tone: 'error' | 'warn'; children: ReactNode }) {
  return (
    <div
      role="status"
      className={
        tone === 'error'
          ? 'flex shrink-0 items-center gap-3 border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800'
          : 'flex shrink-0 items-center gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900'
      }
    >
      {children}
    </div>
  );
}

function BannerButton({ onClick, children }: { onClick(): void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md border border-current px-2 py-0.5 text-xs font-medium hover:bg-white/60"
    >
      {children}
    </button>
  );
}

// Placeholder: Task 10 builds the settings panel.
function SettingsPlaceholder() {
  const { selection } = useStudio2();
  return (
    <div className="p-4 text-sm text-gray-500">
      {selection ? 'Settings for the selected item appear here.' : 'Select a section to edit it.'}
    </div>
  );
}
