import { query, queryOne } from '@/lib/db';
import { addWhatsAppMessageJob } from '@/lib/queue';
import { isAssistantEcho } from './business-transport';

export type InboundProvider = 'cloud' | 'baileys' | 'platform';

export interface OwnerLink {
  business_id: string;
  user_id: string;
  linked_phone: string | null;
  self_chat: boolean;
  link_code: string | null;
  link_code_expires_at: string | Date | null;
}

export const digits = (s: string | null | undefined) => String(s ?? '').replace(/\D/g, '');

/** Same number with or without the country code ("98xxxxxxxx" vs "9198xxxxxxxx"). */
export function samePhone(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = digits(a);
  const y = digits(b);
  if (!x || !y) return false;
  if (x === y) return true;
  return x.length >= 10 && y.length >= 10 && x.slice(-10) === y.slice(-10);
}

const LINK_RE = /^\s*LINK\s+(\d{4,6})\s*$/i;

export function parseLinkCode(text: string | null | undefined): string | null {
  const m = LINK_RE.exec(text ?? '');
  return m ? m[1] : null;
}

/**
 * Records a message id once. Returns false when it was already seen (Meta retries a webhook
 * until it gets a 200; Baileys can emit the same message more than once).
 */
export async function recordInbound(input: {
  provider: InboundProvider;
  businessId: string | null;
  messageId: string;
  senderPhone: string;
  handledAs: string;
}): Promise<boolean> {
  try {
    const res = await query(
      `INSERT INTO whatsapp_inbound_events (provider, business_id, message_id, sender_phone, direction, handled_as)
       VALUES ($1, $2, $3, $4, 'in', $5)
       ON CONFLICT DO NOTHING`,
      [input.provider, input.businessId, input.messageId, input.senderPhone, input.handledAs],
    );
    return (res.rowCount ?? 0) > 0;
  } catch (err) {
    // Table missing before migration 341: don't block messages.
    console.warn('[wa-router] recordInbound failed:', err instanceof Error ? err.message : err);
    return true;
  }
}

/** Was this id sent by us (an assistant reply)? Used to stop self-chat loops on QR sessions. */
export async function isOurOutbound(provider: InboundProvider, businessId: string, messageId: string): Promise<boolean> {
  const row = await queryOne<{ ok: number }>(
    `SELECT 1 AS ok FROM whatsapp_inbound_events
      WHERE provider = $1 AND business_id = $2 AND message_id = $3 AND direction = 'out' LIMIT 1`,
    [provider, businessId, messageId],
  ).catch(() => null);
  return Boolean(row);
}

const LINK_CACHE_MS = 60_000;
const linkCache = new Map<string, { at: number; link: OwnerLink | null }>();

export function clearOwnerLinkCache(businessId?: string) {
  if (businessId) linkCache.delete(businessId);
  else linkCache.clear();
}

export async function getOwnerLink(businessId: string, fresh = false): Promise<OwnerLink | null> {
  const hit = linkCache.get(businessId);
  // While a LINK code is outstanding the row is about to change (often from another process).
  if (!fresh && hit && !hit.link?.link_code && Date.now() - hit.at < LINK_CACHE_MS) return hit.link;
  const link = await queryOne<OwnerLink>(
    `SELECT business_id, user_id, linked_phone, self_chat, link_code, link_code_expires_at
       FROM owner_whatsapp_links WHERE business_id = $1`,
    [businessId],
  ).catch(() => null);
  linkCache.set(businessId, { at: Date.now(), link });
  return link;
}

export function linkCodeValid(link: OwnerLink | null, code: string, now = new Date()): boolean {
  if (!link?.link_code || !link.link_code_expires_at) return false;
  return link.link_code === code && new Date(link.link_code_expires_at).getTime() > now.getTime();
}

export type InboundRoute = 'echo' | 'link' | 'owner' | 'other';

/**
 * Pure decision for one message on a business number. Only a sender proving the phone (an
 * incoming message, or QR self-chat) can link; only the linked phone or the linked self-chat
 * reaches the owner assistant; everything else continues to the CRM and the shop's bot.
 */
