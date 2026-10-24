import { handleActiveSession, handleHardStart, startPublishedFlow, type FlowInbound } from './runtime';
import { routeInbound } from './router';
import { logRouting } from './log';
import type { CrmBotResult } from './send';

export type FlowHookResult = CrmBotResult | { openShop: true };

export async function tryFlowSessionOrHard(input: FlowInbound): Promise<FlowHookResult | null> {
  const sessionHit = await handleActiveSession(input).catch((err) => {
    console.error('[flows] session failed:', err instanceof Error ? err.message : err);
    return null;
  });
  if (sessionHit) return sessionHit;
  const hard = await handleHardStart(input).catch((err) => {
    console.error('[flows] hard start failed:', err instanceof Error ? err.message : err);
    return null;
  });
  return hard;
}

export async function tryFlowRouter(input: FlowInbound): Promise<FlowHookResult | 'ai_agent' | null> {
  const decision = await routeInbound({ businessId: input.businessId, text: input.text }).catch((err) => {
    console.warn('[flows] router failed:', err instanceof Error ? err.message : err);
    return null;
  });
  if (!decision) return null;
  if (decision.handler === 'flow') {
    return startPublishedFlow(input, decision.flow, decision.reason);
  }
  await logRouting({
    businessId: input.businessId,
    conversationId: input.conversationId,
    messageId: input.messageId,
    handler: decision.handler === 'ai_agent' ? 'ai_agent' : 'fallback',
    reason: decision.reason,
    confidence: decision.confidence,
  });
  if (decision.handler === 'ai_agent') return 'ai_agent';
  return { shouldStore: true, handled: true };
}
