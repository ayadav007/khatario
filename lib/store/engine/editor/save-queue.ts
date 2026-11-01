import type { ThemeData, ThemeRow } from '@/lib/store/engine/types';

export const AUTOSAVE_MS = 1000;
export const RETRY_MS = 5000;

/** `gone`: the theme was deleted elsewhere (PUT 404 not_found); the edits stay queued and in the backup (D50). */
export type SaveStatus = 'saved' | 'pending' | 'saving' | 'offline' | 'conflict' | 'locked' | 'gone' | 'error';

export interface PutResult {
  status: number;
  body: { theme?: ThemeRow; error?: string; code?: string };
}

type BackupStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface SaveQueueDeps {
  /** Throws on network failure. */
  put(themeId: string, data: ThemeData, updatedAt: string): Promise<PutResult>;
  storage: BackupStorage | null;
  onStatus(status: SaveStatus, message?: string): void;
  /** The editor sends 'refresh' to the preview from here. */
  onSaved(theme: ThemeRow): void;
}

const BACKUP_PREFIX = 'kh-theme-unsaved:';
/** Pre-M3 keys had no business: `kh-theme-unsaved:<themeId>`. */
const LEGACY_BACKUP_RE = /^kh-theme-unsaved:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Unsaved-change backups are kept per business, so one business never sweeps another's (N3). */
export function backupKey(businessId: string, themeId: string): string {
  return `${BACKUP_PREFIX}${businessId}:${themeId}`;
}

/** Backups older than this are dropped by the sweep (D51). */
export const BACKUP_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

/** True when an unsaved-changes backup is stored for this theme (the library badge, D51). */
export function hasBackup(storage: Pick<Storage, 'getItem'> | null, businessId: string, themeId: string): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(backupKey(businessId, themeId)) !== null;
  } catch {
    return false;
  }
}

/**
 * The `base` of edits moved here from another theme (refused as live_locked, or that theme was deleted, D50).
 * It never matches a server `updated_at`, so the merchant chooses (Keep my changes / Discard).
 */
export const CARRIED_BASE = '';

/**
 * Drops this business's backups that are no longer useful (D51): ones whose theme is not in `keepThemeIds`
 * (only when a list is given), ones with no readable `savedAt` or older than `maxAgeMs`, and any legacy
 * business-less key. Other businesses' backups stay.
 *
 * A backup marked `gone` (its theme was deleted and the editor could not open the working copy, final
 * review M1) is not dropped for being unlisted: it moves to `adoptInto` (the working copy) as a carried
 * backup when that slot is free, and otherwise waits for a later sweep (still within `maxAgeMs`).
 */
export function sweepBackups(
  storage: (Pick<Storage, 'length' | 'key' | 'removeItem' | 'getItem'> & Partial<Pick<Storage, 'setItem'>>) | null,
  businessId: string,
  opts: { keepThemeIds?: string[]; now: number; maxAgeMs?: number; adoptInto?: string | null },
): void {
  if (!storage) return;
  try {
    const prefix = backupKey(businessId, '');
    const maxAge = opts.maxAgeMs ?? BACKUP_MAX_AGE_MS;
    const keep = opts.keepThemeIds ? new Set(opts.keepThemeIds) : null;
    const stale: string[] = [];
    const goneOrphans: Array<{ key: string; data: unknown; savedAt: number }> = [];
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (!k) continue;
      if (LEGACY_BACKUP_RE.test(k)) {
        stale.push(k);
        continue;
      }
      if (!k.startsWith(prefix)) continue;
      let parsed: { savedAt?: unknown; gone?: unknown; data?: unknown } | null;
      try {
        parsed = JSON.parse(storage.getItem(k) ?? 'null');
      } catch {
        parsed = null;
      }
      const savedAt = parsed?.savedAt;
      if (typeof savedAt !== 'number' || opts.now - savedAt > maxAge) {
        stale.push(k);
        continue;
      }
      if (keep && !keep.has(k.slice(prefix.length))) {
        if (parsed?.gone === true && parsed.data) goneOrphans.push({ key: k, data: parsed.data, savedAt });
        else stale.push(k);
      }
    }
    stale.forEach((k) => storage.removeItem(k));
    const target = opts.adoptInto ? backupKey(businessId, opts.adoptInto) : null;
    if (target && storage.setItem && goneOrphans.length > 0 && storage.getItem(target) === null) {
      // The newest one takes the free slot; any other waits for a later sweep.
      const newest = goneOrphans.reduce((a, b) => (b.savedAt > a.savedAt ? b : a));
      storage.setItem(target, JSON.stringify({ data: newest.data, base: CARRIED_BASE, savedAt: newest.savedAt }));
      storage.removeItem(newest.key);
    }
  } catch {
    /* storage unavailable */
  }
}

