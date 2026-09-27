import type { PoolClient } from 'pg';
import { getPool, query, queryOne, queryRows } from '@/lib/db';
import { embedTexts, embeddingModelName, embeddingsConfigured, toVectorLiteral } from '../embed';
import { hasVectorColumn } from '../vector-support';
import type { ChunkDraft, KbDocumentInput, KbSourceInput, SourceKind } from '../types';
import { chunkMarkdown } from './chunk';
import { combineHashes, contentHash } from './hash';

export interface IndexOptions {
  force?: boolean;
  dryRun?: boolean;
}

export interface SourceIndexResult {
  kind: SourceKind;
  locator: string;
  status: 'skipped' | 'indexed' | 'error' | 'dry_run';
  documents: number;
  chunks: number;
  embedded: number;
  reusedEmbeddings: number;
  error?: string;
}

type PreparedChunk = ChunkDraft & { hash: string; embedText: string };
type PreparedDoc = { input: KbDocumentInput; hash: string; chunks: PreparedChunk[] };

function prepareDocument(doc: KbDocumentInput): PreparedDoc {
  const chunks = chunkMarkdown(doc.body).map((c) => {
    const embedText = [doc.title, c.headingPath, c.content].filter(Boolean).join('\n');
    return { ...c, hash: contentHash(embedText), embedText };
  });
  const hash = combineHashes([
    contentHash(doc.body),
    doc.title,
    doc.url ?? '',
    doc.audiences.join(','),
    doc.locale,
    doc.tags.join(','),
    doc.requiredFeature ?? '',
  ]);
  return { input: doc, hash, chunks };
}

async function upsertSource(input: KbSourceInput): Promise<{ id: string; content_hash: string | null; status: string }> {
  const row = await queryOne<{ id: string; content_hash: string | null; status: string }>(
    `INSERT INTO kb_sources (kind, locator, audiences, business_id, status)
     VALUES ($1, $2, $3::text[], $4, 'pending')
     ON CONFLICT (kind, locator, COALESCE(business_id, '00000000-0000-0000-0000-000000000000'::uuid))
     DO UPDATE SET audiences = EXCLUDED.audiences, updated_at = NOW()
     RETURNING id, content_hash, status`,
    [input.kind, input.locator, input.audiences, input.businessId ?? null],
  );
  return row!;
}

async function existingEmbeddings(hashes: string[], model: string): Promise<Map<string, string>> {
  if (!hashes.length) return new Map();
  const rows = await queryRows<{ content_hash: string; embedding: string }>(
    `SELECT DISTINCT ON (content_hash) content_hash, embedding::text AS embedding
       FROM kb_chunks
      WHERE content_hash = ANY($1::text[]) AND embedding IS NOT NULL AND embedding_model = $2`,
    [hashes, model],
  );
  return new Map(rows.map((r) => [r.content_hash, r.embedding]));
}

async function writeDocument(
  client: PoolClient,
  sourceId: string,
  businessId: string | null,
  doc: PreparedDoc,
  vectors: Map<string, string>,
  withVector: boolean,
  model: string | null,
): Promise<void> {
  const d = doc.input;
  const docRow = await client.query<{ id: string }>(
    `INSERT INTO kb_documents (source_id, doc_key, title, url, audiences, business_id, locale, tags, required_feature, content_hash, is_active)
     VALUES ($1, $2, $3, $4, $5::text[], $6, $7, $8::text[], $9, $10, true)
     ON CONFLICT (source_id, doc_key) DO UPDATE SET
       title = EXCLUDED.title, url = EXCLUDED.url, audiences = EXCLUDED.audiences,
       locale = EXCLUDED.locale, tags = EXCLUDED.tags, required_feature = EXCLUDED.required_feature,
       content_hash = EXCLUDED.content_hash, is_active = true, updated_at = NOW()
     RETURNING id`,
    [sourceId, d.docKey, d.title, d.url ?? null, d.audiences, businessId, d.locale, d.tags, d.requiredFeature ?? null, doc.hash],
  );
  const documentId = docRow.rows[0].id;
  await client.query('DELETE FROM kb_chunks WHERE document_id = $1', [documentId]);

  for (const c of doc.chunks) {
    const vector = vectors.get(c.hash) ?? null;
    if (withVector) {
      await client.query(
        `INSERT INTO kb_chunks (document_id, ordinal, heading_path, content, content_hash, token_estimate, audiences, business_id, locale, embedding_model, embedding)
         VALUES ($1, $2, $3, $4, $5, $6, $7::text[], $8, $9, $10, $11::vector)`,
        [documentId, c.ordinal, c.headingPath, c.content, c.hash, c.tokenEstimate, d.audiences, businessId, d.locale, vector ? model : null, vector],
      );
    } else {
      await client.query(
        `INSERT INTO kb_chunks (document_id, ordinal, heading_path, content, content_hash, token_estimate, audiences, business_id, locale)
         VALUES ($1, $2, $3, $4, $5, $6, $7::text[], $8, $9)`,
        [documentId, c.ordinal, c.headingPath, c.content, c.hash, c.tokenEstimate, d.audiences, businessId, d.locale],
      );
    }
  }
}

