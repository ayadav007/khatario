import { chatModelConfigured, ragConfig } from './config';
import {
  createConversation,
  findOwnedConversation,
  insertMessage,
  loadHistory,
  type ConversationOwner,
} from './conversations';
import { streamChat, type LlmUsage } from './llm';
import { buildAnswerMessages, citedIndexes } from './prompt';
import { retrieve, type RetrieveResult } from './retrieve';
import { detectIntentHeuristic, detectLanguageHeuristic, rewriteQuery, type RewriteResult } from './rewrite';
import { withinDailyBudget } from './settings';
import type { AssistantIntent, Citation, RetrievedChunk } from './types';

export type AssistantAction =
  | { type: 'book_demo' }
  | { type: 'start_trial'; url: string }
  | { type: 'recommend_plan' }
  | { type: 'talk_to_human' }
  | { type: 'upgrade'; url: string };

export type AnswerEvent =
  | { type: 'meta'; conversationId: string }
  | { type: 'delta'; text: string }
  | { type: 'action'; action: AssistantAction }
  | { type: 'citations'; citations: Citation[] }
  | { type: 'quick_replies'; replies: string[] }
  | { type: 'done'; messageId: string; answered: boolean }
  | { type: 'error'; message: string };

export interface AnswerInput extends ConversationOwner {
  message: string;
  conversationId?: string | null;
  pagePath?: string | null;
  signal?: AbortSignal;
}

type Lang = RewriteResult['language'];

const SALES_CHANNELS = new Set(['web', 'signup', 'whatsapp']);

function t(lang: Lang, en: string, hinglish: string): string {
  return lang === 'en' ? en : hinglish;
}

function cannedReply(intent: AssistantIntent, lang: Lang, sales: boolean): { text: string; action?: AssistantAction } | null {
  switch (intent) {
    case 'greeting':
      return {
        text: sales
          ? t(
              lang,
              "Hi! I'm the Khatario assistant. Ask me anything about GST billing, stock, WhatsApp reminders, pricing or the free trial.",
              'Namaste! Main Khatario assistant hoon. GST billing, stock, WhatsApp reminder, pricing ya free trial ke baare mein kuch bhi puchiye.',
            )
          : t(
              lang,
              "Hi! I'm the Khatario help assistant. Ask me how to do anything in Khatario.",
              'Namaste! Main Khatario help assistant hoon. Khatario mein kuch bhi kaise karna hai, puchiye.',
            ),
      };
    case 'book_demo':
      if (!sales) return null;
      return {
        text: t(
          lang,
          'Happy to set up a free live demo with the Khatario team. Pick a date and time below and verify your WhatsApp number.',
          'Zaroor! Khatario team ke saath free live demo book kar dete hain. Neeche date aur time chuniye aur apna WhatsApp number verify kijiye.',
        ),
        action: { type: 'book_demo' },
      };
    case 'talk_to_human':
      return {
        text: t(
          lang,
          'Sure, I can pass this to the Khatario team. Share your name and mobile number and someone will get back to you.',
          'Bilkul, main aapki baat Khatario team tak pahuncha deta hoon. Apna naam aur mobile number dijiye, team aapse sampark karegi.',
        ),
        action: { type: 'talk_to_human' },
      };
    case 'recommend_plan':
      if (!sales) return null;
      return {
        text: t(
          lang,
          "Let's find the right plan. Answer a few quick questions about your business and I'll suggest one.",
          'Sahi plan dhoondhte hain. Apne business ke baare mein kuch chhote sawaal ka jawab dijiye, main plan suggest karunga.',
        ),
        action: { type: 'recommend_plan' },
      };
    default:
      return null;
  }
}

function followUpAction(intent: AssistantIntent, sales: boolean): AssistantAction | null {
  if (sales) {
    if (intent === 'start_trial') return { type: 'start_trial', url: '/signup?src=assistant' };
    if (intent === 'pricing') return { type: 'recommend_plan' };
    return null;
  }
  if (intent === 'pricing' || intent === 'recommend_plan') return { type: 'upgrade', url: '/settings/subscription' };
  return null;
}

