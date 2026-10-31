// Client-safe rules for the theme library (D39): which actions each row gets, the preset choices, dates and
// authors. Imports only types and shared.ts, so the library page can use it without pg or sanitize-html.
import { ENGINE_LIMITS } from './shared';
import type { ThemeListRow, ThemePreset } from './types';

export interface PresetChoice {
  preset: ThemePreset;
  label: string;
  description: string;
  /** The preset's paper and accent, for the picker swatch. Copied from presets/look.ts (a test keeps them equal). */
  canvas: string;
  accent: string;
}

export const PRESET_CHOICES: PresetChoice[] = [
  {
    preset: 'studio',
    label: 'Studio',
    description: 'Editorial header, split hero and photo category tiles',
    canvas: '#fbf8f3',
    accent: '#b94717',
  },
  {
    preset: 'quick',
    label: 'Quick',
    description: 'Phone-first quick delivery with a big search and a floating cart bar',
    canvas: '#f3f5f7',
    accent: '#0f7a5c',
  },
  {
    preset: 'grocery',
    label: 'Premium Grocery',
    description: 'Fresh green supermarket with a hero card and emoji category tiles',
    canvas: '#f6f7f4',
    accent: '#176b45',
  },
  {
    preset: 'khatario',
    label: 'Khatario',
    description: 'Brand header, carousel and bottom tabs',
    canvas: '#f4f5f7',
    accent: '#00897b',
  },
  {
    preset: 'blank',
    label: 'Blank',
    description: 'An empty page to build from scratch',
    canvas: '#fbf8f3',
    accent: '#b94717',
  },
];

export const MIGRATED_CHOICE = {
  label: 'Your current store design',
  description: 'A copy of how your store looks today',
} as const;

export interface LibrarySplit {
  live: ThemeListRow | null;
  working: ThemeListRow | null;
  drafts: ThemeListRow[];
}

/** The live theme, the working draft (shown inside the live card) and the other drafts, newest edit first. */
export function splitLibrary(rows: ThemeListRow[]): LibrarySplit {
  let live: ThemeListRow | null = null;
  let working: ThemeListRow | null = null;
  const drafts: ThemeListRow[] = [];
  for (const r of rows) {
    if (r.role === 'live') live = r;
    else if (r.is_working) working = r;
    else drafts.push(r);
  }
  drafts.sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
  return { live, working, drafts };
}

export type ThemeAction = 'customise' | 'preview' | 'duplicate' | 'rename' | 'publish' | 'discard' | 'delete' | 'history';

/** The D39 table. Without edit permission only the preview link stays, plus History on the live card. */
export function themeActions(row: ThemeListRow, opts: { canEdit: boolean }): Set<ThemeAction> {
  const out = new Set<ThemeAction>(['preview']);
  const isLive = row.role === 'live';
  if (isLive) out.add('history');
  if (!opts.canEdit) return out;
  out.add('customise');
  out.add('duplicate');
  out.add('rename');
  if (isLive) return out;
  if (row.is_working) {
    if (row.has_changes) {
      out.add('publish');
      out.add('discard');
    }
    return out;
  }
  out.add('publish');
  out.add('delete');
  return out;
}

export function canAddTheme(count: number): boolean {
  return count < ENGINE_LIMITS.themesPerBusiness;
}

const TZ = 'Asia/Kolkata';

/** "31 Oct 2026, 4:05 pm", in India time. */
export function formatPublishedAt(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: TZ,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
    .format(new Date(t))
    .replace(/\bAM\b/, 'am')
    .replace(/\bPM\b/, 'pm');
}

export function authorLabel(name: string | null): string {
  return name && name.trim() ? name : 'Set up automatically';
}

function formatDate(t: number): string {
  return new Intl.DateTimeFormat('en-IN', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(t));
}

/** "just now", "5 min ago", "3 h ago", "2 days ago" (under a week), else the date. */
export function relativeEdited(iso: string, now: number): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const diff = now - t;
  const MIN = 60_000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;
  if (diff < MIN) return 'just now';
  if (diff < HOUR) return `${Math.floor(diff / MIN)} min ago`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)} h ago`;
  if (diff < 7 * DAY) {
    const d = Math.floor(diff / DAY);
    return d === 1 ? '1 day ago' : `${d} days ago`;
  }
  return formatDate(t);
}
