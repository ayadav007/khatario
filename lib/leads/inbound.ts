/**
 * Leads from messages. Every inbound 1:1 message follows the repeat rule: it joins the phone's open
 * lead while that lead is active; a lead quiet for QUIET_DAYS is closed as lost ("Went quiet") and the
 * message opens a fresh one. Without an open lead, a tracked link's code opens a link lead (any number),
 * else a number the business does not know opens a Direct lead when "New numbers" is on.
 * Only live messages drive the rule: history sync, replays and re-deliveries just give an open lead its
 * chat. Staff and bot replies touch (and link) the open lead. Groups never get leads. Nothing here
 * throws: it runs on every message and must never stop one being stored.
 */
import { queryOne } from '@/lib/db';
import { assignToAgent } from '@/lib/whatsapp/inbox-ownership';
import { getDirectChatSetting, isKnownNumber, linkRoutingForText } from '@/lib/whatsapp/lead-sources';
import { openLeadForChat } from './chat-deal';
import {
  closeLeadAsWentQuiet,
  findOpenLead,
  LeadError,
  linkChatToLead,
  openLead,
  QUIET_DAYS,
  touchLead,
  type Lead,
  type OpenLeadInput,
} from './core';
import { normalizeLeadPhone } from './phone';

export type InboundLeadAction = 'joined' | 'opened' | 'reopened_after_quiet' | 'none';

export interface InboundMessageInfo {
  /** When the customer sent it (WhatsApp's timestamp); null when unknown. */
  sentAt?: Date | null;
  /** The message row already existed before this delivery (a retry or replay). */
  duplicate?: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** Older messages arrive from history sync or a backlog; they are not new activity. */
const LIVE_MESSAGE_MS = DAY_MS;
const NONE = { leadId: null, action: 'none' } as const;

/**
 * Applies the repeat rule for one inbound message on a 1:1 chat. A few indexed queries in the usual
 * case (open lead found and active); the non-join path checks the cheapest reasons first and runs
 * isKnownNumber last.
 */
export async function leadForInboundMessage(
  businessId: string,
  conversationId: string,
  phone: string,
  text: string | null,
  info: InboundMessageInfo = {},
): Promise<{ leadId: string | null; action: InboundLeadAction }> {
  if (!normalizeLeadPhone(phone)) return { ...NONE };
  try {
    const open = await findOpenLead(businessId, phone);
    const live = !info.duplicate && !(info.sentAt && Date.now() - info.sentAt.getTime() > LIVE_MESSAGE_MS);
    if (!live) {
      // History sync, replays and re-deliveries are not activity: they only give an open lead its chat.
      if (open && !open.conversation_id) await linkChatToLead(businessId, open.id, conversationId);
      return { leadId: open?.id ?? null, action: 'none' };
    }

    let wentQuiet = false;
    if (open) {
      if (Date.now() - new Date(open.last_activity_at).getTime() < QUIET_DAYS * DAY_MS) {
        await joinLead(businessId, open, conversationId);
        return { leadId: open.id, action: 'joined' };
      }
      await closeLeadAsWentQuiet(businessId, open.id);
      wentQuiet = true;
    }

    const chat = await queryOne<{ name: string | null; is_group: boolean | null; customer_id: string | null }>(
      `SELECT NULLIF(whatsapp_display_name, '') AS name, is_group, customer_id::text AS customer_id
         FROM whatsapp_conversations WHERE id = $1::uuid AND business_id = $2`,
      [conversationId, businessId],
    );
    if (!chat || chat.is_group) return { ...NONE };

    let opened: { lead: Lead; created: boolean };
    const link = await linkRoutingForText(businessId, text);
    if (link) {
      opened = await openLinkLead(businessId, conversationId, {
        phone,
        name: chat.name,
        conversationId,
        source: 'link',
        sourceDetail: { link_id: link.linkId, name: link.name, code: link.code, label_ids: link.labelIds },
        stageId: link.stageId,
        ownerId: link.ownerId,
        actor: { source: 'auto' },
      });
    } else {
      // A chat tied to a customer is not a new enquiry, whatever phone that customer has on file.
      if (chat.customer_id) return { ...NONE };
      if (!(await getDirectChatSetting(businessId)).enabled) return { ...NONE };
      if (await isKnownNumber(businessId, phone)) return { ...NONE };
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

/**
 * A staff or bot reply on the chat: its open lead (by chat, else phone) gets the chat if it has none,
 * and a touch. Campaign sends and unclassified echoes (sentBy null or 'system') leave leads alone.
 */
export async function touchLeadForChat(
  businessId: string,
  conversationId: string,
  sentBy: 'bot' | 'staff' | 'system' | null | undefined,
): Promise<void> {
  if (sentBy !== 'staff' && sentBy !== 'bot') return;
  try {
    const lead = await openLeadForChat(businessId, conversationId);
    if (lead) await joinLead(businessId, lead, conversationId);
  } catch (err) {
    console.warn('[leads] outbound message touch failed:', err instanceof Error ? err.message : err);
  }
}

/**
 * Opens a link's lead with the link's agent as owner and on the chat. A link that still names an agent
 * who lost inbox access opens the lead unowned. A failed assignment never undoes the lead.
 */
async function openLinkLead(businessId: string, conversationId: string, input: OpenLeadInput): Promise<{ lead: Lead; created: boolean }> {
  let ownerId = input.ownerId ?? null;
  let opened: { lead: Lead; created: boolean };
  try {
    opened = await openLead(businessId, { ...input, ownerId });
  } catch (err) {
    if (!ownerId || !(err instanceof LeadError) || err.code !== 'BAD_OWNER') throw err;
    ownerId = null;
    opened = await openLead(businessId, { ...input, ownerId });
  }
  if (opened.created && ownerId) {
    await assignToAgent(businessId, conversationId, ownerId).catch((err) =>
      console.warn('[leads] link agent assignment failed:', err instanceof Error ? err.message : err),
    );
  }
  return opened;
}

async function joinLead(businessId: string, lead: Lead, conversationId: string): Promise<void> {
  if (!lead.conversation_id) await linkChatToLead(businessId, lead.id, conversationId);
  await touchLead(businessId, lead.id);
}