function quickRepliesFor(sales: boolean, lang: Lang): string[] {
  if (!sales) return [];
  return lang === 'en'
    ? ['How much does it cost?', 'Does it work offline?', 'Book a demo']
    : ['Kitne ka hai?', 'Bina internet chalega?', 'Demo book karna hai'];
}

function notSureReply(lang: Lang, sales: boolean): string {
  return sales
    ? t(
        lang,
        "I'm not sure about that one, and I'd rather not guess. The Khatario team can answer it on a quick call — want me to connect you or book a free demo?",
        'Iska pakka jawab mere paas nahi hai, aur main guess nahi karna chahta. Khatario team ek chhoti call par bata degi — kya main aapko team se connect karun ya free demo book karun?',
      )
    : t(
        lang,
        "I couldn't find that in the Khatario guides. I can pass your question to the Khatario support team.",
        'Yeh Khatario guides mein nahi mila. Main aapka sawaal Khatario support team tak pahuncha sakta hoon.',
      );
}

function extractiveAnswer(chunks: RetrievedChunk[], lang: Lang): string {
  const top = chunks[0];
  const body = top.content.replace(/\s+\n/g, '\n').trim();
  const excerpt = body.length > 700 ? `${body.slice(0, 700).replace(/\s+\S*$/, '')}…` : body;
  const lead = t(lang, "Here's what our guide says:", 'Hamari guide mein yeh likha hai:');
  return `${lead}\n\n${excerpt} [1]`;
}

