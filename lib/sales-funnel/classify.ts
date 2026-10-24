import type { FlowOption } from './definition';

export type ClassifyResult = { optionId: string | null; via: 'title' | 'number' | 'keyword' | 'ai' | 'none' };

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE0F}\u{20E3}]/gu, ' ')
    .replace(/[^\p{L}\p{N}\s/]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasWord(text: string, word: string): boolean {
  const w = norm(word);
  if (!w) return false;
  return ` ${text} `.includes(` ${w} `);
}

/** Deterministic matching first; returns none when nothing or more than one option matches. */
export function matchOption(text: string, options: FlowOption[]): ClassifyResult {
  const t = norm(text);
  if (!t || options.length === 0) return { optionId: null, via: 'none' };

  const byTitle = options.find((o) => norm(o.title) === t || norm(o.id) === t);
  if (byTitle) return { optionId: byTitle.id, via: 'title' };

  const num = t.match(/^(?:option\s*)?(\d{1,2})$/);
  if (num) {
    const idx = Number(num[1]) - 1;
    if (idx >= 0 && idx < options.length) return { optionId: options[idx].id, via: 'number' };
  }

  const hits = options.filter((o) => (o.keywords || []).some((k) => hasWord(t, k)) || hasWord(t, o.title));
  if (hits.length === 1) return { optionId: hits[0].id, via: 'keyword' };
  return { optionId: null, via: 'none' };
}

export function looksLikeQuestion(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (t.includes('?')) return true;
  return /^(what|how|why|when|where|which|who|can|does|do|is|are|price|cost|kya|kaise|kitna|kitne|kaun)\b/.test(t) || t.split(/\s+/).length >= 8;
}

/**
 * The AI only maps free text onto one of the step's option ids (or none); it never decides
 * transitions or pipeline changes itself.
 */
export async function classifyReply(text: string, options: FlowOption[], question: string): Promise<ClassifyResult> {
  const direct = matchOption(text, options);
  if (direct.optionId || options.length === 0) return direct;
  if (text.trim().length > 300) return { optionId: null, via: 'none' };
  try {
    const { completeJson } = await import('@/lib/rag/llm');
    const { data } = await completeJson(
      [
        {
          role: 'system',
          content:
            'You map a WhatsApp reply from an Indian business owner onto one option of a question. Replies may be in English, Hindi or Hinglish. ' +
            'If the reply clearly chooses one option, return its id. If it is a question, unrelated, or ambiguous, return null. ' +
            'Respond with JSON only: {"option": "<id or null>"}',
        },
        {
          role: 'user',
          content: JSON.stringify({
            question,
            options: options.map((o) => ({ id: o.id, title: o.title, description: o.description || undefined })),
            reply: text.trim(),
          }),
        },
      ],
      { maxTokens: 60, timeoutMs: 5000 },
    );
    const id = data && typeof data === 'object' ? (data as { option?: unknown }).option : null;
    if (typeof id === 'string' && options.some((o) => o.id === id)) return { optionId: id, via: 'ai' };
  } catch (err) {
    console.warn('[sales-funnel] classify failed', err instanceof Error ? err.message : err);
  }
  return { optionId: null, via: 'none' };
}
