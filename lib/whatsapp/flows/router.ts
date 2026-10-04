import { helperCompletion } from '@/lib/ai-agent/helper-ai';
import { loadSavedAgentSettings } from '@/lib/ai-agent/settings';
import { routerDecisionSchema, type RouterDecision } from './schema';
import { listPublishedFlows, type PublishedFlow } from './store';

const THRESHOLD = 0.7;

function parseDecision(raw: string): RouterDecision | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = routerDecisionSchema.safeParse(JSON.parse(raw.slice(start, end + 1)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function isAiAgentEnabled(businessId: string): Promise<boolean> {
  const { queryOne } = await import('@/lib/db');
  const row = await queryOne<{ chatbot_enabled: boolean | null }>(
    `SELECT chatbot_enabled FROM ai_provider_config WHERE business_id = $1`,
    [businessId],
  ).catch(() => null);
  if (!row) return false;
  return row.chatbot_enabled !== false;
}

export type RouterResult =
  | { handler: 'flow'; flow: PublishedFlow; confidence: number; reason: string }
  | { handler: 'ai_agent'; confidence: number; reason: string }
  | { handler: 'fallback'; confidence: number; reason: string };

export async function routeInbound(input: {
  businessId: string;
  text: string;
  recentTurns?: string;
}): Promise<RouterResult | null> {
  const published = await listPublishedFlows(input.businessId);
  const withSoft = published.filter((f) => f.triggers.softIntents.length > 0);
  const agentOn = await isAiAgentEnabled(input.businessId);
  if (!withSoft.length && !agentOn) return null;
  if (!withSoft.length && agentOn) {
    return { handler: 'ai_agent', confidence: 1, reason: 'no_soft_flows' };
  }

  const catalog = withSoft
    .map((f) => `- ${f.id} | ${f.name} | intents: ${f.triggers.softIntents.join(', ')}`)
    .join('\n');

  const settings = await loadSavedAgentSettings(input.businessId).catch(() => null);
  const agentHint = agentOn
    ? `AI agent is on${settings?.businessSummary ? ` (${settings.businessSummary.slice(0, 200)})` : ''}. Use ai_agent for open questions, policies, product advice.`
    : 'AI agent is off. Prefer a flow or fallback.';

  try {
    const raw = await helperCompletion(
      input.businessId,
      'You route WhatsApp messages. Reply with JSON only: {"handler":"flow"|"ai_agent"|"fallback","flowId":"uuid-or-null","confidence":0.0,"reason":"short"}. Pick flow only from the list. Never invent a flowId.',
      `${agentHint}\n\nFLOWS:\n${catalog || '(none)'}\n\n${input.recentTurns ? `RECENT:\n${input.recentTurns}\n\n` : ''}MESSAGE:\n${input.text.slice(0, 500)}`,
    );
    const decision = parseDecision(raw);
    if (!decision) {
      return agentOn
        ? { handler: 'ai_agent', confidence: 0.4, reason: 'parse_failed' }
        : { handler: 'fallback', confidence: 0, reason: 'parse_failed' };
    }
    if (decision.handler === 'flow' && decision.flowId && decision.confidence >= THRESHOLD) {
      const flow = published.find((f) => f.id === decision.flowId);
      if (flow) {
        return { handler: 'flow', flow, confidence: decision.confidence, reason: decision.reason || 'router' };
      }
    }
    if (decision.handler === 'fallback' || !agentOn) {
      if (!agentOn) return { handler: 'fallback', confidence: decision.confidence, reason: decision.reason || 'agent_off' };
    }
    if (decision.confidence < THRESHOLD) {
      return agentOn
        ? { handler: 'ai_agent', confidence: decision.confidence, reason: 'low_confidence' }
        : { handler: 'fallback', confidence: decision.confidence, reason: 'low_confidence' };
    }
    if (decision.handler === 'ai_agent' && agentOn) {
      return { handler: 'ai_agent', confidence: decision.confidence, reason: decision.reason || 'router' };
    }
    return agentOn
      ? { handler: 'ai_agent', confidence: decision.confidence, reason: decision.reason || 'default_agent' }
      : { handler: 'fallback', confidence: decision.confidence, reason: 'default_fallback' };
  } catch (err) {
    console.warn('[flows] router failed:', err instanceof Error ? err.message : err);
    return agentOn
      ? { handler: 'ai_agent', confidence: 0.3, reason: 'router_error' }
      : { handler: 'fallback', confidence: 0, reason: 'router_error' };
  }
}

export { parseDecision };
