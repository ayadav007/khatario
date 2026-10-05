import { isHardStartMatch, matchOption, validateAsk } from './match';
import { startWalk, walkFrom, nodeById, messageLeadsOnlyToEnd } from './walk';
import { runFlowActions } from './actions';
import { renderNode } from './render';
import { isSilentHandledResult, replyToCrm, type CrmBotResult } from './send';
import { logRouting } from './log';
import {
  endSession,
  getActiveSession,
  getFlow,
  listPublishedFlows,
  startSession,
  updateSession,
  type PublishedFlow,
  type SessionRow,
} from './store';
import type { FlowDefinition, FlowNode } from './schema';

export { isSilentHandledResult };

export type FlowInbound = {
  businessId: string;
  conversationId: string;
  messageId: string;
  text: string;
  replyId?: string | null;
  isFirstMessage: boolean;
  phone: string;
};

async function applyWalk(
  businessId: string,
  conversationId: string,
  flow: PublishedFlow,
  session: SessionRow | null,
  walk: ReturnType<typeof startWalk>,
  context: Record<string, unknown>,
  handler: 'flow_session' | 'flow_hard' | 'router',
  messageId: string,
  phone: string,
  reasonExtra?: string,
): Promise<CrmBotResult | { openShop: true } | null> {
  const { openShop } = await runFlowActions(businessId, conversationId, walk.actions);
  if (walk.kind === 'open_shop' || openShop) {
    if (session) await endSession(session.id);
    else await startSession({
      businessId,
      conversationId,
      flowId: flow.id,
      flowVersion: flow.version,
      currentNodeId: 'end',
      context,
    }).then((s) => endSession(s.id));
    await logRouting({ businessId, conversationId, messageId, handler, flowId: flow.id, reason: reasonExtra || 'open_shop' });
    return { openShop: true };
  }
  if (walk.kind === 'end') {
    if (session) await endSession(session.id);
    await logRouting({ businessId, conversationId, messageId, handler, flowId: flow.id, reason: reasonExtra || 'ended' });
    return { shouldStore: true, handled: true };
  }

  const reply = renderNode(walk.node, context);
  const currentNodeId = walk.node.id;
  // Terminal messages (e.g. "Connecting you with our team" → End): do not keep a session.
  // Otherwise the customer's next real question only advances End and never reaches the AI.
  const terminal = messageLeadsOnlyToEnd(flow.definition, currentNodeId);
  if (terminal) {
    if (session) await endSession(session.id);
  } else if (session) {
    await updateSession(session.id, { currentNodeId, context });
  } else {
    await startSession({
      businessId,
      conversationId,
      flowId: flow.id,
      flowVersion: flow.version,
      currentNodeId,
      context,
    });
  }
  await logRouting({ businessId, conversationId, messageId, handler, flowId: flow.id, reason: reasonExtra || walk.node.type });
  if (!reply) return { shouldStore: true, handled: true };
  void phone;
  return replyToCrm(reply);
}

function optionsOf(node: FlowNode): Array<{ id: string; title: string }> {
  if (node.type === 'buttons') return node.data.buttons;
  if (node.type === 'list') return node.data.rows.map((r) => ({ id: r.id, title: r.title }));
  return [];
}

async function publishedForSession(businessId: string, session: SessionRow): Promise<PublishedFlow | null> {
  const row = await getFlow(businessId, session.flow_id);
  if (!row || row.status !== 'published' || !row.published_definition) return null;
  return {
    id: row.id,
    name: row.name,
    version: row.version,
    definition: row.published_definition,
    triggers: row.triggers,
  };
}

export async function handleActiveSession(input: FlowInbound): Promise<CrmBotResult | { openShop: true } | null> {
  const session = await getActiveSession(input.businessId, input.conversationId);
  if (!session) return null;
  const flow = await publishedForSession(input.businessId, session);
  if (!flow) {
    await endSession(session.id, 'expired');
    return null;
  }
  const node = nodeById(flow.definition, session.current_node_id);
  if (!node) {
    await endSession(session.id);
    return null;
  }

  let handle: string | null = null;
  const context = { ...session.context };

  if (node.type === 'buttons' || node.type === 'list') {
    const hit = matchOption(optionsOf(node), { text: input.text, replyId: input.replyId });
    if (!hit) {
      const fallback = 'Please choose one of the options.';
      return replyToCrm({ text: fallback, ...(node.type === 'buttons' ? { buttons: node.data.buttons } : { list: { buttonText: node.type === 'list' ? node.data.buttonText : 'Choose', rows: node.type === 'list' ? node.data.rows : [] } }) });
    }
    handle = hit.optionId;
    context.last_option = hit.optionId;
  } else if (node.type === 'ask') {
    if (!validateAsk(input.text, node.data.input)) {
      return replyToCrm({ text: node.data.fallback || 'Please reply with a valid answer.' });
    }
    context[node.data.storeAs] = input.text.trim();
  } else if (node.type === 'message') {
    handle = null;
  }

  const walk = walkFrom(flow.definition, node.id, context, handle);
  const result = await applyWalk(
    input.businessId,
    input.conversationId,
    flow,
    session,
    walk,
    context,
    'flow_session',
    input.messageId,
    input.phone,
  );
  // Stuck sessions parked on a terminal message used to end with handled+no text and block the AI.
  if (isSilentHandledResult(result)) return null;
  return result;
}

export async function handleHardStart(input: FlowInbound): Promise<CrmBotResult | { openShop: true } | null> {
  const published = await listPublishedFlows(input.businessId);
  const flow = published.find((f) => isHardStartMatch(f.triggers, input));
  if (!flow) return null;
  const walk = startWalk(flow.definition, {});
  return applyWalk(
    input.businessId,
    input.conversationId,
    flow,
    null,
    walk,
    {},
    'flow_hard',
    input.messageId,
    input.phone,
  );
}

export async function startPublishedFlow(
  input: FlowInbound,
  flow: PublishedFlow,
  reason: string,
): Promise<CrmBotResult | { openShop: true } | null> {
  const walk = startWalk(flow.definition, {});
  const result = await applyWalk(
    input.businessId,
    input.conversationId,
    flow,
    null,
    walk,
    {},
    'router',
    input.messageId,
    input.phone,
    reason,
  );
  return result;
}

export function definitionFromPublished(flow: PublishedFlow): FlowDefinition {
  return flow.definition;
}
