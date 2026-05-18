/**
 * Serializes async work per logical conversation so messages for the same thread
 * never run in parallel, while different threads can run concurrently (Worker concurrency > 1).
 *
 * The map is in-memory per process. For strict ordering with multiple worker *processes*
 * (e.g. two `npm run worker:whatsapp` instances), the same `orderKey` can still run in
 * parallel on different machines; run a single worker replica, or add a distributed lock later.
 */
const tails = new Map<string, Promise<unknown>>();

export function buildWhatsAppOrderKey(businessId: string, conversationId: string): string {
  const q = String(conversationId).replace(/:/g, '_');
  return `${businessId}:${q}`;
}

/**
 * Chain fn's for the same orderKey: each call waits for the previous to settle (success or failure).
 */
export function withConversationOrder<T>(orderKey: string, fn: () => Promise<T>): Promise<T> {
  const prev = tails.get(orderKey) ?? Promise.resolve();
  const current = prev.then(
    () => fn(),
    () => fn()
  );
  tails.set(orderKey, current.then(() => {}).catch(() => {}));
  return current;
}
