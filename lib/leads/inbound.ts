/**
 * Leads from messages. Every inbound 1:1 message follows the repeat rule: it joins the phone's open
 * lead while that lead is active; a lead quiet for QUIET_DAYS is closed as lost ("Went quiet") and the
 * message opens a fresh one. Without an open lead, a tracked link's code opens a link lead (any number),
 * else a number the business does not know opens a Direct lead when "New numbers" is on.
 * Outbound messages only touch (and link) the open lead. Groups never get leads. Nothing here throws:
 * it runs on every message and must never stop one being stored.
 */
import { queryOne } from '@/lib/db';
import { assignToAgent, isEligibleInboxAgent } from '@/lib/whatsapp/inbox-ownership';
import { getDirectChatSetting, isKnownNumber, linkRoutingForText } from '@/lib/whatsapp/lead-sources';
import { openLeadForChat } from './chat-deal';
import { closeLeadAsWentQuiet, findOpenLead, linkChatToLead, openLead, QUIET_DAYS, touchLead, type Lead } from './core';

export type InboundLeadAction = 'joined' | 'opened' | 'reopened_after_quiet' | 'none';

const DAY_MS = 24 * 60 * 60 * 1000;
const NONE = { leadId: null, action: 'none' } as const;

/**
 * Applies the repeat rule for one inbound message on a 1:1 chat. A few indexed queries in the usual
 * case (open lead found and active); isKnownNumber runs only when there is no open lead to join.
 */
export async function leadForInboundMessage(
  businessId: string,
  conversationId: string,
  phone: string,
  text: string | null,
): Promise<{ leadId: string | null; action: InboundLeadAction }> {
  try {
    let wentQuiet = false;
    const open = await findOpenLead(businessId, phone);
    if (open) {
      if (Date.now() - new Date(open.last_activity_at).getTime() < QUIET_DAYS * DAY_MS) {
        await joinLead(businessId, open, conversationId);
        return { leadId: open.id, action: 'joined' };
      }
      await closeLeadAsWentQuiet(businessId, open.id);
      wentQuiet = true;
    }

    const chat = await queryOne<{ name: string | null; is_group: boolean | null }>(
      `SELECT NULLIF(whatsapp_display_name, '') AS name, is_group FROM whatsapp_conversations WHERE id = $1::uuid AND business_id = $2`,
      [conversationId, businessId],
    );
    if (!chat || chat.is_group) return { ...NONE };

    let opened: { lead: Lead; created: boolean };
    const link = await linkRoutingForText(businessId, text);
    if (link) {
      // A link that still names an agent who lost inbox access opens the lead unowned.
      const ownerId = link.ownerId && (await isEligibleInboxAgent(businessId, link.ownerId)) ? link.ownerId : null;
      opened = await openLead(businessId, {
        phone,
        name: chat.name,
        conversationId,
        source: 'link',
        sourceDetail: { link_id: link.linkId, name: link.name, code: link.code, label_ids: link.labelIds },
        stageId: link.stageId,
        ownerId,
        actor: { source: 'auto' },
      });
      if (opened.created && ownerId) await assignToAgent(businessId, conversationId, ownerId);
    } else {
      if (!(await getDirectChatSetting(businessId)).enabled || (await isKnownNumber(businessId, phone))) return { ...NONE };
      opened = await openLead(businessId, { phone, name: chat.name, conversationId, actor: { source: 'auto' } });
    }

    // Another message opened the lead a moment earlier: this one joins it.
    if (!opened.created) {
      await joinLead(businessId, opened.lead, conversationId);
      return { leadId: opened.lead.id, action: 'joined' };
    }
    return { leadId: opened.lead.id, action: wentQuiet ? 'reopened_after_quiet' : 'opened' };
  } catch (err) {
    console.warn('[leads] inbound message lead failed:', err instanceof Error ? err.message : err);
    return { ...NONE };
  }
}

/** A message sent to the chat: its open lead (by chat, else phone) gets the chat if it has none, and a touch. */
export async function touchLeadForChat(businessId: string, conversationId: string): Promise<void> {
  try {
    const lead = await openLeadForChat(businessId, conversationId);
    if (lead) await joinLead(businessId, lead, conversationId);
  } catch (err) {
    console.warn('[leads] outbound message touch failed:', err instanceof Error ? err.message : err);
  }
}

async function joinLead(businessId: string, lead: Lead, conversationId: string): Promise<void> {
  if (!lead.conversation_id) await linkChatToLead(businessId, lead.id, conversationId);
  await touchLead(businessId, lead.id);
}
