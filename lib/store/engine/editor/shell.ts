// Client-safe helpers for the Studio 2 editor shell (selection, save status, shortcuts).
// Pure: no React, no DOM globals. Imports only ops (types + getGroup).
import type { MenuItem, ThemeData, ThemeRole } from '../types';
import { getGroup, type SectionRef } from './ops';
import type { SaveStatus } from './save-queue';

export type Selection =
  | { kind: 'section'; ref: SectionRef }
  | { kind: 'block'; ref: SectionRef; blockId: string }
  | { kind: 'theme' }
  | { kind: 'menus' }
  | { kind: 'menu'; menuId: string; itemId: string | null }
  | null;

function hasMenuItem(items: MenuItem[] | undefined, id: string): boolean {
  return (items ?? []).some((i) => i.id === id || hasMenuItem(i.children, id));
}

const hasOwn = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/** A section clicked in the preview. */
export function toSelection(ref: SectionRef | null): Selection {
  return ref ? { kind: 'section', ref } : null;
}

/** The section the preview should outline for a selection, if any. */
export function selectionRef(sel: Selection): SectionRef | null {
  if (!sel || sel.kind === 'theme' || sel.kind === 'menus' || sel.kind === 'menu') return null;
  return sel.ref;
}

/**
 * Keep a selection only while what it points at exists (after undo, redo or a remove).
 * A missing block falls back to its section; a missing section clears the selection.
 */
export function pruneSelection(theme: ThemeData, templateKey: string, sel: Selection): Selection {
  if (!sel || sel.kind === 'theme' || sel.kind === 'menus') return sel;
  if (sel.kind === 'menu') {
    const menus = Array.isArray(theme.settings?.menus) ? theme.settings.menus : [];
    const menu = menus.find((m) => m.id === sel.menuId);
    if (!menu) return { kind: 'menus' };
    if (sel.itemId === null || hasMenuItem(menu.items, sel.itemId)) return sel;
    return { kind: 'menu', menuId: sel.menuId, itemId: null };
  }
  const group = getGroup(theme, templateKey, sel.ref.group);
  if (!hasOwn(group.sections, sel.ref.id)) return null;
  if (sel.kind === 'section') return sel;
  const section = group.sections[sel.ref.id];
  return hasOwn(section.blocks, sel.blockId) ? sel : { kind: 'section', ref: sel.ref };
}

export function saveStatusLabel(status: SaveStatus, message?: string): string {
  switch (status) {
    case 'saved':
      return 'Saved';
    case 'saving':
      return 'Saving…';
    case 'pending':
      return 'Unsaved';
    case 'offline':
      return 'Offline';
    case 'error':
      return message ? `Error ${message}` : 'Error';
    default:
      return 'Not saved'; // conflict / locked / gone: the banner or the move to the working copy explains
  }
}

/**
 * What another tab did to the open theme, from a re-check GET (D50). `remote` is null when the GET was a 404.
 * - gone: deleted; live: published; changed: the server moved on while nothing of ours was unsaved;
 * - same: otherwise, including a newer updated_at while our own save is pending or in flight.
 */
export function remoteThemeState(
  local: { updatedAt: string; status: SaveStatus },
  remote: { role: ThemeRole; updated_at: string } | null,
): 'same' | 'gone' | 'live' | 'changed' {
  if (!remote) return 'gone';
  if (remote.role === 'live') return 'live';
  if (remote.updated_at !== local.updatedAt && local.status === 'saved') return 'changed';
  return 'same';
}

/** Edits that are not on the server yet. */
export function shouldWarnOnLeave(status: SaveStatus): boolean {
  return status === 'pending' || status === 'saving' || status === 'offline';
}

interface KeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/** Ctrl/Cmd+Z undo; Ctrl/Cmd+Shift+Z and Ctrl+Y redo. */
export function shortcutFor(e: KeyLike): 'undo' | 'redo' | null {
  if (e.altKey || !(e.ctrlKey || e.metaKey)) return null;
  const key = e.key.toLowerCase();
  if (key === 'z') return e.shiftKey ? 'redo' : 'undo';
  if (key === 'y' && e.ctrlKey && !e.shiftKey) return 'redo';
  return null;
}

const NON_TEXT_INPUTS = new Set(['checkbox', 'radio', 'range', 'button', 'submit', 'reset', 'color', 'file', 'image', 'hidden']);

