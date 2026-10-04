/**
 * Jobs for whatsapp-messages queue (BullMQ).
 * All fields must be JSON-serializable.
 */

/** Per-thread serialization key: set by addWhatsAppMessageJob as `${businessId}:${stableConversationId}`. */
export type WhatsAppQueueJobBase = {
  orderKey?: string;
};

/** Baileys path: pre-extracted, no WAMessage re-parse required. */
export type BaileysIncomingQueueJob = WhatsAppQueueJobBase & {
  type: 'incoming';
  sub: 'upsert' | 'messaging-history' | 'messages-set';
  businessId: string;
  messageId: string;
  conversationId: string;
  timestamp: number;
  /** If true, run bot auto-reply after processIncomingMessage (only upsert). */
  enableBotReply: boolean;
  senderJid: string;
  businessPhone: string;
  messageText: string;
  messageType: string;
  mediaUrl?: string;
  isGroup: boolean;
  groupName?: string;
  groupJid?: string;
  whatsappDisplayName?: string;
  sourceTimestampSec: number;
  originalWaTimestampSec: number | null;
  fromNumber: string;
};

export type BaileysOutgoingQueueJob = WhatsAppQueueJobBase & {
  type: 'outgoing';
  sub: 'upsert' | 'messaging-history' | 'messages-set';
  businessId: string;
  messageId: string;
  conversationId: string;
  timestamp: number;
  isGroup: boolean;
  businessPhone: string;
  messageText: string;
  messageType: string;
  mediaUrl?: string;
  sourceTimestampSec: number;
  originalWaTimestampSec: number | null;
  /** Recipient JID for storeOutgoing */
  recipientJid: string;
  /** conversation_id or group Jid string for DB lookup / create */
  conversationIdStr: string;
  /** Normalized customer phone (digits) for individual chats; group: business or placeholder */
  normalizedRecipient: string;
  groupName?: string;
  groupJid?: string;
  remoteJid: string;
  remoteJidAlt?: string;
};

export type OutgoingAfterSendQueueJob = WhatsAppQueueJobBase & {
  type: 'outgoing-after-send';
  businessId: string;
  messageId: string;
  conversationId: string;
  timestamp: number;
  toJid: string;
  /** CRM insert params */
  normalizedPhone: string;
  outText: string;
  outType: string;
  outMedia: string | null;
  outboxSourceTimestampSec: number;
  outboxOriginalWaSec: number | null;
};

/** Async webhook: raw JSON body for processWhatsAppWebhookBody. */
export type WebhookQueueJob = WhatsAppQueueJobBase & {
  type: 'webhook';
  businessId: string;
  messageId: string;
  /** Normalized contact key for ordering (e.g. digits from `from`) */
  conversationId: string;
  timestamp: number;
  body: Record<string, unknown>;
};

/** A message from the business owner (or a LINK code) on the business's own number. */
export type OwnerCommandQueueJob = WhatsAppQueueJobBase & {
  type: 'owner-command';
  kind: 'owner' | 'link';
  provider: 'cloud' | 'baileys';
  businessId: string;
  messageId: string;
  /** Sender digits; also the ordering key. */
  conversationId: string;
  timestamp: number;
  from: string;
  text: string;
  /** QR "Message yourself" chat: the owner's number is the business number. */
  selfChat: boolean;
};

/** A customer message that reached the business's Cloud API number. */
export type CloudIncomingQueueJob = WhatsAppQueueJobBase & {
  type: 'cloud-incoming';
  businessId: string;
  messageId: string;
  conversationId: string;
  timestamp: number;
  from: string;
  profileName: string | null;
  text: string;
  messageType: string;
  businessPhone: string;
  sourceTimestampSec: number | null;
  /** Cart sent from the business's catalog (`messageType: 'order'`). */
  order?: {
    catalogId: string | null;
    note: string | null;
    items: Array<{ retailerId: string; quantity: number }>;
  } | null;
  /** Meta media id for photos, videos, voice notes, stickers and files. */
  media?: {
    kind: 'image' | 'video' | 'audio' | 'document' | 'sticker';
    id: string;
    mimeType: string | null;
    filename: string | null;
  } | null;
};

/** A message to Khatario's own WhatsApp number (prospects and existing users). */
export type PlatformIncomingQueueJob = WhatsAppQueueJobBase & {
  type: 'platform-incoming';
  /** Always 'platform'; kept so job ids and order keys work like the business jobs. */
  businessId: string;
  messageId: string;
  conversationId: string;
  timestamp: number;
  from: string;
  profileName: string | null;
  text: string;
  /** Id of the tapped button / list row, when the message is a reply. */
  replyId?: string | null;
  /** Click-to-WhatsApp ad that opened the chat (first message only). */
  referral?: {
    sourceId: string | null;
    sourceType: string | null;
    sourceUrl: string | null;
    headline: string | null;
    body: string | null;
    ctwaClid: string | null;
  } | null;
};

export type WhatsAppMessageJob =
  | BaileysIncomingQueueJob
  | BaileysOutgoingQueueJob
  | OutgoingAfterSendQueueJob
  | WebhookQueueJob
  | OwnerCommandQueueJob
  | CloudIncomingQueueJob
  | PlatformIncomingQueueJob;
