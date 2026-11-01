'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useToastContext } from '@/contexts/ToastContext';
import type { ThemeData, ThemeRow } from '@/lib/store/engine/types';
import { getGroup, type GroupKey, type OpError, type OpResult, type SectionRef } from '@/lib/store/engine/editor/ops';
import { canRedo, canUndo, createHistory, record, redo, undo, type History } from '@/lib/store/engine/editor/history';
import { CARRIED_BASE, SaveQueue, backupKey, keepGoneBackup, type SaveStatus } from '@/lib/store/engine/editor/save-queue';
import { BRIDGE_SOURCE, resolveAddIndex, type EditorToPreview, type PreviewToEditor } from '@/lib/store/engine/editor/bridge';
import { customPages, openTemplateKey, showsClassicPage, templateOptions } from '@/lib/store/engine/editor/tree';
import { previewPath } from '@/lib/store/engine/preview-path';
import {
  acceptsEdits,
  isEditableTarget,
  menuHoldItemId,
  pruneSelection,
  remoteThemeState,
  resolvePendingScroll,
  selectionRef,
  shellView,
  shortcutFor,
  shouldWarnOnLeave,
  toSelection,
  type LeaveReason,
  type LeaveState,
  type PendingScroll,
  type Selection,
} from '@/lib/store/engine/editor/shell';
import {
  ThemeGoneError,
  editorPath,
  fetchCategories,
  fetchItem,
  fetchTheme,
  openWorkingDraft,
  previewLink,
  publishTheme,
  putTheme,
  searchItems,
} from './api';
import { TopBar } from './TopBar';
import { PreviewPane, type Device } from './PreviewPane';
import { SectionTree } from './SectionTree';
import { AddSectionModal } from './AddSectionModal';
import { SettingsPanel } from './SettingsPanel';
import { NewPageModal } from './NewPageModal';
import { VersionHistoryDrawer } from '@/components/store/library/VersionHistoryDrawer';
import { LEAVE_UNSAVED_TEXT } from '@/lib/store/engine/library';

export type { Selection };

export interface Studio2Api {
  theme: ThemeData;
  /** The template open in the tree and the preview: home, product, catalog or page.<handle>. */
  templateKey: string;
  selection: Selection;
  apply(fn: (t: ThemeData) => OpResult | ThemeData, opts: { mergeKey: string | null; immediate: boolean }): OpError | null;
  /** `afterSave`: the section is new, so scroll again once the preview shows the save that adds it. */
  select(sel: Selection, opts?: { scroll?: boolean; afterSave?: boolean }): void;
  hover(ref: SectionRef | null): void;
  openAddSection(group: GroupKey, index: number): void;
  categories: { id: string; name: string }[];
  /** The theme's custom pages, sorted by title (link pickers offer them). */
  pages: Array<{ key: string; handle: string; title: string }>;
  /** Opens another template in the tree and the preview (pending edits are saved first). */
  switchTemplate(key: string): void;
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

const NO_PRODUCTS_TEXT = 'Add a product to preview the product page';

/** D50: a save found the theme deleted; the edits go to the working copy's "Keep my changes" banner. */
const GONE_TOAST = 'This theme was deleted in another tab. Your unsaved edits are offered on your working copy.';
/** An idle tab found its theme deleted, with nothing unsaved to carry. */
const GONE_IDLE_TOAST = 'This theme was deleted in another tab.';
/** Final review I2: an outdated backup was removed when the editor opened. */
const DROPPED_BACKUP_TEXT =
  "Changes that hadn't saved on this device were made before this theme changed elsewhere, so they were not kept.";
/** D50: the re-check on returning to the tab runs at most this often. */
const RECHECK_MS = 10_000;

/** D20: the product the Product template is previewed with. undefined: not looked up yet; null: the store has none. */
type PreviewProduct = { id: string; name: string | null } | null | undefined;

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
  theme: ThemeRow;
  /** The data to start from: the server copy, or a restored backup. */
  initialData: ThemeData;
  /** initialData is a restored backup: save it straight away. */
  restored: boolean;
  /** Edits carried here from another theme (deleted, or published elsewhere); the merchant chooses. */
  carriedBackup: ThemeData | null;
  /** An outdated backup was dropped on opening (final review I2): say so. */
  droppedBackup: boolean;
}