/**
 * Index one source: skip when nothing changed, reuse embeddings by content hash, and swap
 * chunks inside a transaction so a failure leaves the previous chunks serving answers.
 */
export async function indexSource(input: KbSourceInput, options: IndexOptions = {}): Promise<SourceIndexResult> {
  const base: SourceIndexResult = {
    kind: input.kind,
    locator: input.locator,
    status: 'skipped',
    documents: input.documents.length,
    chunks: 0,
    embedded: 0,
    reusedEmbeddings: 0,
  };

  const prepared = input.documents.map(prepareDocument);
  base.chunks = prepared.reduce((n, d) => n + d.chunks.length, 0);

  const withVector = (await hasVectorColumn()) && embeddingsConfigured();
  const model = withVector ? embeddingModelName() : null;
  const sourceHash = combineHashes([...prepared.map((d) => d.hash), model ?? 'no-vector']);

  if (options.dryRun) return { ...base, status: 'dry_run' };

  const source = await upsertSource(input);
  if (!options.force && source.status === 'ok' && source.content_hash === sourceHash) {
    return base;
  }

  try {
    const vectors = new Map<string, string>();
    if (withVector && model) {
      const allHashes = Array.from(new Set(prepared.flatMap((d) => d.chunks.map((c) => c.hash))));
      const reused = await existingEmbeddings(allHashes, model);
      reused.forEach((v, k) => vectors.set(k, v));
      base.reusedEmbeddings = reused.size;

      const missing = new Map<string, { text: string; title: string }>();
      for (const d of prepared) {
        for (const c of d.chunks) {
          if (!vectors.has(c.hash) && !missing.has(c.hash)) missing.set(c.hash, { text: c.embedText, title: d.input.title });
        }
      }
      if (missing.size) {
        const entries = Array.from(missing.entries());
        const embeddings = await embedTexts(
          entries.map(([, v]) => v.text),
          'RETRIEVAL_DOCUMENT',
          entries.map(([, v]) => v.title),
        );
        entries.forEach(([hash], i) => vectors.set(hash, toVectorLiteral(embeddings[i])));
        base.embedded = entries.length;
      }
    }

    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      for (const doc of prepared) {
        await writeDocument(client, source.id, input.businessId ?? null, doc, vectors, withVector, model);
      }
      await client.query(
        `DELETE FROM kb_documents WHERE source_id = $1 AND NOT (doc_key = ANY($2::text[]))`,
        [source.id, prepared.map((d) => d.input.docKey)],
      );
      await client.query(
        `UPDATE kb_sources SET status = 'ok', error = NULL, content_hash = $2, chunk_count = $3,
                last_indexed_at = NOW(), updated_at = NOW()
          WHERE id = $1`,
        [source.id, sourceHash, base.chunks],
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
    return { ...base, status: 'indexed' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await query(
      `UPDATE kb_sources SET status = 'error', error = $2, updated_at = NOW() WHERE id = $1`,
      [source.id, message.slice(0, 2000)],
    ).catch(() => undefined);
    return { ...base, status: 'error', error: message };
  }
}

/** Remove sources of a kind whose locator no longer exists (deleted markdown files, unpublished pages). */
export async function removeStaleSources(kind: SourceKind, liveLocators: string[], dryRun = false): Promise<string[]> {
  const stale = await queryRows<{ id: string; locator: string }>(
    `SELECT id, locator FROM kb_sources
      WHERE kind = $1 AND business_id IS NULL AND NOT (locator = ANY($2::text[]))`,
    [kind, liveLocators],
  );
  if (!dryRun && stale.length) {
    await query(`DELETE FROM kb_sources WHERE id = ANY($1::uuid[])`, [stale.map((s) => s.id)]);
  }
  return stale.map((s) => s.locator);
}
