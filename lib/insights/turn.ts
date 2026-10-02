import { queryOne } from '@/lib/db';
import { todayIst } from '@/lib/gst/time-limits';
import { chooseTools, type LlmMessage, type LlmUsage } from '@/lib/rag/llm';
import { matchCommand, OWNER_HELP_TEXT } from './commands';
import { appBaseUrl, renderCards, type InsightCard, type TextFormat } from './format';
import { INSIGHT_TOOLS, runInsightTool, type InsightContext, type ToolCall } from './tools';

/** Business numbers are for the primary admin only (an active user of this business). */
export async function canSeeBusinessData(userId: string | null | undefined, businessId: string | null | undefined): Promise<boolean> {
  if (!userId || !businessId) return false;
  const row = await queryOne<{ ok: boolean }>(
    `SELECT is_primary_admin AS ok FROM users WHERE id = $1 AND business_id = $2 AND is_active = true`,
    [userId, businessId],
  );
  return row?.ok === true;
}

export const NOT_OWNER_TEXT =
  'Business figures like sales, dues and stock are only shown to the owner (primary admin) of this business here. ' +
  'You can see the figures your role allows on the Dashboard (/dashboard) and in Reports. I can still help you with how to use Khatario.';

export interface InsightsResult {
  kind: 'data' | 'help';
  text: string;
  cards: InsightCard[];
  calls: ToolCall[];
  usage: LlmUsage | null;
}

const HELP_ONLY = /^\s*(help|menu|options|commands|\?|hi|hello|hey|namaste|start)\s*[.!?]*\s*$/i;
const MAX_HISTORY = 4;

function systemPrompt(today: string): string {
  return [
    "You route a business owner's question to tools that read their Khatario books (Indian GST billing and accounting).",
    `Today is ${today} (Indian time). Financial year runs April to March. Weeks start on Monday.`,
    'Pick the tool(s) that answer the question. Use daily_summary for general "how is business" questions.',
    'Map Hindi/Hinglish words: aaj = today, kal = yesterday, hafta = week, mahina = month, saal = year, udhaar/baaki = pending dues.',
    'Never invent numbers. If no tool fits, call no tool.',
  ].join('\n');
}

function respond(ctxCards: InsightCard[], calls: ToolCall[], format: TextFormat, usage: LlmUsage | null): InsightsResult {
  return { kind: 'data', text: renderCards(ctxCards, format, appBaseUrl()), cards: ctxCards, calls, usage };
}

function helpResult(format: TextFormat, lead?: string): InsightsResult {
  const body = format === 'whatsapp' ? OWNER_HELP_TEXT.replace(/^- /gm, '• ') : OWNER_HELP_TEXT;
  return { kind: 'help', text: lead ? `${lead}\n\n${body}` : body, cards: [], calls: [], usage: null };
}

/**
 * Answers an owner's data question with deterministic cards. The model only picks tools and
 * arguments; every figure comes from SQL. Callers must check canSeeBusinessData first.
 */
export async function runInsights(
  input: { businessId: string; userId: string; today?: string },
  question: string,
  opts: { history?: LlmMessage[]; format?: TextFormat; useModel?: boolean } = {},
): Promise<InsightsResult> {
  const format = opts.format ?? 'chat';
  const ctx: InsightContext = { businessId: input.businessId, userId: input.userId, today: input.today ?? todayIst() };
  const q = question.trim();
  if (HELP_ONLY.test(q)) return helpResult(format);

  const command = matchCommand(q);
  const wordCount = q.split(/\s+/).length;

  let calls: ToolCall[] = [];
  let usage: LlmUsage | null = null;

  // Short, unambiguous commands ("sales", "dues this month") skip the model.
  if ((command && !command.howTo && wordCount <= 5) || opts.useModel === false) {
    calls = command?.calls ?? [];
  } else {
    const history = (opts.history ?? []).slice(-MAX_HISTORY);
    const chosen = await chooseTools(
      [{ role: 'system', content: systemPrompt(ctx.today) }, ...history, { role: 'user', content: q }],
      INSIGHT_TOOLS.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })),
    );
    usage = chosen.usage;
    calls = chosen.calls.length ? chosen.calls : command?.calls ?? [];
  }

  if (!calls.length) {
    return helpResult(format, "I couldn't tell which figures you need.");
  }

  const results = await Promise.all(calls.map((c) => runInsightTool(ctx, c)));
  const cards = results.flatMap((r) => r.cards);
  return respond(cards, calls, format, usage);
}