export function classifyInbound(input: {
  link: OwnerLink | null;
  businessPhone: string | null;
  from: string;
  isFromMe: boolean;
  text: string | null;
  now?: Date;
}): InboundRoute {
  const { link, businessPhone, from, isFromMe, text } = input;
  if (isFromMe && isAssistantEcho(text)) return 'echo';
  const selfChat = isFromMe && samePhone(from, businessPhone);
  if (isFromMe && !selfChat) return 'other';
  if (!link) return 'other';
  const code = parseLinkCode(text);
  if (code && linkCodeValid(link, code, input.now)) return 'link';
  if (!text?.trim() || !link.linked_phone) return 'other';
  if (selfChat) return link.self_chat && samePhone(link.linked_phone, businessPhone) ? 'owner' : 'other';
  return !link.self_chat && samePhone(from, link.linked_phone) ? 'owner' : 'other';
}

async function enqueueOwner(input: {
  kind: 'owner' | 'link';
  provider: 'cloud' | 'baileys';
  businessId: string;
  messageId: string;
  from: string;
  text: string;
  selfChat: boolean;
}) {
  await addWhatsAppMessageJob({
    type: 'owner-command',
    kind: input.kind,
    provider: input.provider,
    businessId: input.businessId,
    messageId: input.messageId,
    conversationId: `owner_${digits(input.from)}`,
    timestamp: Date.now(),
    from: digits(input.from),
    text: input.text,
    selfChat: input.selfChat,
  });
}

/**
 * Hook for the Baileys `messages.upsert` handler. Returns true when the message was consumed
 * (owner command, link code, or our own reply) and must not reach the CRM or the shop's bot.
 */
export async function routeBaileysInbound(input: {
  businessId: string;
  businessPhone: string;
  from: string;
  isFromMe: boolean;
  isGroup: boolean;
  messageId: string;
  text: string;
}): Promise<boolean> {
  if (input.isGroup || !input.messageId) return false;
  const selfChat = input.isFromMe && samePhone(input.from, input.businessPhone);
  // Most traffic is customers: the link row is cached, except when a fresh LINK code may have just been issued.
  const link = await getOwnerLink(input.businessId, parseLinkCode(input.text) !== null);
  if (!link && !isAssistantEcho(input.text)) return false;

  const route = classifyInbound({ link, businessPhone: input.businessPhone, from: input.from, isFromMe: input.isFromMe, text: input.text });
  if (route === 'echo') return true;
  if (selfChat && (await isOurOutbound('baileys', input.businessId, input.messageId))) return true;
  if (route === 'other') return false;

  const fresh = await recordInbound({
    provider: 'baileys',
    businessId: input.businessId,
    messageId: input.messageId,
    senderPhone: digits(input.from),
    handledAs: route,
  });
  if (!fresh) return true;
  await enqueueOwner({ kind: route, provider: 'baileys', businessId: input.businessId, messageId: input.messageId, from: input.from, text: input.text, selfChat });
  return true;
}

/** Cloud API messages on a business number: owner / link go to the assistant, the rest to the CRM. */
export async function routeCloudInbound(input: {
  businessId: string;
  businessPhone: string | null;
  messageId: string;
  from: string;
  text: string | null;
}): Promise<InboundRoute | 'duplicate'> {
  const link = await getOwnerLink(input.businessId, parseLinkCode(input.text) !== null);
  const route = classifyInbound({ link, businessPhone: input.businessPhone, from: input.from, isFromMe: false, text: input.text });
  const fresh = await recordInbound({
    provider: 'cloud',
    businessId: input.businessId,
    messageId: input.messageId,
    senderPhone: digits(input.from),
    handledAs: route,
  });
  if (!fresh) return 'duplicate';
  if (route === 'owner' || route === 'link') {
    await enqueueOwner({ kind: route, provider: 'cloud', businessId: input.businessId, messageId: input.messageId, from: input.from, text: input.text ?? '', selfChat: false });
  }
  return route;
}
