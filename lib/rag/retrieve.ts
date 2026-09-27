import { queryRows } from '@/lib/db';
import { ragConfig } from './config';
import { embedQuery, embeddingsConfigured, toVectorLiteral } from './embed';
import { expandQuery, type TermGroup } from './glossary';
import { normalizeText, tsToken } from './text';
import { hasVectorColumn } from './vector-support';
import { AUDIENCES, type RetrievalScope, type RetrievedChunk } from './types';

const RRF_K = 60;
/**
 * Lexical rerank weight. One RRF rank step is ~1/61, so this lets a chunk that covers all of the
 * user's terms beat one that merely repeats a single common word ("bill") many times.
 */
const COVERAGE_BOOST = 0.03;

export interface RetrieveInput {
  scope: RetrievalScope;
  /** Standalone English query (from the rewrite step, or the raw message). */
  searchQuery: string;
  /** The user's own words, used for keyword match so Hinglish terms still hit. */
  originalQuery?: string;
  topK?: number;
}

export interface RetrieveResult {
  chunks: RetrievedChunk[];
  confident: boolean;
  diagnostics: {
    usedVector: boolean;
    topVectorSimilarity: number | null;
    termCoverage: number;
    candidates: { vector: number; fulltext: number; trigram: number };
    terms: string[];
  };
}

type CandidateRow = {
  id: string;
  document_id: string;
  title: string;
  url: string | null;
  heading_path: string;
  content: string;
  score: number;
};

/** Tenant isolation is enforced here, in SQL parameters, never in the prompt. */
export function scopeFilter(scope: RetrievalScope, startIndex: number): { sql: string; params: unknown[] } {
  if (!(AUDIENCES as readonly string[]).includes(scope.audience)) {
    throw new Error(`Invalid audience: ${scope.audience}`);
  }
  if (scope.audience === 'tenant_customer') {
    if (!scope.businessId) throw new Error('tenant_customer retrieval requires a businessId');
    return {
      sql: `c.audiences @> ARRAY[$${startIndex}]::text[] AND c.business_id = $${startIndex + 1}::uuid`,
      params: [scope.audience, scope.businessId],
    };
  }
  if (scope.businessId) throw new Error(`${scope.audience} retrieval must not carry a businessId`);
  return {
    sql: `c.audiences @> ARRAY[$${startIndex}]::text[] AND c.business_id IS NULL`,
    params: [scope.audience],
  };
}

const BASE_SELECT = `
  SELECT c.id, c.document_id, d.title, d.url, c.heading_path, c.content`;
const BASE_FROM = `
  FROM kb_chunks c
  JOIN kb_documents d ON d.id = c.document_id AND d.is_active = true
  JOIN kb_sources s ON s.id = d.source_id AND s.status <> 'deleted'`;

export function buildTsQuery(groups: TermGroup[]): string | null {
  const parts = new Set<string>();
  for (const g of groups) {
    for (const alt of g.alternatives) {
      const t = tsToken(alt);
      if (t) parts.add(t.length >= 4 ? `${t}:*` : t);
    }
  }
  return parts.size ? Array.from(parts).join(' | ') : null;
}

async function vectorCandidates(scope: RetrievalScope, query: string, limit: number) {
  const vector = toVectorLiteral(await embedQuery(query));
  const f = scopeFilter(scope, 3);
  return queryRows<CandidateRow>(
    `${BASE_SELECT}, 1 - (c.embedding <=> $1::vector) AS score
     ${BASE_FROM}
     WHERE c.embedding IS NOT NULL AND ${f.sql}
     ORDER BY c.embedding <=> $1::vector
     LIMIT $2`,
    [vector, limit, ...f.params],
  );
}

async function fulltextCandidates(scope: RetrievalScope, tsquery: string, limit: number) {
  const f = scopeFilter(scope, 3);
  return queryRows<CandidateRow>(
    `${BASE_SELECT}, ts_rank_cd(c.tsv, q, 32) AS score
     ${BASE_FROM}, to_tsquery('simple', $1) q
     WHERE c.tsv @@ q AND ${f.sql}
     ORDER BY score DESC
     LIMIT $2`,
    [tsquery, limit, ...f.params],
  );
}

async function trigramCandidates(scope: RetrievalScope, text: string, limit: number) {
  const f = scopeFilter(scope, 3);
  return queryRows<CandidateRow>(
    `${BASE_SELECT}, word_similarity($1, c.content) AS score
     ${BASE_FROM}
     WHERE $1 <% c.content AND ${f.sql}
     ORDER BY score DESC
     LIMIT $2`,
    [text, limit, ...f.params],
  );
}

