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

export type WhatsAppMessageJob =
  | BaileysIncomingQueueJob
  | BaileysOutgoingQueueJob
  | OutgoingAfterSendQueueJob
  | WebhookQueueJob;
