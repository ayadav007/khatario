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

export function backupKey(themeId: string): string {
  return 'kh-theme-unsaved:' + themeId;
}

export function readBackup(
  storage: BackupStorage | null,
  themeId: string,
  serverUpdatedAt: string,
): { data: ThemeData; stale: boolean } | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(backupKey(themeId));
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
  private inFlight = false;
  private stopped: 'conflict' | 'locked' | null = null;
  private disposed = false;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private status: SaveStatus | null = null;
  private message: string | undefined;
  private waiters: Array<() => void> = [];

  constructor(
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
      this.setStatus(this.stopped);
      return;
    }
    this.queued = data;
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
    if (this.disposed) return;

    if (res.status === 200 && res.body.theme) {
      const theme = res.body.theme;
      this.serverUpdatedAt = theme.updated_at;
      this.deps.onSaved(theme);
      if (this.queued) {
        this.writeBackup(this.queued); // re-base on the new updated_at
        await this.run();
        return;
      }
      this.removeBackup();
      this.setStatus('saved');
      this.release();
      return;
    }

    const code = res.body.code;
    if (res.status === 409 && code === 'conflict') {
      this.stopped = 'conflict';
      this.setStatus('conflict', res.body.error);
    } else if (res.status === 409 && code === 'live_locked') {
      this.stopped = 'locked';
      this.setStatus('locked', res.body.error);
    } else {
      if (!this.queued) this.queued = data;
      this.setStatus('error', res.body.error);
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
        backupKey(this.themeId),
        JSON.stringify({ data, base: this.serverUpdatedAt }),
      );
    } catch {
      /* storage unavailable or full: keep working without it */
    }
  }

  private removeBackup(): void {
    try {
      this.deps.storage?.removeItem(backupKey(this.themeId));
    } catch {
      /* ignore */
    }
  }
}
