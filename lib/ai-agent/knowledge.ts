import { query, queryOne, queryRows } from '@/lib/db';
import { noteAgentKnowledgeChanged } from '@/lib/rag/tenant-reindex';

export type KnowledgeKind = 'faq' | 'text' | 'file';
export type KnowledgeStatus = 'active' | 'draft';

export interface KnowledgeItem {
  id: string;
  kind: KnowledgeKind;
  title: string;
  question: string;
  answer: string;
  /** Pasted text, or text extracted from an upload. Lists return a short preview. */
  content: string;
  fileName: string | null;
  fileSize: number | null;
  status: KnowledgeStatus;
  createdAt: string;
  updatedAt: string;
}

export const KNOWLEDGE_LIMITS = {
  maxItems: 200,
  titleMax: 200,
  questionMax: 300,
  answerMax: 2000,
  textMax: 60_000,
  previewChars: 280,
} as const;

interface Row {
  id: string;
  kind: KnowledgeKind;
  title: string | null;
  question: string | null;
  answer: string | null;
  content: string | null;
  file_name: string | null;
  file_size: number | null;
  status: KnowledgeStatus;
  created_at: Date;
  updated_at: Date;
}

function toItem(r: Row, full: boolean): KnowledgeItem {
  const content = r.content ?? '';
  return {
    id: r.id,
    kind: r.kind,
    title: r.title ?? '',
    question: r.question ?? '',
    answer: r.answer ?? '',
    content: full ? content : content.slice(0, KNOWLEDGE_LIMITS.previewChars),
    fileName: r.file_name,
    fileSize: r.file_size,
    status: r.status,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

const COLS = 'id, kind, title, question, answer, content, file_name, file_size, status, created_at, updated_at';

export async function listKnowledge(businessId: string): Promise<KnowledgeItem[]> {
  const rows = await queryRows<Row>(
    `SELECT ${COLS} FROM ai_agent_knowledge WHERE business_id = $1 ORDER BY kind, created_at DESC`,
    [businessId],
  );
  return rows.map((r) => toItem(r, false));
}

export async function getKnowledge(businessId: string, id: string): Promise<KnowledgeItem | null> {
  const row = await queryOne<Row>(
    `SELECT ${COLS} FROM ai_agent_knowledge WHERE business_id = $1 AND id = $2`,
    [businessId, id],
  );
  return row ? toItem(row, true) : null;
}

export async function countKnowledge(businessId: string): Promise<number> {
  const row = await queryOne<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM ai_agent_knowledge WHERE business_id = $1`,
    [businessId],
  );
  return row?.n ?? 0;
}

export interface KnowledgeInput {
  kind: KnowledgeKind;
  title?: string;
  question?: string;
  answer?: string;
  content?: string;
  fileName?: string | null;
  fileSize?: number | null;
  status?: KnowledgeStatus;
}

const clip = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Returns an error message, or null when the input is usable. */
export function validateKnowledge(input: KnowledgeInput): string | null {
  if (!['faq', 'text', 'file'].includes(input.kind)) return 'Unknown knowledge type';
  if (input.kind === 'faq') {
    if (!clip(input.question, KNOWLEDGE_LIMITS.questionMax)) return 'Enter the question';
    if (!clip(input.answer, KNOWLEDGE_LIMITS.answerMax)) return 'Enter the answer';
    return null;
  }
  if (!clip(input.content, KNOWLEDGE_LIMITS.textMax)) return 'Add some text';
  return null;
}

export function parseKnowledgeInput(body: Record<string, unknown>, fallbackKind?: KnowledgeKind): KnowledgeInput {
  const kind = (['faq', 'text', 'file'].includes(String(body.kind)) ? body.kind : fallbackKind) as KnowledgeKind;
  return {
    kind,
    title: clip(body.title, KNOWLEDGE_LIMITS.titleMax),
    question: clip(body.question, KNOWLEDGE_LIMITS.questionMax),
    answer: clip(body.answer, KNOWLEDGE_LIMITS.answerMax),
    content: clip(body.content, KNOWLEDGE_LIMITS.textMax),
    status: body.status === 'draft' ? 'draft' : 'active',
  };
}

export async function createKnowledge(
  businessId: string,
  input: KnowledgeInput,
  userId: string | null,
): Promise<KnowledgeItem> {
  const row = await queryOne<Row>(
    `INSERT INTO ai_agent_knowledge
       (business_id, kind, title, question, answer, content, file_name, file_size, status, created_by)
     VALUES ($1, $2, NULLIF($3, ''), NULLIF($4, ''), NULLIF($5, ''), NULLIF($6, ''), $7, $8, $9, $10)
     RETURNING ${COLS}`,
    [
      businessId,
      input.kind,
      input.title ?? '',
      input.question ?? '',
      input.answer ?? '',
      input.content ?? '',
      input.fileName ?? null,
      input.fileSize ?? null,
      input.status ?? 'active',
      userId,
    ],
  );
  noteAgentKnowledgeChanged(businessId, 'ai_agent_knowledge');
  return toItem(row!, true);
}

export async function updateKnowledge(
  businessId: string,
  id: string,
  patch: Partial<Pick<KnowledgeInput, 'title' | 'question' | 'answer' | 'content' | 'status'>>,
): Promise<KnowledgeItem | null> {
  const row = await queryOne<Row>(
    `UPDATE ai_agent_knowledge SET
        title = COALESCE($3, title),
        question = COALESCE($4, question),
        answer = COALESCE($5, answer),
        content = COALESCE($6, content),
        status = COALESCE($7, status),
        updated_at = NOW()
      WHERE business_id = $1 AND id = $2
      RETURNING ${COLS}`,
    [
      businessId,
      id,
      patch.title ?? null,
      patch.question ?? null,
      patch.answer ?? null,
      patch.content ?? null,
      patch.status ?? null,
    ],
  );
  if (row) noteAgentKnowledgeChanged(businessId, 'ai_agent_knowledge');
  return row ? toItem(row, true) : null;
}

export async function deleteKnowledge(businessId: string, id: string): Promise<boolean> {
  const res = await query(`DELETE FROM ai_agent_knowledge WHERE business_id = $1 AND id = $2`, [businessId, id]);
  const ok = (res.rowCount ?? 0) > 0;
  if (ok) noteAgentKnowledgeChanged(businessId, 'ai_agent_knowledge');
  return ok;
}

const STOP = new Set([
  'a', 'an', 'the', 'is', 'are', 'do', 'does', 'you', 'your', 'i', 'me', 'my', 'we', 'to', 'of', 'in', 'on', 'for',
  'and', 'or', 'it', 'can', 'what', 'how', 'when', 'where', 'which', 'who', 'have', 'has', 'be', 'with', 'at', 'this',
  'that', 'there', 'any', 'please', 'hi', 'hello', 'kya', 'hai', 'ka', 'ki', 'ke', 'aap',
]);

function terms(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\u0900-\u097f\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

export interface FaqMatch {
  question: string;
  answer: string;
  score: number;
}

/**
 * Owner FAQs that look like the customer's question, best first. Read straight from the table so
 * a new FAQ works in the test chat before the knowledge index catches up.
 */
export async function matchFaqs(businessId: string, message: string, limit = 3): Promise<FaqMatch[]> {
  const asked = new Set(terms(message));
  if (!asked.size) return [];
  const rows = await queryRows<{ question: string; answer: string }>(
    `SELECT question, answer FROM ai_agent_knowledge
      WHERE business_id = $1 AND kind = 'faq' AND status = 'active'
        AND question IS NOT NULL AND answer IS NOT NULL
      LIMIT ${KNOWLEDGE_LIMITS.maxItems}`,
    [businessId],
  ).catch(() => []);
  return rows
    .map((r) => {
      const q = terms(r.question);
      if (!q.length) return { ...r, score: 0 };
      const hits = q.filter((t) => asked.has(t)).length;
      return { ...r, score: hits / q.length };
    })
    .filter((r) => r.score >= 0.34)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
