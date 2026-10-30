// Client-safe helpers for the Studio 2 editor shell (selection, save status, shortcuts).
// Pure: no React, no DOM globals. Imports only ops (types + getGroup).
import type { ThemeData } from '../types';
import { getGroup, type SectionRef } from './ops';
import type { SaveStatus } from './save-queue';

export type Selection =
  | { kind: 'section'; ref: SectionRef }
  | { kind: 'block'; ref: SectionRef; blockId: string }
  | { kind: 'theme' }
  | null;

const hasOwn = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/** A section clicked in the preview. */
export function toSelection(ref: SectionRef | null): Selection {
  return ref ? { kind: 'section', ref } : null;
}

/** The section the preview should outline for a selection, if any. */
export function selectionRef(sel: Selection): SectionRef | null {
  if (!sel || sel.kind === 'theme') return null;
  return sel.ref;
}

/**
 * Keep a selection only while what it points at exists (after undo, redo or a remove).
 * A missing block falls back to its section; a missing section clears the selection.
 */
export function pruneSelection(theme: ThemeData, templateKey: string, sel: Selection): Selection {
  if (!sel || sel.kind === 'theme') return sel;
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
      return 'Not saved'; // conflict / locked: the banner explains
  }
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

/** What the shell allows and shows while it is (or failed at) leaving this theme. */
export function shellView(
  leave: LeaveState,
  status: SaveStatus,
  message?: string,
): { readOnly: boolean; statusLabel: string; blockingBanner: string | null } {
  if (leave === 'failed') return { readOnly: true, statusLabel: 'Not saved', blockingBanner: LEAVE_FAILED_TEXT };
  return { readOnly: leave === 'leaving', statusLabel: saveStatusLabel(status, message), blockingBanner: null };
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
