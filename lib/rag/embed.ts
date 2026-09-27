import { EMBEDDING_DIMENSIONS, ragConfig } from './config';

export type EmbedTask = 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const BATCH_SIZE = 100;
const MAX_ATTEMPTS = 4;

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

  let lastError = '';
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
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
    lastError = `${res.status}: ${(await res.text()).slice(0, 300)}`;
    if (res.status !== 429 && res.status < 500) break;
    await sleep(1000 * 2 ** (attempt - 1));
  }
  throw new Error(`Gemini embeddings failed ${lastError}`);
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
    out.push(...(await embedBatch(slice, task, titleSlice)));
  }
  return out;
}

export async function embedQuery(text: string): Promise<number[]> {
  const [v] = await embedTexts([text], 'RETRIEVAL_QUERY');
  return v;
}
