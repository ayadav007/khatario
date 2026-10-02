import type { LifecycleSignal, LifecycleSource } from '@/lib/notifications/client/lifecycle';
import type { KeyValueStorage, StreamSession } from '@/lib/notifications/client/primitives';
import {
  NotificationStreamClient,
  STREAM_CLIENT_DEFAULTS,
  type ChannelLike,
  type StreamConsumer,
} from '@/lib/notifications/client/stream-client';

export class MemoryStorage implements KeyValueStorage {
  map = new Map<string, string>();
  getItem(k: string) {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}

const enc = new TextEncoder();

export type StreamHandle = { push(text: string): void; end(): void; error(): void };

/** One fetch() call the test answers explicitly. */
export class FakeCall {
  readonly at = Date.now();
  private settled = false;
  cancelled = false;

  constructor(
    readonly url: string,
    readonly headers: Record<string, string>,
    readonly signal: AbortSignal,
    private readonly resolve: (r: unknown) => void,
    private readonly reject: (e: unknown) => void
  ) {
    signal.addEventListener('abort', () => this.fail(new Error('AbortError')));
  }

  respond(status: number, headers: Record<string, string> = {}, text = ''): void {
    if (this.settled) return;
    this.settled = true;
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        if (text) c.enqueue(enc.encode(text));
        c.close();
      },
    });
    this.resolve({ status, headers: new Headers(headers), body });
  }

  stream(): StreamHandle {
    let ctrl!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start: (c) => {
        ctrl = c;
      },
      cancel: () => {
        this.cancelled = true;
      },
    });
    this.signal.addEventListener('abort', () => {
      try {
        ctrl.error(new Error('AbortError'));
      } catch {
        /* closed */
      }
    });
    this.settled = true;
    this.resolve({ status: 200, headers: new Headers({ 'content-type': 'text/event-stream; charset=utf-8' }), body });
    const safe = (fn: () => void) => {
      try {
        fn();
      } catch {
        /* stream already closed/errored */
      }
    };
    return {
      push: (t) => safe(() => ctrl.enqueue(enc.encode(t))),
      end: () => safe(() => ctrl.close()),
      error: () => safe(() => ctrl.error(new Error('network'))),
    };
  }

  fail(error: unknown = new TypeError('Failed to fetch')): void {
    if (this.settled) return;
    this.settled = true;
    this.reject(error);
  }
}

export class FakeServer {
  calls: FakeCall[] = [];

  fetch = (input: unknown, init?: RequestInit): Promise<Response> =>
    new Promise((resolve, reject) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      this.calls.push(new FakeCall(String(input), headers, init!.signal!, resolve as never, reject));
    });

  last(): FakeCall {
    return this.calls[this.calls.length - 1];
  }
}

export class FakeLifecycle implements LifecycleSource {
  visible = true;
  online = true;
  handlers = new Set<(s: LifecycleSignal) => void>();
  isVisible = () => this.visible;
  isOnline = () => this.online;
  subscribe(handler: (s: LifecycleSignal) => void) {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }
  emit(signal: LifecycleSignal) {
    if (signal === 'online') this.online = true;
    if (signal === 'offline') this.online = false;
    if (signal === 'visible') this.visible = true;
    if (signal === 'hidden') this.visible = false;
    for (const h of [...this.handlers]) h(signal);
  }
}

/** In-memory BroadcastChannel: async delivery to the other channels with the same name. */
export class ChannelBus {
  channels = new Set<ChannelLike & { name: string; closed: boolean }>();

  create = (name: string): ChannelLike => {
    const bus = this;
    const ch = {
      name,
      closed: false,
      onmessage: null as ChannelLike['onmessage'],
      postMessage(message: unknown) {
        const data = structuredClone(message);
        for (const other of bus.channels) {
          if (other !== ch && other.name === name && !other.closed) {
            void Promise.resolve().then(() => other.onmessage?.({ data }));
          }
        }
      },
      close() {
        ch.closed = true;
        bus.channels.delete(ch);
      },
    };
    this.channels.add(ch);
    return ch;
  };
}

export const SESSION: StreamSession = {
  businessId: '22222222-2222-4222-8222-222222222222',
  userId: '11111111-1111-4111-8111-111111111111',
};
export const OTHER_SESSION: StreamSession = {
  businessId: '33333333-3333-4333-8333-333333333333',
  userId: '11111111-1111-4111-8111-111111111111',
};

export const nid = (seq: string | number) => `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`;

export function msg(seq: string | number, opts: { id?: string | number; type?: string; extra?: object } = {}): string {
  const payload = {
    type: opts.type ?? 'general',
    businessId: SESSION.businessId,
    userId: SESSION.userId,
    notificationId: nid(seq),
    title: `t${seq}`,
    message: `m${seq}`,
    reference_id: null,
    reference_type: null,
    timestamp: Date.now(),
    seq: String(seq),
    ...(opts.extra ?? {}),
  };
  return `id: ${opts.id ?? seq}\nevent: message\ndata: ${JSON.stringify(payload)}\n\n`;
}

export type TestConsumer = StreamConsumer & {
  onNotification: jest.Mock;
  reconcile: jest.Mock;
  onRemoteDismiss: jest.Mock;
  onUnauthorized: jest.Mock;
  onForbidden: jest.Mock;
  onStatus: jest.Mock;
};

export function consumer(session: StreamSession = SESSION, overrides: Partial<TestConsumer> = {}): TestConsumer {
  return {
    session,
    onNotification: jest.fn(async () => {}),
    reconcile: jest.fn(async () => '0'),
    onRemoteDismiss: jest.fn(),
    onUnauthorized: jest.fn(),
    onForbidden: jest.fn(),
    onStatus: jest.fn(),
    ...overrides,
  } as TestConsumer;
}

export function setup(opts: { random?: () => number; storage?: MemoryStorage; bus?: ChannelBus; dedupMax?: number } = {}) {
  const server = new FakeServer();
  const lifecycle = new FakeLifecycle();
  const storage = opts.storage ?? new MemoryStorage();
  const bus = opts.bus ?? new ChannelBus();
  const refreshSession = jest.fn(async () => true);
  let skew = 0;
  const client = new NotificationStreamClient({
    ...STREAM_CLIENT_DEFAULTS,
    fetch: server.fetch as unknown as typeof fetch,
    storage,
    random: opts.random ?? (() => 0.5),
    now: () => Date.now() + skew,
    lifecycle,
    createChannel: bus.create,
    refreshSession,
    dedupMax: opts.dedupMax ?? STREAM_CLIENT_DEFAULTS.dedupMax,
  });
  return {
    client,
    server,
    lifecycle,
    storage,
    bus,
    refreshSession,
    /** Simulates JS being frozen (Android background): wall clock jumps, no timers ran. */
    freeze: (ms: number) => {
      skew += ms;
    },
  };
}

export const flush = async () => {
  for (let i = 0; i < 5; i += 1) await jest.advanceTimersByTimeAsync(0);
};

export function useClientFakeTimers() {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate'] });
}