/**
 * Keeps the edits of a theme that was deleted while the editor could not open the working copy (final review
 * M1): stored under the deleted theme's key and marked `gone`, so the library's sweep moves them to the
 * working copy instead of dropping them. False when storage is unavailable.
 */
export function keepGoneBackup(
  storage: BackupStorage | null,
  businessId: string,
  themeId: string,
  data: ThemeData,
  now: number,
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(backupKey(businessId, themeId), JSON.stringify({ data, base: CARRIED_BASE, savedAt: now, gone: true }));
    return true;
  } catch {
    return false;
  }
}

/**
 * How a stored backup relates to the server copy:
 * - current: made on this exact server copy (same `updated_at`): restored and saved straight away;
 * - carried: moved here from another theme (CARRIED_BASE): offered with Keep my changes / Discard;
 * - outdated: made on an older copy, and the server moved on since (another tab saved, published or reset
 *   it). Never offered: it holds the whole old design, and keeping it would put that design back over the
 *   newer one (final review I2).
 */
export type BackupKind = 'current' | 'carried' | 'outdated';

export function readBackup(
  storage: BackupStorage | null,
  businessId: string,
  themeId: string,
  serverUpdatedAt: string,
): { data: ThemeData; kind: BackupKind; gone: boolean } | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(backupKey(businessId, themeId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !parsed.data || typeof parsed.base !== 'string') {
      return null;
    }
    const kind: BackupKind =
      parsed.base === serverUpdatedAt ? 'current' : parsed.base === CARRIED_BASE ? 'carried' : 'outdated';
    return { data: parsed.data as ThemeData, kind, gone: parsed.gone === true };
  } catch {
    return null;
  }
}

/** What the editor opens with, given the server copy and any stored backup (see BackupKind). */
export interface BackupOnOpen {
  initialData: ThemeData;
  /** initialData is a current backup: save it straight away. */
  restored: boolean;
  /** A carried backup: the merchant keeps or discards it. */
  carried: ThemeData | null;
  /** An outdated backup was dropped: the editor says so. */
  dropped: boolean;
}

/**
 * Reads the backup for an opening editor and settles it. One equal to the server copy (a save that landed
 * after leaving) is removed silently; an outdated one is removed and reported as `dropped`.
 */
export function backupOnOpen(
  storage: BackupStorage | null,
  businessId: string,
  theme: { id: string; updated_at: string; data: ThemeData },
): BackupOnOpen {
  const plain: BackupOnOpen = { initialData: theme.data, restored: false, carried: null, dropped: false };
  const backup = readBackup(storage, businessId, theme.id, theme.updated_at);
  if (!backup) return plain;
  const remove = () => {
    try {
      storage?.removeItem(backupKey(businessId, theme.id));
    } catch {
      /* ignore */
    }
  };
  if (JSON.stringify(backup.data) === JSON.stringify(theme.data)) {
    remove();
    return plain;
  }
  if (backup.kind === 'outdated') {
    remove();
    return { ...plain, dropped: true };
  }
  if (backup.kind === 'carried') return { ...plain, carried: backup.data };
  return { ...plain, initialData: backup.data, restored: true };
}

export class SaveQueue {
  private serverUpdatedAt: string;
  private queued: ThemeData | null = null;
  /** The newest schedule() asked to save now (undo, a structural change), so a chained save skips the debounce. */
  private queuedImmediate = false;
  private inFlight = false;
  private stopped: 'conflict' | 'locked' | 'gone' | null = null;
  private disposed = false;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private status: SaveStatus | null = null;
  private message: string | undefined;
  private waiters: Array<() => void> = [];

  constructor(
    private readonly businessId: string,
    private readonly themeId: string,
    updatedAt: string,
    private readonly deps: SaveQueueDeps,
  ) {
    this.serverUpdatedAt = updatedAt;
  }

  schedule(data: ThemeData, immediate = false): void {
    if (this.disposed) return;
    this.writeBackup(data);
    if (this.stopped) {
      this.setStatus(this.stopped, this.message);
      return;
    }
    this.queued = data;
    this.queuedImmediate = immediate;
    if (this.inFlight) return; // chained after the current PUT
    this.clearTimers();
    this.setStatus('pending');
    if (immediate) {
      void this.run();
    } else {
      this.debounceTimer = setTimeout(() => void this.run(), AUTOSAVE_MS);
    }
  }