function toCitations(chunks: RetrievedChunk[], indexes: number[]): Citation[] {
  const seen = new Set<string>();
  const out: Citation[] = [];
  for (const i of indexes) {
    const c = chunks[i - 1];
    if (!c) continue;
    const key = `${c.title}|${c.url ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ title: c.title, url: c.url, headingPath: c.headingPath });
  }
  return out;
}

function retrievalLog(rw: RewriteResult, r: RetrieveResult | null) {
  return {
    searchQuery: rw.searchQuery,
    usedModelRewrite: rw.usedModel,
    language: rw.language,
    ...(r
      ? {
          confident: r.confident,
          ...r.diagnostics,
          chunks: r.chunks.map((c) => ({ id: c.id, title: c.title, heading: c.headingPath, score: Number(c.score.toFixed(4)), sim: c.vectorSimilarity })),
        }
      : {}),
  };
}

/**
 * One assistant turn: guard → conversation → rewrite → retrieve → (canned | grounded stream | fallback) → log.
 * Yields events for SSE; every path ends with exactly one `done` (or `error` before a conversation exists).
 */
export async function* answerTurn(input: AnswerInput): AsyncGenerator<AnswerEvent> {
  const cfg = ragConfig();
  const started = Date.now();
  const message = input.message.replace(/\s+/g, ' ').trim().slice(0, cfg.maxMessageChars);
  if (!message) {
    yield { type: 'error', message: 'Please type a question.' };
    return;
  }

  const owner: ConversationOwner = {
    channel: input.channel,
    audience: input.audience,
    visitorId: input.visitorId,
    userId: input.userId,
    businessId: input.businessId,
    phone: input.phone,
  };
  const existing = input.conversationId ? await findOwnedConversation(input.conversationId, owner) : null;
  const conversation = existing ?? (await createConversation(owner, input.pagePath));
  yield { type: 'meta', conversationId: conversation.id };

  const history = existing ? await loadHistory(conversation.id) : [];
  await insertMessage({ conversationId: conversation.id, role: 'user', content: message });

  const sales = SALES_CHANNELS.has(input.channel) && input.audience === 'prospect';
  const budgetOk = await withinDailyBudget().catch(() => true);
  const rewrite = budgetOk ? await rewriteQuery(message, history).catch(() => null) : null;
  const rw: RewriteResult = rewrite ?? {
    searchQuery: message,
    intent: detectIntentHeuristic(message),
    language: detectLanguageHeuristic(message),
    usage: null,
    usedModel: false,
  };
  const usages: LlmUsage[] = rw.usage ? [rw.usage] : [];

  const finish = async function* (args: {
    text: string;
    answered: boolean;
    action?: AssistantAction | null;
    citations?: Citation[];
    citedChunkIds?: string[];
    retrieval: RetrieveResult | null;
    model?: string | null;
  }): AsyncGenerator<AnswerEvent> {
    if (args.action) yield { type: 'action', action: args.action };
    if (args.citations?.length) yield { type: 'citations', citations: args.citations };
    if (history.length === 0) {
      const replies = quickRepliesFor(sales, rw.language);
      if (replies.length) yield { type: 'quick_replies', replies };
    }
    const tokensIn = usages.reduce((s, u) => s + u.tokensIn, 0);
    const tokensOut = usages.reduce((s, u) => s + u.tokensOut, 0);
    const messageId = await insertMessage({
      conversationId: conversation.id,
      role: 'assistant',
      content: args.text,
      citedChunkIds: args.citedChunkIds,
      retrieval: retrievalLog(rw, args.retrieval),
      intent: rw.intent,
      action: args.action ?? null,
      model: args.model ?? usages[usages.length - 1]?.model ?? null,
      tokensIn,
      tokensOut,
      latencyMs: Date.now() - started,
      answered: args.answered,
    });
    yield { type: 'done', messageId, answered: args.answered };
  };

  const canned = cannedReply(rw.intent, rw.language, sales);
  if (canned) {
    yield { type: 'delta', text: canned.text };
    yield* finish({ text: canned.text, answered: true, action: canned.action ?? null, retrieval: null, model: 'canned' });
    return;
  }

  const scopeAudience = input.audience;
  const result = await retrieve({
    scope: { audience: scopeAudience, businessId: scopeAudience === 'tenant_customer' ? input.businessId : null },
    searchQuery: rw.searchQuery,
    originalQuery: message,
  });
  const extra = followUpAction(rw.intent, sales);

  if (!result.confident) {
    const text = notSureReply(rw.language, sales);
    yield { type: 'delta', text };
    yield* finish({
      text,
      answered: false,
      action: extra ?? (sales ? { type: 'book_demo' } : { type: 'talk_to_human' }),
      retrieval: result,
      model: 'fallback',
    });
    return;
  }

  const chunks = result.chunks;
  if (!chatModelConfigured() || !budgetOk) {
    const text = extractiveAnswer(chunks, rw.language);
    yield { type: 'delta', text };
    yield* finish({
      text,
      answered: true,
      action: extra,
      citations: toCitations(chunks, [1]),
      citedChunkIds: [chunks[0].id],
      retrieval: result,
      model: 'extractive',
    });
    return;
  }

  let text = '';
  let model: string | null = null;
  try {
    for await (const ev of streamChat(
      buildAnswerMessages({ audience: scopeAudience, chunks, history, message, language: rw.language }),
      { signal: input.signal },
    )) {
      if (ev.type === 'delta') {
        text += ev.text;
        yield { type: 'delta', text: ev.text };
      } else {
        usages.push(ev.usage);
        model = ev.usage.model;
      }
    }
  } catch (err) {
    console.warn('[rag/answer] generation failed:', err instanceof Error ? err.message : err);
  }

  if (!text.trim()) {
    text = extractiveAnswer(chunks, rw.language);
    yield { type: 'delta', text };
    model = 'extractive';
  }

  const cited = citedIndexes(text, chunks.length);
  const indexes = cited.length ? cited : [1];
  yield* finish({
    text,
    answered: true,
    action: extra,
    citations: toCitations(chunks, indexes),
    citedChunkIds: indexes.map((i) => chunks[i - 1].id),
    retrieval: result,
    model,
  });
}