/** Share of the user's terms (any alternative) that appear in the text. */
export function termCoverage(groups: TermGroup[], text: string): number {
  if (!groups.length) return 0;
  const haystack = ` ${normalizeText(text)} `;
  let hit = 0;
  for (const g of groups) {
    const variants = g.alternatives.flatMap((alt) => (alt.length > 4 && alt.endsWith('s') ? [alt, alt.slice(0, -1)] : [alt]));
    if (variants.some((alt) => haystack.includes(` ${alt}`))) hit++;
  }
  return hit / groups.length;
}

export function reciprocalRankFusion(lists: Array<{ name: 'vector' | 'text' | 'trigram'; rows: CandidateRow[] }>) {
  const fused = new Map<string, { row: CandidateRow; score: number; vectorRank: number | null; textRank: number | null; vectorSimilarity: number | null }>();
  for (const list of lists) {
    list.rows.forEach((row, index) => {
      const entry = fused.get(row.id) ?? { row, score: 0, vectorRank: null, textRank: null, vectorSimilarity: null };
      entry.score += 1 / (RRF_K + index + 1);
      if (list.name === 'vector') {
        entry.vectorRank = index + 1;
        entry.vectorSimilarity = Number(row.score);
      } else if (list.name === 'text' && entry.textRank == null) {
        entry.textRank = index + 1;
      }
      fused.set(row.id, entry);
    });
  }
  return Array.from(fused.values()).sort((a, b) => b.score - a.score);
}

export async function retrieve(input: RetrieveInput): Promise<RetrieveResult> {
  // Throws on a bad scope here, so the vector branch's error fallback can't mask it.
  scopeFilter(input.scope, 1);
  const cfg = ragConfig();
  const topK = input.topK ?? cfg.topK;
  const limit = cfg.candidatesPerMethod;
  const keywordSource = [input.originalQuery, input.searchQuery].filter(Boolean).join(' ');
  const groups = expandQuery(input.originalQuery || input.searchQuery);
  const allGroups = expandQuery(keywordSource);
  const tsquery = buildTsQuery(allGroups);

  const useVector = embeddingsConfigured() && (await hasVectorColumn());
  const [vectorRows, textRows, trigramRows] = await Promise.all([
    useVector
      ? vectorCandidates(input.scope, input.searchQuery, limit).catch((err) => {
          console.warn('[rag] vector search failed, continuing with keyword search:', err instanceof Error ? err.message : err);
          return [] as CandidateRow[];
        })
      : Promise.resolve([] as CandidateRow[]),
    tsquery ? fulltextCandidates(input.scope, tsquery, limit) : Promise.resolve([] as CandidateRow[]),
    normalizeText(keywordSource).length >= 4
      ? trigramCandidates(input.scope, normalizeText(keywordSource).slice(0, 200), Math.ceil(limit / 2))
      : Promise.resolve([] as CandidateRow[]),
  ]);

  const coverageGroups = groups.length ? groups : allGroups;
  const fused = reciprocalRankFusion([
    { name: 'vector', rows: vectorRows },
    { name: 'text', rows: textRows },
    { name: 'trigram', rows: trigramRows },
  ])
    .map((f) => ({
      ...f,
      score: f.score + COVERAGE_BOOST * termCoverage(coverageGroups, `${f.row.title} ${f.row.heading_path} ${f.row.content}`),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  const chunks: RetrievedChunk[] = fused.map((f) => ({
    id: f.row.id,
    documentId: f.row.document_id,
    title: f.row.title,
    url: f.row.url,
    headingPath: f.row.heading_path,
    content: f.row.content,
    score: f.score,
    vectorRank: f.vectorRank,
    textRank: f.textRank,
    vectorSimilarity: f.vectorSimilarity,
  }));

  const topVectorSimilarity = vectorRows.length ? Number(vectorRows[0].score) : null;
  const rewrittenGroups =
    input.originalQuery && input.searchQuery !== input.originalQuery ? expandQuery(input.searchQuery) : [];
  const coverage = chunks.slice(0, 3).reduce((best, c) => {
    const text = `${c.title} ${c.headingPath} ${c.content}`;
    return Math.max(best, termCoverage(groups, text), termCoverage(rewrittenGroups, text));
  }, 0);
  const confident =
    chunks.length > 0 &&
    ((topVectorSimilarity != null && topVectorSimilarity >= cfg.minVectorSimilarity) ||
      ((groups.length > 0 || rewrittenGroups.length > 0) && coverage >= cfg.minTermCoverage));

  return {
    chunks,
    confident,
    diagnostics: {
      usedVector: useVector,
      topVectorSimilarity,
      termCoverage: Number(coverage.toFixed(3)),
      candidates: { vector: vectorRows.length, fulltext: textRows.length, trigram: trigramRows.length },
      terms: groups.map((g) => g.term),
    },
  };
}