  flush(): Promise<void> {
    if (this.disposed || this.stopped) return Promise.resolve();
    if (this.queued && !this.inFlight) void this.run();
    if (this.isSettled()) return Promise.resolve();
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  retry(): void {
    if (this.disposed || this.stopped) return;
    if (this.status !== 'offline' && this.status !== 'error') return;
    if (this.queued && !this.inFlight) void this.run();
  }

  /**
   * The theme changed on the server while nothing here was unsaved (an idle tab's re-check, D50): stop
   * saving, as a 409 conflict would, so a stale copy never overwrites it.
   */
  markConflict(message?: string): void {
    if (this.disposed || this.stopped) return;
    this.clearTimers();
    this.stopped = 'conflict';
    this.setStatus('conflict', message);
    this.release();
  }

  dispose(): void {
    this.disposed = true;
    this.clearTimers();
    this.release();
  }

  private async run(): Promise<void> {
    this.clearTimers();
    if (this.disposed || this.inFlight || this.stopped || !this.queued) return;
    const data = this.queued;
    this.queued = null;
    this.inFlight = true;
    this.setStatus('saving');

    let res: PutResult;
    try {
      res = await this.deps.put(this.themeId, data, this.serverUpdatedAt);
    } catch {
      this.inFlight = false;
      if (this.disposed) return;
      if (!this.queued) this.queued = data;
      this.setStatus('offline');
      this.retryTimer = setTimeout(() => void this.run(), RETRY_MS);
      this.release();
      return;
    }
    this.inFlight = false;

    const body = res?.body ?? {};
    if (this.disposed) {
      // The editor has gone (a flush on leaving): still settle the backup so the next open
      // doesn't offer changes the server already has. No status or preview callbacks.
      if (res?.status === 200 && body.theme) {
        this.serverUpdatedAt = body.theme.updated_at;
        if (this.queued) this.writeBackup(this.queued);
        else this.removeBackup();
      }
      return;
    }

    if (res?.status === 200 && body.theme) {
      const theme = body.theme;
      this.serverUpdatedAt = theme.updated_at;
      try {
        this.deps.onSaved(theme);
      } catch (err) {
        console.error('save-queue: onSaved threw', err);
      }
      if (this.queued) {
        this.writeBackup(this.queued); // re-base on the new updated_at
        if (this.queuedImmediate || this.waiters.length > 0) {
          await this.run();
        } else {
          // Typing continued during the save: wait for the usual pause before the next one.
          this.setStatus('pending');
          this.debounceTimer = setTimeout(() => void this.run(), AUTOSAVE_MS);
        }
        return;
      }
      this.removeBackup();
      this.setStatus('saved');
      this.release();
      return;
    }

    const code = body.code;
    if (res?.status === 200) {
      if (!this.queued) this.queued = data;
      this.setStatus('error', 'Unexpected response from the server');
    } else if (res?.status === 409 && code === 'conflict') {
      this.stopped = 'conflict';
      this.setStatus('conflict', body.error);
    } else if (res.status === 409 && code === 'live_locked') {
      this.stopped = 'locked';
      this.setStatus('locked', body.error);
    } else if (res.status === 404 && code === 'not_found') {
      // Deleted elsewhere: keep the edits (queued and backed up) so the editor can carry them on.
      if (!this.queued) this.queued = data;
      this.stopped = 'gone';
      this.setStatus('gone', body.error);
    } else {
      if (!this.queued) this.queued = data;
      this.setStatus('error', body.error);
    }
    this.release();
  }

  private isSettled(): boolean {
    if (this.inFlight || this.debounceTimer) return false;
    if (!this.queued) return true;
    return this.status === 'offline' || this.status === 'error';
  }

  private release(): void {
    if (!this.disposed && !this.stopped && !this.isSettled()) return;
    const w = this.waiters;
    this.waiters = [];
    w.forEach((r) => r());
  }

  private clearTimers(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.debounceTimer = null;
    this.retryTimer = null;
  }

  private setStatus(status: SaveStatus, message?: string): void {
    if (this.status === status && this.message === message) return;
    this.status = status;
    this.message = message;
    this.deps.onStatus(status, message);
  }

  private writeBackup(data: ThemeData): void {
    try {
      this.deps.storage?.setItem(
        backupKey(this.businessId, this.themeId),
        JSON.stringify({ data, base: this.serverUpdatedAt, savedAt: Date.now() }),
      );
    } catch {
      /* storage unavailable or full: keep working without it */
    }
  }

  private removeBackup(): void {
    try {
      this.deps.storage?.removeItem(backupKey(this.businessId, this.themeId));
    } catch {
      /* ignore */
    }
  }
}