/** Focus in a text field keeps the browser's own undo; toggles, sliders and buttons do not. */
export function isEditableTarget(t: unknown): boolean {
  if (!t || typeof t !== 'object') return false;
  const el = t as { tagName?: unknown; isContentEditable?: unknown; type?: unknown };
  if (el.isContentEditable === true) return true;
  if (el.tagName === 'INPUT') return !(typeof el.type === 'string' && NON_TEXT_INPUTS.has(el.type.toLowerCase()));
  return el.tagName === 'TEXTAREA' || el.tagName === 'SELECT';
}

/** idle: editing; leaving: publishing or opening the next working draft; failed: that open failed. */
export type LeaveState = 'idle' | 'leaving' | 'failed';

export const LEAVE_FAILED_TEXT = 'This theme is now live. Reload the editor to keep editing.';
/** Final review M1: the theme was deleted and opening the working copy failed. */
export const GONE_LEAVE_FAILED_TEXT = "This theme was deleted and your working copy couldn't be opened.";
/** …and the unsaved edits were stored for the working copy (the library moves them there). */
export const GONE_EDITS_KEPT_TEXT =
  'Your unsaved changes are kept on this device and will be offered on your working copy.';
/** …and this browser would not store them: they live only in this tab. */
export const GONE_EDITS_TAB_ONLY_TEXT =
  "Your unsaved changes couldn't be stored on this device: keep this tab open and try again.";

/**
 * Why the editor is leaving this theme: it went live, or it was deleted. For `gone`, what became of the
 * unsaved edits when the move failed: none to keep, kept for the working copy, or only in this tab.
 */
export type LeaveReason = 'live' | { gone: 'none' | 'kept' | 'tab_only' };

/** Save stopped for good on this theme: only Reload (or the move to the working copy) goes on. */
const STOPPED: ReadonlySet<SaveStatus> = new Set<SaveStatus>(['conflict', 'locked', 'gone']);

/**
 * Final review I2: edits are taken only while idle and while saving can still go on. In conflict, locked or
 * gone, a new edit could never be saved here and would only rewrite the backup on top of a stale design.
 */
export function acceptsEdits(leave: LeaveState, status: SaveStatus): boolean {
  return leave === 'idle' && !STOPPED.has(status);
}

/** What the shell allows and shows while it is (or failed at) leaving this theme. */
export function shellView(
  leave: LeaveState,
  status: SaveStatus,
  message?: string,
  reason: LeaveReason = 'live',
): { readOnly: boolean; statusLabel: string; blockingBanner: string | null; retry: boolean } {
  if (leave === 'failed') {
    if (reason === 'live') return { readOnly: true, statusLabel: 'Not saved', blockingBanner: LEAVE_FAILED_TEXT, retry: false };
    const edits =
      reason.gone === 'kept' ? ` ${GONE_EDITS_KEPT_TEXT}` : reason.gone === 'tab_only' ? ` ${GONE_EDITS_TAB_ONLY_TEXT}` : '';
    return { readOnly: true, statusLabel: 'Not saved', blockingBanner: `${GONE_LEAVE_FAILED_TEXT}${edits}`, retry: true };
  }
  return {
    readOnly: !acceptsEdits(leave, status),
    statusLabel: saveStatusLabel(status, message),
    blockingBanner: null,
    retry: false,
  };
}

/** The iframe src for an editor preview link. */
export function editorFrameSrc(previewUrl: string): string | null {
  try {
    const u = new URL(previewUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    u.searchParams.set('editor', '1');
    return u.toString();
  } catch {
    return null;
  }
}

/** A new section to scroll to once the preview shows the save after `afterRev` (it isn't in the frame before). */
export interface PendingScroll {
  ref: SectionRef;
  afterRev: number;
}

/**
 * On a preview `ready`: resend select + scroll-to when the frame shows a rev past the pending one.
 * A reloaded frame (rev null) keeps waiting; the editor follows it with a refresh that carries a rev.
 */
export function resolvePendingScroll(
  pending: PendingScroll | null,
  readyRev: number | null,
): { resend: SectionRef | null; pending: PendingScroll | null } {
  if (!pending || readyRev === null || readyRev <= pending.afterRev) return { resend: null, pending };
  return { resend: pending.ref, pending: null };
}
