import type { ThemeData, ThemeRow } from '@/lib/store/engine/types';

export const AUTOSAVE_MS = 1000;
export const RETRY_MS = 5000;

export type SaveStatus = 'saved' | 'pending' | 'saving' | 'offline' | 'conflict' | 'locked' | 'error';

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

/**
 * Drops this business's backups for other themes (ones that went live, or were left after a lock) and
 * any legacy business-less key. Other businesses' backups stay.
 */
export function sweepOtherBackups(
  storage: Pick<Storage, 'length' | 'key' | 'removeItem'> | null,
  businessId: string,
  keepThemeId: string,
): void {
  if (!storage) return;
  try {
    const prefix = backupKey(businessId, '');
    const keep = backupKey(businessId, keepThemeId);
    const stale: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (!k || k === keep) continue;
      if (k.startsWith(prefix) || LEGACY_BACKUP_RE.test(k)) stale.push(k);
    }
    stale.forEach((k) => storage.removeItem(k));
  } catch {
    /* storage unavailable */
  }
}

export function readBackup(
  storage: BackupStorage | null,
  businessId: string,
  themeId: string,
  serverUpdatedAt: string,
): { data: ThemeData; stale: boolean } | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(backupKey(businessId, themeId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !parsed.data || typeof parsed.base !== 'string') {
      return null;
    }
    return { data: parsed.data as ThemeData, stale: parsed.base !== serverUpdatedAt };
  } catch {
    return null;
  }
}

export class SaveQueue {
  private serverUpdatedAt: string;
  private queued: ThemeData | null = null;
  /** The newest schedule() asked to save now (undo, a structural change), so a chained save skips the debounce. */
  private queuedImmediate = false;
  private inFlight = false;
  private stopped: 'conflict' | 'locked' | null = null;
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
        JSON.stringify({ data, base: this.serverUpdatedAt }),
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
