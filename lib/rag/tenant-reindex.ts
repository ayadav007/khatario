import { queryOne } from '@/lib/db';
import { scheduleTenantReindex } from './queue';
import { TENANT_SOURCE_KINDS } from './types';

const CACHE_MS = 5 * 60_000;
const indexedCache = new Map<string, { at: number; indexed: boolean }>();

export async function tenantKnowledgeIndexed(businessId: string): Promise<boolean> {
  const hit = indexedCache.get(businessId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.indexed;
  const row = await queryOne<{ ok: number }>(
    `SELECT 1 AS ok FROM kb_sources WHERE business_id = $1 AND kind = ANY($2::text[]) LIMIT 1`,
    [businessId, [...TENANT_SOURCE_KINDS]],
  ).catch(() => null);
  const indexed = Boolean(row);
  indexedCache.set(businessId, { at: Date.now(), indexed });
  return indexed;
}

/** First customer message on WhatsApp: build the shop's knowledge (debounced, background). */
export function bootstrapTenantKnowledge(businessId: string): void {
  indexedCache.set(businessId, { at: Date.now(), indexed: true });
  scheduleTenantReindex(businessId, 'customer bot first use');
}

/**
 * Call after an item or store-settings save. Only shops whose customer bot has been used (their
 * knowledge exists) are re-indexed; others are built on the first customer message. Never throws.
 */
export function noteShopChanged(businessId: string | null | undefined, reason: string): void {
  if (!businessId) return;
  void tenantKnowledgeIndexed(businessId)
    .then((indexed) => {
      if (indexed) scheduleTenantReindex(businessId, reason);
    })
    .catch(() => undefined);
}

/**
 * The owner added or edited agent knowledge (FAQ, text, file): always rebuild, even before the
 * first customer message, so the test chat can use it straight away.
 */
export function noteAgentKnowledgeChanged(businessId: string, reason: string): void {
  if (!businessId) return;
  indexedCache.set(businessId, { at: Date.now(), indexed: true });
  scheduleTenantReindex(businessId, reason);
}