export function Studio2Editor({ businessId, theme: row, initialData, restored, carriedBackup, droppedBackup }: Props) {
  const router = useRouter();
  const toast = useToastContext();
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const [history, setHistory] = useState<History<ThemeData>>(() => createHistory(initialData));
  const historyRef = useRef(history);
  const [selection, setSelection] = useState<Selection>(null);
  const selectionRefState = useRef<Selection>(null);
  const [hovered, setHovered] = useState<SectionRef | null>(null);
  const [addSectionTarget, setAddSectionTarget] = useState<{ group: GroupKey; index: number } | null>(null);
  const [newPageOpen, setNewPageOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [status, setStatus] = useState<{ status: SaveStatus; message?: string }>({ status: 'saved' });
  const statusRef = useRef<SaveStatus>('saved');
  const [device, setDevice] = useState<Device>('desktop');
  const [backupChoice, setBackupChoice] = useState<ThemeData | null>(carriedBackup);
  const [droppedNotice, setDroppedNotice] = useState(droppedBackup);
  // The template in the tree, and the one the frame shows: it follows once pending edits are saved.
  const [templateKey, setTemplateKey] = useState('home');
  const templateKeyRef = useRef('home');
  const [frameKey, setFrameKey] = useState('home');
  const frameKeyRef = useRef('home');
  frameKeyRef.current = frameKey;
  const switchSeqRef = useRef(0);
  const [previewProduct, setPreviewProduct] = useState<PreviewProduct>(undefined);
  const [productError, setProductError] = useState<string | null>(null);
  // Bumped to reload the frame. classicRef: the saved theme renders the framed page classic (D15).
  const [frameNonce, setFrameNonce] = useState(0);
  const classicRef = useRef(false);

  const queueRef = useRef<SaveQueue | null>(null);
  const postRef = useRef<((msg: EditorToPreview) => void) | null>(null);
  const revRef = useRef(0);
  const pendingScrollRef = useRef<PendingScroll | null>(null);
  // Publishing or moving to the next working draft: the editor is read-only meanwhile.
  const [leave, setLeaveState] = useState<LeaveState>('idle');
  // Why a move to the working draft failed (the banner text, and whether Try again is offered).
  const [leaveReason, setLeaveReason] = useState<LeaveReason>('live');
  const leaveRef = useRef<LeaveState>('idle');
  const setLeave = useCallback((l: LeaveState) => {
    leaveRef.current = l;
    setLeaveState(l);
  }, []);
  const restoreDoneRef = useRef(false);
  const goingRef = useRef(false);
  // The server's updated_at the queue saves against (D50 re-check); follows every save.
  const baseRef = useRef(row.updated_at);
  const lastRecheckRef = useRef(0);

  const post = useCallback((msg: EditorToPreview) => postRef.current?.(msg), []);

  const setHistoryBoth = useCallback((h: History<ThemeData>) => {
    historyRef.current = h;
    setHistory(h);
  }, []);

  // Leave this theme for the business's working draft (this theme went live: published here when it
  // isn't the working draft, or elsewhere). The queue is disposed only once the next draft is known; on
  // failure the editor stays read-only behind a reload banner (edits are blocked, so nothing is dropped).
  // `carry`: the server refused edits (live_locked, or gone when deleted elsewhere), so they go along as a
  // backup the next draft offers. Nothing is carried when everything here is already saved (an idle tab's
  // re-check, D50). A deleted working draft gets a new one from openWorkingDraft, and the carry still applies.
  // `reason` 'gone' (final review M1): if the open fails, unsaved edits are stored marked gone, so the library
  // moves them to the working copy instead of sweeping them, and the banner says so and offers Try again.
  const goToWorkingDraft = useCallback(
    async (carry: boolean, reason: 'live' | 'gone') => {
      if (leaveRef.current === 'failed' || goingRef.current) return;
      goingRef.current = true;
      setLeave('leaving');
      try {
        const next = await openWorkingDraft(businessId);
        const unsaved = statusRef.current !== 'saved';
        queueRef.current?.dispose();
        if (carry && unsaved && next.id !== row.id) carryBackup(businessId, row.id, next.id, historyRef.current.present);
        router.replace(editorPath(next.id));
      } catch {
        if (reason === 'gone') {
          const unsaved = carry && statusRef.current !== 'saved';
          const kept = unsaved && keepGoneBackup(safeStorage(), businessId, row.id, historyRef.current.present, Date.now());
          setLeaveReason({ gone: !unsaved ? 'none' : kept ? 'kept' : 'tab_only' });
        } else {
          setLeaveReason('live');
        }
        setLeave('failed');
      }
    },
    [businessId, row.id, router, setLeave],
  );
  const goToWorkingDraftRef = useRef(goToWorkingDraft);
  goToWorkingDraftRef.current = goToWorkingDraft;

  // Try again after the theme was deleted and the working copy could not be opened (final review M1).
  const retryLeave = useCallback(() => {
    if (leaveRef.current !== 'failed') return;
    goingRef.current = false;
    setLeave('leaving');
    void goToWorkingDraft(true, 'gone');
  }, [goToWorkingDraft, setLeave]);

  // Save queue, one per theme.
  useEffect(() => {
    const queue = new SaveQueue(businessId, row.id, row.updated_at, {
      put: (id, data, updatedAt) => putTheme(businessId, id, data, updatedAt),
      storage: safeStorage(),
      onStatus: (s, message) => {
        statusRef.current = s;
        setStatus({ status: s, message });
        if (s === 'locked') void goToWorkingDraftRef.current(true, 'live');
        if (s === 'gone') {
          // An idle tab's re-check may already be leaving (and toasted); a late 404 from its pending save is quiet.
          if (!goingRef.current) toastRef.current.info(GONE_TOAST);
          void goToWorkingDraftRef.current(true, 'gone');
        }
      },
      onSaved: (saved) => {
        baseRef.current = saved.updated_at;
        revRef.current += 1;
        // A product or catalog page switches between the classic and the engine layout (D15) only on a
        // full load, and the classic page has no bridge to refresh: reload the frame instead.
        const classic = showsClassicPage(saved.data, frameKeyRef.current);
        const reload = classic || classicRef.current;
        classicRef.current = classic;
        if (reload) setFrameNonce((n) => n + 1);
        else postRef.current?.({ source: BRIDGE_SOURCE, type: 'refresh', rev: revRef.current });
      },
    });
    queueRef.current = queue;
    baseRef.current = row.updated_at;
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
    fetchCategories()
      .then((rows) => !cancelled && setCategories(rows))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [businessId]);

  const select = useCallback(
    (sel: Selection, opts?: { scroll?: boolean; afterSave?: boolean }) => {
      selectionRefState.current = sel;
      setSelection(sel);
      const ref = selectionRef(sel);
      // Any later selection replaces a scroll still waiting for its save.
      pendingScrollRef.current = opts?.scroll && opts.afterSave && ref ? { ref, afterRev: revRef.current } : null;
      const template = templateKeyRef.current;
      post({ source: BRIDGE_SOURCE, type: 'select', template, ref });
      if (opts?.scroll && ref) post({ source: BRIDGE_SOURCE, type: 'scroll-to', template, ref });
    },
    [post],
  );

  // The preview holds the selected top menu item's dropdown open; sent when that changes (selection, the Header's menu,
  // or the item going away). A fresh frame gets it again on 'ready'.
  const holdSentRef = useRef<string | null>(null);
  useEffect(() => {
    const itemId = menuHoldItemId(history.present, selection);
    if (itemId === holdSentRef.current) return;
    holdSentRef.current = itemId;
    post({ source: BRIDGE_SOURCE, type: 'menu-hold', itemId });
  }, [history.present, selection, post]);

  // Undo, redo or a remove can take away what is selected.
  useEffect(() => {
    const cur = selectionRefState.current;
    const next = pruneSelection(history.present, templateKey, cur);
    if (next !== cur) select(next);
  }, [history.present, templateKey, select]);

  const apply = useCallback<Studio2Api['apply']>(
    (fn, opts) => {
      // Read-only while leaving, and once saving stopped (conflict, locked, gone) until Reload (final review I2).
      if (!acceptsEdits(leaveRef.current, statusRef.current)) return null;
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
    if (!acceptsEdits(leaveRef.current, statusRef.current)) return;
    const h = undo(historyRef.current);
    if (h === historyRef.current) return;
    setHistoryBoth(h);
    queueRef.current?.schedule(h.present, true);
  }, [setHistoryBoth]);

  const doRedo = useCallback(() => {
    if (!acceptsEdits(leaveRef.current, statusRef.current)) return;
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

  // D50: back on this tab, check whether another tab deleted, published or reset this theme, even when
  // nothing here is waiting to save. At most once per RECHECK_MS; a network failure is ignored.
  useEffect(() => {
    let cancelled = false;
    const checkable = () =>
      leaveRef.current === 'idle' && !goingRef.current && (statusRef.current === 'saved' || statusRef.current === 'pending');
    const onVisibility = async () => {
      if (document.visibilityState !== 'visible' || !checkable()) return;
      const now = Date.now();
      if (now - lastRecheckRef.current < RECHECK_MS) return;
      lastRecheckRef.current = now;
      const base = baseRef.current;
      let remote: ThemeRow | null;
      try {
        remote = await fetchTheme(businessId, row.id);
      } catch (e) {
        if (!(e instanceof ThemeGoneError)) return;
        remote = null;
      }
      // A save of ours landed meanwhile (the GET may show either side of it), or the editor moved on: skip.
      if (cancelled || baseRef.current !== base || !checkable()) return;
      const pending = statusRef.current === 'pending';
      const state = remoteThemeState({ updatedAt: base, status: statusRef.current }, remote);
      if (state === 'gone') {
        toastRef.current.info(pending ? GONE_TOAST : GONE_IDLE_TOAST);
        void goToWorkingDraftRef.current(true, 'gone');
      } else if (state === 'live') {
        void goToWorkingDraftRef.current(true, 'live');
      } else if (state === 'changed') {
        queueRef.current?.markConflict(); // the existing "changed in another tab" banner
      }
    };
    const handler = () => void onVisibility();
    document.addEventListener('visibilitychange', handler);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', handler);
    };
  }, [businessId, row.id]);

  const hover = useCallback(
    (ref: SectionRef | null) => {
      setHovered(ref);
      post({ source: BRIDGE_SOURCE, type: 'hover', ref });
    },
    [post],
  );

  const openAddSection = useCallback((group: GroupKey, index: number) => setAddSectionTarget({ group, index }), []);
  const closeAddSection = useCallback(() => setAddSectionTarget(null), []);
  const closeNewPage = useCallback(() => setNewPageOpen(false), []);

  // Another template: nothing stays selected, pending edits are saved, then the frame loads that page.
  // Undo history is whole-theme, so it carries over and a switch is not an entry in it.
  const switchTemplate = useCallback(
    async (key: string) => {
      if (key === templateKeyRef.current) return;
      templateKeyRef.current = key;
      setTemplateKey(key);
      select(null);
      setHovered(null);
      setAddSectionTarget(null);
      const seq = ++switchSeqRef.current;
      await queueRef.current?.flush();
      if (seq !== switchSeqRef.current) return;
      classicRef.current = showsClassicPage(historyRef.current.present, key);
      setFrameKey(key);
    },
    [select],
  );

  // The switcher never holds a page that is gone (its creation undone, deleted, or a restore without it): back to Home.
  useEffect(() => {
    const key = openTemplateKey(history.present, templateKey);
    if (key !== templateKey) void switchTemplate(key);
  }, [history.present, templateKey, switchTemplate]);

  // D20: the Product template previews with the first product the store sells until the merchant picks another.
  useEffect(() => {
    if (templateKey !== 'product' || previewProduct !== undefined) return;
    let cancelled = false;
    setProductError(null);
    searchItems('', undefined, { storeOnly: true })
      .then((items) => {
        if (!cancelled) setPreviewProduct(items[0] ? { id: items[0].id, name: items[0].name } : null);
      })
      .catch((e) => {
        if (!cancelled) setProductError(e instanceof Error && e.message ? e.message : 'Failed to load products');
      });
    return () => {
      cancelled = true;
    };
  }, [templateKey, previewProduct]);

  const pickPreviewProduct = useCallback((id: string) => {
    setPreviewProduct({ id, name: null });
    fetchItem(id)
      .then((item) => setPreviewProduct((p) => (p?.id === id ? { id, name: item?.name ?? 'Removed product' } : p)))
      .catch(() => setPreviewProduct((p) => (p?.id === id ? { id, name: 'Product' } : p)));
  }, []);

  const framePath = previewPath(frameKey, { productId: previewProduct?.id });
  const frameEmptyText =
    frameKey === 'product' && framePath === null ? (previewProduct === null ? NO_PRODUCTS_TEXT : productError) : null;

  const onPreviewMessage = useCallback(
    (msg: PreviewToEditor) => {
      // D21: a frame still showing another template (a switch in progress) is not the one being edited.
      if (msg.type !== 'hover' && msg.template !== templateKeyRef.current) return;
      const template = templateKeyRef.current;
      switch (msg.type) {
        case 'ready':
          // A fresh frame (or one that finished an older refresh) learns the selection, and catches up.
          post({ source: BRIDGE_SOURCE, type: 'select', template, ref: selectionRef(selectionRefState.current) });
          // The dropdown held open for the selected menu item (a reload forgets it).
          post({ source: BRIDGE_SOURCE, type: 'menu-hold', itemId: menuHoldItemId(historyRef.current.present, selectionRefState.current) });
          // A reloaded frame (rev null) may have missed a refresh sent while it was loading.
          if (revRef.current > 0 && (msg.rev === null || msg.rev < revRef.current)) {
            post({ source: BRIDGE_SOURCE, type: 'refresh', rev: revRef.current });
          }
          // A reloaded frame (token renewal) starts at the top: bring the selection back into view.
          if (msg.rev === null) {
            const ref = selectionRef(selectionRefState.current);
            if (ref) post({ source: BRIDGE_SOURCE, type: 'scroll-to', template, ref });
          }
          {
            // A section added or duplicated before its save was in the frame: scroll to it now.
            const r = resolvePendingScroll(pendingScrollRef.current, msg.rev);
            pendingScrollRef.current = r.pending;
            if (r.resend) {
              post({ source: BRIDGE_SOURCE, type: 'select', template, ref: r.resend });
              post({ source: BRIDGE_SOURCE, type: 'scroll-to', template, ref: r.resend });
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
        case 'add-at': {
          // Resolved against the editor's own order: the frame may not show the latest save yet.
          const order = getGroup(historyRef.current.present, template, 'template').order;
          openAddSection('template', resolveAddIndex(order, msg.after));
          break;
        }
      }
    },
    [post, openAddSection],
  );

  const copyPreview = useCallback(async () => {
    try {
      const url = await previewLink(businessId, row.id, 'share', framePath ?? '/');
      await navigator.clipboard.writeText(url);
      toast.success('Preview link copied');
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : 'Could not copy the preview link');
    }
  }, [businessId, row.id, toast, framePath]);

  const publish = useCallback(async () => {
    const queue = queueRef.current;
    if (!queue || leaveRef.current !== 'idle') return;
    setLeave('leaving'); // no edits (or undo) while publishing
    await queue.flush();
    if (goingRef.current) return; // the save found the theme gone or live: already moving to the working draft
    if (statusRef.current !== 'saved') {
      setLeave('idle');
      toast.error('Save your changes before publishing');
      return;
    }
    let published: ThemeRow;
    try {
      published = await publishTheme(businessId, row.id);
    } catch (e) {
      setLeave('idle');
      toast.error(e instanceof Error ? e.message : 'Failed to publish theme');
      return;
    }
    toast.success('Published');
    // The working draft's data is copied onto the live theme and it stays the working draft (R11),
    // so editing goes on here. Any other draft itself became live: move to the working draft.
    if (published.id === row.id) {
      await goToWorkingDraft(false, 'live');
      return;
    }
    setLeave('idle');
  }, [businessId, row.id, toast, goToWorkingDraft, setLeave]);

  // Open a draft restored from the version history: pending edits are saved first, as publish does.
  const openRestored = useCallback(
    async (theme: ThemeRow) => {
      if (leaveRef.current !== 'idle') return;
      const queue = queueRef.current;
      setLeave('leaving'); // no edits while the last save goes out
      if (queue) await queue.flush();
      if (goingRef.current) return; // the save found the theme gone or live: already moving to the working draft
      if (statusRef.current !== 'saved') {
        setLeave('idle');
        toast.error(LEAVE_UNSAVED_TEXT);
        return;
      }
      router.push(editorPath(theme.id));
    },
    [router, toast, setLeave],
  );
  const closeHistory = useCallback(() => setHistoryOpen(false), []);
  // The drawer's toast "Restored as …" carries the Open action; the drawer closes so the editor is in view.
  const onRestored = useCallback(() => setHistoryOpen(false), []);
  const openRestoredVoid = useCallback((theme: ThemeRow) => void openRestored(theme), [openRestored]);

  const keepBackup = useCallback(() => {
    const data = backupChoice;
    if (!data) return;
    apply(() => data, { mergeKey: null, immediate: true });
  }, [backupChoice, apply]);

  const discardBackup = useCallback(() => {
    try {
      safeStorage()?.removeItem(backupKey(businessId, row.id));
    } catch {
      /* ignore */
    }
    setBackupChoice(null);
  }, [businessId, row.id]);

  const pages = useMemo(() => customPages(history.present), [history.present]);
  const s = status.status;
  const view = shellView(leave, s, status.message, leaveReason);
  const switchTemplateVoid = useCallback((key: string) => void switchTemplate(key), [switchTemplate]);

  const api = useMemo<Studio2Api>(
    () => ({
      theme: history.present,
      templateKey,
      selection,
      apply,
      select,
      hover,
      openAddSection,
      categories,
      pages,
      switchTemplate: switchTemplateVoid,
      hovered,
      addSectionTarget,
      closeAddSection,
      readOnly: view.readOnly,
    }),
    [
      history.present,
      templateKey,
      selection,
      apply,
      select,
      hover,
      openAddSection,
      categories,
      pages,
      switchTemplateVoid,
      hovered,
      addSectionTarget,
      closeAddSection,
      view.readOnly,
    ],
  );

  return (
    <Studio2Context.Provider value={api}>
      <div className="fixed inset-0 z-[90] flex flex-col bg-white text-gray-900">
        <TopBar
          themeName={row.name}
          templateKey={templateKey}
          templateOptions={templateOptions(history.present)}
          onTemplate={(key) => void switchTemplate(key)}
          onNewPage={() => setNewPageOpen(true)}
          previewProduct={previewProduct ?? null}
          onPreviewProduct={pickPreviewProduct}
          readOnly={view.readOnly}
          canUndo={canUndo(history)}
          canRedo={canRedo(history)}
          onUndo={doUndo}
          onRedo={doRedo}
          device={device}
          onDevice={setDevice}
          statusLabel={view.statusLabel}
          statusIsError={leave === 'failed' || s === 'error' || s === 'conflict' || s === 'locked' || s === 'gone'}
          onCopyPreview={copyPreview}
          onPublish={publish}
          onHistory={() => setHistoryOpen(true)}
        />

        {view.blockingBanner && (
          <Banner tone="error">
            {view.blockingBanner}
            {view.retry ? (
              <BannerButton onClick={retryLeave}>Try again</BannerButton>
            ) : (
              <BannerButton onClick={() => window.location.reload()}>Reload</BannerButton>
            )}
          </Banner>
        )}
        {s === 'conflict' && (
          <Banner tone="error">
            This theme changed in another tab. Reload to keep editing.
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
        {backupChoice && !view.readOnly && (
          <Banner tone="warn">
            You have changes that hadn&apos;t saved from another theme (deleted, or published elsewhere). Keep my
            changes replaces this design with them.
            <BannerButton onClick={keepBackup}>Keep my changes</BannerButton>
            <BannerButton onClick={discardBackup}>Discard</BannerButton>
          </Banner>
        )}
        {droppedNotice && (
          <Banner tone="warn">
            {DROPPED_BACKUP_TEXT}
            <BannerButton onClick={() => setDroppedNotice(false)}>OK</BannerButton>
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
            path={framePath}
            emptyText={frameEmptyText}
            reloadKey={frameNonce}
            postRef={postRef}
            onMessage={onPreviewMessage}
          />
          <aside className="w-80 shrink-0 overflow-y-auto border-l border-gray-200 bg-white">
            <SettingsPanel preset={row.preset} />
          </aside>
        </div>
      </div>
      <AddSectionModal />
      {newPageOpen && <NewPageModal onClose={closeNewPage} />}
      {/* The editor page only opens with settings:update, so Preview and Restore are offered. */}
      <VersionHistoryDrawer
        open={historyOpen}
        onClose={closeHistory}
        canEdit
        onRestored={onRestored}
        onOpenRestored={openRestoredVoid}
      />
    </Studio2Context.Provider>
  );
}

/**
 * Moves edits the server refused to the next draft's backup slot; its base never matches, so the merchant
 * chooses. `savedAt` is required: the editor page's sweep (D51) drops a backup without one before reading it.
 */
function carryBackup(businessId: string, fromId: string, toId: string, data: ThemeData): void {
  const storage = safeStorage();
  if (!storage) return;
  try {
    storage.setItem(backupKey(businessId, toId), JSON.stringify({ data, base: CARRIED_BASE, savedAt: Date.now() }));
    storage.removeItem(backupKey(businessId, fromId));
  } catch {
    /* storage unavailable or full */
  }
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
