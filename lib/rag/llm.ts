import { ragConfig } from './config';

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmUsage {
  model: string;
  tokensIn: number;
  tokensOut: number;
}

export type StreamEvent = { type: 'delta'; text: string } | { type: 'done'; usage: LlmUsage; text: string };

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function isReasoningModel(model: string): boolean {
  return model.startsWith('openai/gpt-oss');
}

function groqBody(model: string, messages: LlmMessage[], maxTokens: number, extra: Record<string, unknown> = {}) {
  return {
    model,
    messages,
    temperature: 0.3,
    max_completion_tokens: maxTokens,
    // gpt-oss reasons before answering; reasoning tokens count against max_completion_tokens.
    ...(isReasoningModel(model) ? { reasoning_effort: 'low', include_reasoning: false } : {}),
    ...extra,
  };
}

function toGeminiContents(messages: LlmMessage[]) {
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const contents = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
  return { system, contents };
}

async function groqJson(model: string, messages: LlmMessage[], maxTokens: number, timeoutMs: number) {
  const cfg = ragConfig();
  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.groqKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(groqBody(model, messages, maxTokens, { response_format: { type: 'json_object' }, temperature: 0 })),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`Groq ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  return {
    text: data.choices?.[0]?.message?.content ?? '',
    usage: { model, tokensIn: data.usage?.prompt_tokens ?? 0, tokensOut: data.usage?.completion_tokens ?? 0 },
  };
}

async function geminiJson(messages: LlmMessage[], maxTokens: number, timeoutMs: number) {
  const cfg = ragConfig();
  const { system, contents } = toGeminiContents(messages);
  const res = await fetch(`${GEMINI_BASE}/${cfg.geminiChatModel}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cfg.geminiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents,
      generationConfig: { temperature: 0, maxOutputTokens: maxTokens, responseMimeType: 'application/json' },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  };
  return {
    text: data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '',
    usage: {
      model: cfg.geminiChatModel,
      tokensIn: data.usageMetadata?.promptTokenCount ?? 0,
      tokensOut: data.usageMetadata?.candidatesTokenCount ?? 0,
    },
  };
}

function parseJsonLoose(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

/** JSON completion with Groq first, Gemini second. Returns null data when no provider answers. */
export async function completeJson(
  messages: LlmMessage[],
  opts: { model?: string; maxTokens?: number; timeoutMs?: number } = {},
): Promise<{ data: unknown; usage: LlmUsage | null }> {
  const cfg = ragConfig();
  const maxTokens = opts.maxTokens ?? 400;
  const timeoutMs = opts.timeoutMs ?? 8000;
  if (cfg.groqKey) {
    try {
      const r = await groqJson(opts.model ?? cfg.rewriteModel, messages, maxTokens, timeoutMs);
      const data = parseJsonLoose(r.text);
      if (data) return { data, usage: r.usage };
    } catch (err) {
      console.warn('[rag/llm] Groq JSON failed:', err instanceof Error ? err.message : err);
    }
  }
  if (cfg.geminiKey) {
    try {
      const r = await geminiJson(messages, maxTokens, timeoutMs);
      const data = parseJsonLoose(r.text);
      if (data) return { data, usage: r.usage };
    } catch (err) {
      console.warn('[rag/llm] Gemini JSON failed:', err instanceof Error ? err.message : err);
    }
  }
  return { data: null, usage: null };
}

async function* readSse(res: Response): AsyncGenerator<string> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (line.startsWith('data:')) yield line.slice(5).trim();
    }
  }
  if (buffer.trim().startsWith('data:')) yield buffer.trim().slice(5).trim();
}

async function* groqStream(messages: LlmMessage[], maxTokens: number, signal?: AbortSignal): AsyncGenerator<StreamEvent> {
  const cfg = ragConfig();
  const model = cfg.answerModel;
  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.groqKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...groqBody(model, messages, maxTokens), stream: true, stream_options: { include_usage: true } }),
    signal: signal ?? AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Groq ${res.status}: ${(await res.text()).slice(0, 200)}`);
  let text = '';
  let usage: LlmUsage = { model, tokensIn: 0, tokensOut: 0 };
  for await (const data of readSse(res)) {
    if (data === '[DONE]') break;
    let json: {
      choices?: Array<{ delta?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      x_groq?: { usage?: { prompt_tokens?: number; completion_tokens?: number } };
    };
    try {
      json = JSON.parse(data);
    } catch {
      continue;
    }
    const delta = json.choices?.[0]?.delta?.content;
    if (delta) {
      text += delta;
      yield { type: 'delta', text: delta };
    }
    const u = json.usage ?? json.x_groq?.usage;
    if (u) usage = { model, tokensIn: u.prompt_tokens ?? 0, tokensOut: u.completion_tokens ?? 0 };
  }
  if (!usage.tokensIn) {
    usage = { model, tokensIn: estimateTokens(messages.map((m) => m.content).join('\n')), tokensOut: estimateTokens(text) };
  }
  yield { type: 'done', usage, text };
}

async function* geminiStream(messages: LlmMessage[], maxTokens: number, signal?: AbortSignal): AsyncGenerator<StreamEvent> {
  const cfg = ragConfig();
  const { system, contents } = toGeminiContents(messages);
  const res = await fetch(`${GEMINI_BASE}/${cfg.geminiChatModel}:streamGenerateContent?alt=sse`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cfg.geminiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents,
      generationConfig: { temperature: 0.3, maxOutputTokens: maxTokens },
    }),
    signal: signal ?? AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
  let text = '';
  let usage: LlmUsage = { model: cfg.geminiChatModel, tokensIn: 0, tokensOut: 0 };
  for await (const data of readSse(res)) {
    let json: {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };
    try {
      json = JSON.parse(data);
    } catch {
      continue;
    }
    const delta = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('');
    if (delta) {
      text += delta;
      yield { type: 'delta', text: delta };
    }
    if (json.usageMetadata) {
      usage = {
        model: cfg.geminiChatModel,
        tokensIn: json.usageMetadata.promptTokenCount ?? 0,
        tokensOut: json.usageMetadata.candidatesTokenCount ?? 0,
      };
    }
  }
  yield { type: 'done', usage, text };
}

/**
 * Stream an answer from Groq, falling back to Gemini only if Groq fails before sending any text
 * (switching mid-answer would produce a stitched, contradictory reply).
 */
export async function* streamChat(
  messages: LlmMessage[],
  opts: { maxTokens?: number; signal?: AbortSignal } = {},
): AsyncGenerator<StreamEvent> {
  const cfg = ragConfig();
  const maxTokens = opts.maxTokens ?? 900;
  const providers: Array<() => AsyncGenerator<StreamEvent>> = [];
  if (cfg.groqKey) providers.push(() => groqStream(messages, maxTokens, opts.signal));
  if (cfg.geminiKey) providers.push(() => geminiStream(messages, maxTokens, opts.signal));
  if (!providers.length) throw new Error('KHATARIO_AI_UNAVAILABLE');

  let lastError: unknown = null;
  for (const provider of providers) {
    let sentAny = false;
    try {
      for await (const event of provider()) {
        if (event.type === 'delta') sentAny = true;
        if (event.type === 'done' && !event.text.trim()) throw new Error('empty completion');
        yield event;
      }
      return;
    } catch (err) {
      lastError = err;
      console.warn('[rag/llm] stream provider failed:', err instanceof Error ? err.message : err);
      if (sentAny) {
        yield { type: 'done', usage: { model: 'partial', tokensIn: 0, tokensOut: 0 }, text: '' };
        return;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error('KHATARIO_AI_FAILED');
}
