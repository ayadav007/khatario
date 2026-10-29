/**
 * The deal panel on a chat, read from and written to the chat's open lead. A chat with no open lead
 * shows an empty deal; picking a stage opens a lead for the chat's phone. Groups never get leads.
 */
import { queryOne } from '@/lib/db';
import { ensureStages, PipelineError, type DealActor, type DealPatch, type DealView, type LegacyLeadStatus } from '@/lib/whatsapp/pipeline';
import { findOpenLead, LeadError, linkChatToLead, loadLead, openLead, parseCloseDate, parseDealValue, patchLead, type Lead } from './core';

export type ChatDeal = DealView & { lead_id: string | null };

const NO_DEAL: ChatDeal = {
  lead_id: null,
  stage_id: null,
  deal_value: null,
  expected_close_on: null,
  lost_reason: null,
  stage_changed_at: null,
  source: null,
  source_detail: null,
};

function dealOf(lead: Lead): ChatDeal {
  return {
    lead_id: lead.id,
    stage_id: lead.stage_id,
    deal_value: lead.deal_value,
    expected_close_on: lead.expected_close_on,
    lost_reason: lead.lost_reason,
    stage_changed_at: lead.stage_changed_at,
    source: lead.source,
    source_detail: lead.source_detail,
  };
}

async function loadChat(businessId: string, conversationId: string) {
  return queryOne<{ from_number: string; name: string | null; is_group: boolean | null }>(
    `SELECT from_number, NULLIF(whatsapp_display_name, '') AS name, is_group
       FROM whatsapp_conversations WHERE id = $1::uuid AND business_id = $2`,
    [conversationId, businessId],
  );
}

/** The chat's open lead: the one linked to it, else the open lead for its phone. */
export async function openLeadForChat(businessId: string, conversationId: string): Promise<Lead | null> {
  const linked = await queryOne<{ id: string }>(
    `SELECT id::text AS id FROM leads
      WHERE business_id = $1 AND conversation_id = $2::uuid AND closed_at IS NULL
      ORDER BY opened_at DESC LIMIT 1`,
    [businessId, conversationId],
  );
  if (linked) return loadLead(businessId, linked.id);
  const chat = await loadChat(businessId, conversationId);
  if (!chat || chat.is_group) return null;
  return findOpenLead(businessId, chat.from_number);
}

export async function loadChatDeal(businessId: string, conversationId: string): Promise<ChatDeal | null> {
  const chat = await loadChat(businessId, conversationId);
  if (!chat) return null;
  if (chat.is_group) return { ...NO_DEAL };
  const lead = await openLeadForChat(businessId, conversationId);
  return lead ? dealOf(lead) : { ...NO_DEAL };
}

/**
 * Updates the deal on a chat's open lead. The caller has already checked the chat is visible to the
 * actor. With no open lead, a stage opens one for the chat's phone; anything else is refused.
 * Returns the lead it changed, even when that move closed it.
 */
export async function setChatDeal(businessId: string, conversationId: string, patch: DealPatch, actor: DealActor): Promise<ChatDeal> {
  const chat = await loadChat(businessId, conversationId);
  if (!chat) throw new PipelineError('Conversation not found', 404, 'NOT_FOUND');
  if (chat.is_group) throw new PipelineError('Group chats cannot go on the pipeline', 400, 'GROUP_CHAT');
  // Check values before a lead is opened, so a bad value never leaves a half-made lead.
  if (patch.dealValue !== undefined) parseDealValue(patch.dealValue);
  if (patch.expectedCloseOn !== undefined) parseCloseDate(patch.expectedCloseOn);

  try {
    let lead = await openLeadForChat(businessId, conversationId);
    let rest: DealPatch = patch;
    if (!lead) {
      if (!patch.stageId) throw new PipelineError('Put this chat on the pipeline first', 400, 'NO_LEAD');
      const opened = await openLead(businessId, {
        phone: chat.from_number,
        name: chat.name,
        conversationId,
        stageId: patch.stageId,
        createdBy: actor.source === 'agent' ? actor.userId : null,
        actor,
      });
      lead = opened.lead;
      // A lead opened just now already sits on the stage; one we joined still needs the move.
      if (opened.created) rest = { ...patch, stageId: undefined };
    } else if (!lead.conversation_id) {
      await linkChatToLead(businessId, lead.id, conversationId);
    }
    const hasMore = Object.values(rest).some((v) => v !== undefined);
    if (hasMore) lead = await patchLead(businessId, lead.id, rest, actor);
    return dealOf(lead);
  } catch (err) {
    if (err instanceof LeadError) throw new PipelineError(err.message, err.status, err.code);
    throw err;
  }
}

/** Moves a chat to the stage that replaced an old lead_status value (AI agent "when qualified"). */
export async function setChatStageByLegacyKey(
  businessId: string,
  conversationId: string,
  key: LegacyLeadStatus,
  actor: DealActor,
): Promise<void> {
  const stages = await ensureStages(businessId);
  const stage =
    stages.find((s) => s.legacy_key === key) ??
    (key === 'converted' ? stages.find((s) => s.kind === 'won') : key === 'lost' ? stages.find((s) => s.kind === 'lost') : stages.find((s) => s.kind === 'open'));
  if (!stage) return;
  await setChatDeal(businessId, conversationId, { stageId: stage.id }, actor);
}
