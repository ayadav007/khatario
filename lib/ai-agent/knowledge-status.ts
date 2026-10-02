import { queryRows } from '@/lib/db';

export const TENANT_KB_KINDS = ['tenant_catalog', 'tenant_policy', 'tenant_faq', 'tenant_text', 'tenant_file'] as const;

export interface KnowledgeSourceStatus {
  id: string;
  kind: string;
  locator: string;
  status: 'pending' | 'ok' | 'error' | 'deleted';
  error: string | null;
  chunkCount: number;
  documentCount: number;
  lastIndexedAt: string | null;
}

export async function listKnowledgeSources(businessId: string): Promise<KnowledgeSourceStatus[]> {
  const rows = await queryRows<{
    id: string;
    kind: string;
    locator: string;
    status: KnowledgeSourceStatus['status'];
    error: string | null;
    chunk_count: number;
    doc_count: string;
    last_indexed_at: Date | null;
  }>(
    `SELECT s.id, s.kind, s.locator, s.status, s.error, s.chunk_count, s.last_indexed_at,
            (SELECT COUNT(*) FROM kb_documents d WHERE d.source_id = s.id AND d.is_active) AS doc_count
       FROM kb_sources s
      WHERE s.business_id = $1 AND s.kind = ANY($2::text[]) AND s.status <> 'deleted'
      ORDER BY s.kind, s.locator`,
    [businessId, TENANT_KB_KINDS as unknown as string[]],
  ).catch(() => []);
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    locator: r.locator,
    status: r.status,
    error: r.error,
    chunkCount: Number(r.chunk_count) || 0,
    documentCount: Number(r.doc_count) || 0,
    lastIndexedAt: r.last_indexed_at ? new Date(r.last_indexed_at).toISOString() : null,
  }));
}

export async function knowledgeReady(businessId: string): Promise<boolean> {
  const sources = await listKnowledgeSources(businessId);
  return sources.some((s) => s.status === 'ok' && s.chunkCount > 0);
}
