import { EMBEDDING_DIMENSIONS, ragConfig } from './config';

export type EmbedTask = 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const BATCH_SIZE = 100;
const MAX_ATTEMPTS = 4;
/** Indexing can wait out a per-minute quota; a live question must not, it falls back to keyword search. */
const MAX_ATTEMPTS_INDEXING = 6;
const MAX_RATE_LIMIT_WAIT_MS = 65_000;

/** Carries the vectors finished before the failure so the indexer can keep them instead of re-spending quota. */
export class EmbeddingError extends Error {
  constructor(
    message: string,
    readonly partial: number[][],
    readonly dailyQuota: boolean,
  ) {
    super(message);
    this.name = 'EmbeddingError';
  }
}

type RateLimitInfo = { retryAfterMs: number | null; daily: boolean };

/** Gemini 429 bodies carry google.rpc.RetryInfo (retryDelay "37s") and QuotaFailure (quotaId ...PerDay...). */
export function parseRateLimit(body: string): RateLimitInfo {
  let retryAfterMs: number | null = null;
  let daily = false;
  try {
    const details = (JSON.parse(body)?.error?.details ?? []) as Array<Record<string, unknown>>;
    for (const d of details) {
      const type = String(d['@type'] ?? '');
      if (type.endsWith('RetryInfo') && typeof d.retryDelay === 'string') {
        const secs = parseFloat(d.retryDelay);
        if (Number.isFinite(secs)) retryAfterMs = Math.ceil(secs * 1000);
      }
      if (type.endsWith('QuotaFailure') && Array.isArray(d.violations)) {
        daily ||= d.violations.some((v: { quotaId?: string }) => /PerDay/i.test(v?.quotaId ?? ''));
      }
    }
  } catch {
    daily = /PerDay/i.test(body);
  }
  return { retryAfterMs, daily };
}

export function embeddingsConfigured(): boolean {
  return Boolean(ragConfig().geminiKey);
}

export function embeddingModelName(): string {
  return ragConfig().embedModel;
}

/** gemini-embedding-001 only normalizes its full 3072-d output; truncated vectors must be re-normalized for cosine. */
export function normalizeVector(values: number[]): number[] {
  let sum = 0;
  for (const v of values) sum += v * v;
  const norm = Math.sqrt(sum);
  if (!norm) return values;
  return values.map((v) => v / norm);
}

export function toVectorLiteral(values: number[]): string {
  return `[${values.map((v) => (Number.isFinite(v) ? v.toFixed(7) : '0')).join(',')}]`;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function embedBatch(texts: string[], task: EmbedTask, titles?: Array<string | undefined>): Promise<number[][]> {
  const cfg = ragConfig();
  const model = cfg.embedModel;
  const body = {
    requests: texts.map((text, i) => ({
      model: `models/${model}`,
      content: { parts: [{ text }] },
      taskType: task,
      outputDimensionality: EMBEDDING_DIMENSIONS,
      ...(task === 'RETRIEVAL_DOCUMENT' && titles?.[i] ? { title: titles[i] } : {}),
    })),
  };

  const indexing = task === 'RETRIEVAL_DOCUMENT';
  const maxAttempts = indexing ? MAX_ATTEMPTS_INDEXING : MAX_ATTEMPTS;
  let lastError = '';
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await fetch(`${GEMINI_BASE}/${model}:batchEmbedContents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cfg.geminiKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    if (res.ok) {
      const data = (await res.json()) as { embeddings?: Array<{ values?: number[] }> };
      const out = (data.embeddings || []).map((e) => normalizeVector(e.values || []));
      if (out.length !== texts.length || out.some((v) => v.length !== EMBEDDING_DIMENSIONS)) {
        throw new Error(`Gemini returned ${out.length} embeddings for ${texts.length} inputs`);
      }
      return out;
    }
    const text = await res.text();
    lastError = `${res.status}: ${text.slice(0, 300)}`;
    if (res.status !== 429 && res.status < 500) break;
    if (attempt === maxAttempts) break;
    const backoff = 1000 * 2 ** (attempt - 1);
    if (res.status === 429) {
      const limit = parseRateLimit(text);
      if (limit.daily) {
        throw new EmbeddingError('Gemini daily embedding quota reached; run the re-index again after the quota resets', [], true);
      }
      await sleep(indexing ? Math.min(Math.max(limit.retryAfterMs ?? 0, backoff), MAX_RATE_LIMIT_WAIT_MS) : backoff);
    } else {
      await sleep(backoff);
    }
  }
  throw new EmbeddingError(`Gemini embeddings failed ${lastError}`, [], false);
}

export async function embedTexts(
  texts: string[],
  task: EmbedTask,
  titles?: Array<string | undefined>,
): Promise<number[][]> {
  if (!embeddingsConfigured()) throw new Error('GEMINI_API_KEY is not configured');
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const slice = texts.slice(i, i + BATCH_SIZE);
    const titleSlice = titles?.slice(i, i + BATCH_SIZE);
    try {
      out.push(...(await embedBatch(slice, task, titleSlice)));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new EmbeddingError(message, out, err instanceof EmbeddingError && err.dailyQuota);
    }
  }
  return out;
}

export async function embedQuery(text: string): Promise<number[]> {
  const [v] = await embedTexts([text], 'RETRIEVAL_QUERY');
  return v;
}
