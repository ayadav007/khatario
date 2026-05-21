import {
  findStoreMessageJidKey,
  normalizeMessage,
  getTimestamp,
  getOriginalWaTimestampSecOrNull
} from '@/lib/baileys-store-helpers';

export { getTimestamp, getOriginalWaTimestampSecOrNull } from '@/lib/baileys-store-helpers';
import { addWhatsAppMessageJob } from './queue';
import * as db from '@/lib/db';
import pino from 'pino';
// Hybrid Baileys - combines stable connection from standard Baileys with button support from baileys-pro
import {
  makeWASocket,
  DisconnectReason,
  fetchLatestBaileysVersion,
  BufferJSON,
  initAuthCreds,
  AuthenticationCreds,
  SignalDataTypeMap,
  proto,
  formatButtonMessage,
  sendButtonMessage
} from '@/lib/baileys-hybrid';
// Import media download utility from Baileys (v7+ uses downloadContentFromMessage)
import { downloadContentFromMessage } from '@whiskeysockets/baileys/lib/Utils';
// Import fs and path for store persistence
import fs from 'fs';
import path from 'path';
import * as WACM from '@/lib/whatsapp-connection-manager';

// ─── Message extraction helpers ───────────────────────────────────────────────

/** Convert a Baileys media stream to a Buffer */
async function streamToBuffer(stream: AsyncIterable<any>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export interface ExtractedMessage {
  type: string;
  text: string;
  mediaUrl?: string;
  hasMedia: boolean;
  /** true = skip this message entirely (reactions, protocol msgs, etc.) */
  skip: boolean;
}

/**
 * Extract type, text and media from any Baileys WAMessage.
 * Returns a normalised descriptor that the CRM layer can store directly.
 */
export async function extractMessageContent(msg: any): Promise<ExtractedMessage> {
  const m = normalizeMessage(msg?.message, 'extractMessageContent');
  if (!m) return { type: 'text', text: '', hasMedia: false, skip: true };

  // ── Skip protocol / ephemeral / reaction messages ──────────────────────────
  if (m.protocolMessage || m.senderKeyDistributionMessage) {
    return { type: 'text', text: '', hasMedia: false, skip: true };
  }
  if (m.reactionMessage) {
    // Reactions are handled by the messages.reaction event, not here
    return { type: 'reaction', text: m.reactionMessage.text || '', hasMedia: false, skip: true };
  }

  // Helper: download a media field and return a base64 data-URI
  const downloadMedia = async (
    field: any,
    mediaType: 'image' | 'video' | 'audio' | 'document' | 'sticker',
    defaultMime: string
  ): Promise<string | undefined> => {
    try {
      const stream = await downloadContentFromMessage(field, mediaType);
      const buffer = await streamToBuffer(stream);
      const mime = field.mimetype || defaultMime;
      return `data:${mime};base64,${buffer.toString('base64')}`;
    } catch (err) {
      console.error(`[WA] Error downloading ${mediaType} media:`, err);
      return undefined;
    }
  };

  // ── Text ───────────────────────────────────────────────────────────────────
  if (m.conversation) return { type: 'text', text: m.conversation, hasMedia: false, skip: false };
  if (m.extendedTextMessage?.text) return { type: 'text', text: m.extendedTextMessage.text, hasMedia: false, skip: false };

  // ── Media ──────────────────────────────────────────────────────────────────
  if (m.imageMessage) {
    return {
      type: 'image', text: m.imageMessage.caption || '',
      mediaUrl: await downloadMedia(m.imageMessage, 'image', 'image/jpeg'),
      hasMedia: true, skip: false,
    };
  }
  if (m.videoMessage) {
    return {
      type: 'video', text: m.videoMessage.caption || '',
      mediaUrl: await downloadMedia(m.videoMessage, 'video', 'video/mp4'),
      hasMedia: true, skip: false,
    };
  }
  if (m.documentMessage) {
    return {
      type: 'document', text: m.documentMessage.fileName || m.documentMessage.caption || '',
      mediaUrl: await downloadMedia(m.documentMessage, 'document', 'application/octet-stream'),
      hasMedia: true, skip: false,
    };
  }
  if (m.audioMessage) {
    return {
      type: 'audio', text: '',
      mediaUrl: await downloadMedia(m.audioMessage, 'audio', 'audio/ogg; codecs=opus'),
      hasMedia: true, skip: false,
    };
  }
  if (m.stickerMessage) {
    return {
      type: 'sticker', text: '',
      mediaUrl: await downloadMedia(m.stickerMessage, 'sticker', 'image/webp'),
      hasMedia: true, skip: false,
    };
  }

  // ── Location ───────────────────────────────────────────────────────────────
  if (m.locationMessage) {
    const lat = m.locationMessage.degreesLatitude;
    const lng = m.locationMessage.degreesLongitude;
    const name = m.locationMessage.name || '';
    return { type: 'location', text: name || `${lat},${lng}`, hasMedia: false, skip: false };
  }

  // ── Contact ────────────────────────────────────────────────────────────────
  if (m.contactMessage) {
    return { type: 'contact', text: m.contactMessage.displayName || 'Contact', hasMedia: false, skip: false };
  }
  if (m.contactsArrayMessage) {
    const names = (m.contactsArrayMessage.contacts || []).map((c: any) => c.displayName).filter(Boolean).join(', ');
    return { type: 'contact', text: names || 'Contacts', hasMedia: false, skip: false };
  }

  // ── Poll ───────────────────────────────────────────────────────────────────
  if (m.pollCreationMessage) {
    return { type: 'poll', text: `📊 ${m.pollCreationMessage.name || 'Poll'}`, hasMedia: false, skip: false };
  }
  if (m.pollUpdateMessage) {
    return { type: 'poll', text: '📊 Poll vote', hasMedia: false, skip: false };
  }

  // ── Button / interactive responses (incoming button clicks) ────────────────
  if (m.buttonsResponseMessage) {
    const text = m.buttonsResponseMessage.selectedDisplayText || m.buttonsResponseMessage.selectedButtonId || '';
    return { type: 'text', text, hasMedia: false, skip: false };
  }
  if (m.templateButtonReplyMessage) {
    const text = m.templateButtonReplyMessage.selectedDisplayText || m.templateButtonReplyMessage.selectedId || '';
    return { type: 'text', text, hasMedia: false, skip: false };
  }
  if (m.listResponseMessage) {
    const text = m.listResponseMessage.title || m.listResponseMessage.singleSelectReply?.selectedRowId || '';
    return { type: 'text', text, hasMedia: false, skip: false };
  }
  if (m.interactiveResponseMessage) {
    const ir = m.interactiveResponseMessage;
    const text =
      ir.nativeFlowResponseMessage?.id ||
      ir.buttonReplyMessage?.selectedButtonId ||
      ir.listResponseMessage?.singleSelectReply?.selectedRowId ||
      '';
    return { type: 'text', text, hasMedia: false, skip: !text };
  }

  // ── Unknown ────────────────────────────────────────────────────────────────
  const keys = Object.keys(m).filter(k => !['messageContextInfo', 'deviceSentMessage'].includes(k));
  if (keys.length) {
    console.log('[WA] ⚠️ Unknown message type, keys:', keys);
  }
  return { type: 'text', text: '', hasMedia: false, skip: true };
}

/** One CRM storage mapping for `extractMessageContent` (upsert, history, messages.set). */
const CRM_PLACEHOLDER_BY_TYPE: Record<string, string> = {
  image: '[Image]',
  video: '[Video]',
  document: '[Document]',
  audio: '[Audio]',
  sticker: '[Sticker]',
  location: '[Location]',
  contact: '[Contact]',
  poll: '[Poll]',
  text: '',
};

export function crmFieldsFromExtracted(ex: ExtractedMessage): { messageText: string; messageType: string; mediaUrl?: string } {
  const messageType = ex.type;
  const mediaUrl = ex.mediaUrl;
  let messageText = ex.text;
  if (ex.hasMedia && !String(messageText || '').trim()) {
    messageText = CRM_PLACEHOLDER_BY_TYPE[messageType] || '[Media]';
  } else if (!String(messageText || '').trim() && (messageType === 'location' || messageType === 'contact')) {
    messageText = CRM_PLACEHOLDER_BY_TYPE[messageType] || messageText;
  }
  return { messageText, messageType, mediaUrl };
}

// Increase max listeners for process to avoid warnings
if (typeof process !== 'undefined' && process.setMaxListeners) {
  process.setMaxListeners(20);
}

// Increase max listeners for process to avoid warnings
if (typeof process !== 'undefined' && process.setMaxListeners) {
  process.setMaxListeners(20);
}

// Define our types
export type SessionStatus = 'disconnected' | 'pending_qr' | 'connected' | 'error';

interface SessionRecord {
  status: SessionStatus;
  socket?: any; // WASocket type from baileys-pro
  qr?: string;
  phoneNumber?: string;
  retryCount: number;
  lastQRGeneratedAt?: number;
  revivedAt?: number;
  reconnectTimer?: NodeJS.Timeout;
  listenerAttached?: boolean;
  connectionOpenedAt?: number; // Track when connection was opened to detect premature disconnects
  initQueryErrorSeen?: boolean; // Track if we saw init query errors that might break the connection
  healthCheckTimer?: NodeJS.Timeout; // Periodic health check timer
  lastHealthCheck?: number; // Timestamp of last successful health check
  syncFullHistory?: boolean; // Flag to enable full history sync on next connection
  keepAliveTimer?: NodeJS.Timeout; // Periodic keep-alive ping timer to prevent idle timeout
  authStateSaveTimer?: NodeJS.Timeout; // Periodic auth state save timer
}

// Global session storage using globalThis (survives hot reloads)
const globalStore = globalThis as any;
if (!globalStore.__waSessions) {
  globalStore.__waSessions = new Map<string, SessionRecord>();
}
if (!globalStore.__waRevivalTimestamps) {
  globalStore.__waRevivalTimestamps = new Map<string, number>();
}
if (!globalStore.__waSaveStateTimers) {
  globalStore.__waSaveStateTimers = new Map<string, NodeJS.Timeout>();
}
if (!globalStore.__waLastSavedStates) {
  globalStore.__waLastSavedStates = new Map<string, string>();
}
// Cache group metadata to avoid expensive rate-limited API calls
if (!globalStore.__waGroupMetadataCache) {
  globalStore.__waGroupMetadataCache = new Map<string, string>();
}
// Cache for whatsapp_sessions DB queries (to avoid hitting DB on every status check)
if (!globalStore.__waStatusCache) {
  globalStore.__waStatusCache = new Map<string, { status: any; timestamp: number }>();
}
const groupMetadataCache = globalStore.__waGroupMetadataCache;
const statusCache = globalStore.__waStatusCache as Map<string, { status: any; timestamp: number }>;
const STATUS_CACHE_TTL = 30000; // 30 seconds - session status changes rarely

const sessions = globalStore.__waSessions as Map<string, SessionRecord>;
/** Exposed for BullMQ incoming job bot-reply (presence + send). */
export { sessions as whatsappSessions };

/** @deprecated Use `getTimestamp` from `@/lib/baileys-store-helpers` (full Long + fallback). */
export const getWhatsAppMessageTimestampSec = getTimestamp;
// Track which business IDs are currently creating sockets to prevent concurrent creation
const creatingSockets = new Set<string>();
const revivalTimestamps = globalStore.__waRevivalTimestamps as Map<string, number>;
const saveStateTimers = globalStore.__waSaveStateTimers as Map<string, NodeJS.Timeout>;
const lastSavedStates = globalStore.__waLastSavedStates as Map<string, string>;

// Helper to invalidate status cache when session is updated
function invalidateStatusCache(businessId: string) {
  statusCache.delete(businessId);
}

/**
 * PostgreSQL Auth Adapter for Baileys
 */
const usePostgresAuthState = async (businessId: string) => {
  const row = await db.queryOne(
    `SELECT auth_state FROM whatsapp_sessions WHERE business_id = $1`,
    [businessId]
  );

  let creds: any; // AuthenticationCreds type from baileys-pro
  let keys: Record<string, any> = {};

  const storedAuth = row?.auth_state;
  if (storedAuth && typeof storedAuth === 'object') {
    try {
      const parsed = JSON.parse(JSON.stringify(storedAuth), BufferJSON.reviver);
      creds = parsed.creds || initAuthCreds();
      keys = parsed.keys || {};
    } catch (e) {
      console.error('[WA] Error parsing auth state:', e);
      creds = initAuthCreds();
      keys = {};
    }
  } else {
    creds = initAuthCreds();
    keys = {};
  }

  // Debounced state saving with immediate flush option
  const saveState = async (immediate: boolean = false) => {
    const authData = { creds, keys };
    const jsonToSave = JSON.parse(JSON.stringify(authData, BufferJSON.replacer));
    const stateString = JSON.stringify(jsonToSave);
    
    // Skip if state hasn't actually changed
    if (lastSavedStates.get(businessId) === stateString) {
      return;
    }
    
    // Clear existing timeout
    const existingTimer = saveStateTimers.get(businessId);
    if (existingTimer) {
      clearTimeout(existingTimer);
      saveStateTimers.delete(businessId);
    }
    
    // If immediate flag is set (e.g., after connection opens), save right away
    // This prevents state loss if connection closes quickly after opening
    if (immediate) {
      try {
        await db.query(`
          INSERT INTO whatsapp_sessions (business_id, auth_state)
          VALUES ($1, $2::jsonb)
          ON CONFLICT (business_id) DO UPDATE
          SET auth_state = EXCLUDED.auth_state,
              updated_at = CURRENT_TIMESTAMP
        `, [businessId, jsonToSave]);
        invalidateStatusCache(businessId);
        lastSavedStates.set(businessId, stateString);
      } catch (error) {
        console.error('[WA] Error saving auth state:', error);
      }
      return;
    }
    
    // Debounce: Only save after 2 seconds of no updates (reduced from 3s for faster persistence)
    // This helps prevent state loss during connection establishment
    const timer = setTimeout(async () => {
      try {
        await db.query(`
          INSERT INTO whatsapp_sessions (business_id, auth_state)
          VALUES ($1, $2::jsonb)
          ON CONFLICT (business_id) DO UPDATE
          SET auth_state = EXCLUDED.auth_state,
              updated_at = CURRENT_TIMESTAMP
        `, [businessId, jsonToSave]);
        invalidateStatusCache(businessId);
        lastSavedStates.set(businessId, stateString);
      } catch (error) {
        console.error('[WA] Error saving auth state:', error);
      }
      saveStateTimers.delete(businessId);
    }, 2000); // Reduced from 3000ms to 2000ms for faster state persistence
    
    saveStateTimers.set(businessId, timer);
  };

  return {
    state: {
      creds,
      keys: {
        get: (type: string, ids: string[]) => {
          const data: any = {};
          ids.forEach((id) => {
            const key = `${String(type)}-${id}`;
            if (keys[key]) data[id] = keys[key];
          });
          return data;
        },
        set: (data: any) => {
          for (const category in data) {
            for (const id in data[category]) {
              const key = `${category}-${id}`;
              const value = data[category][id];
              if (value) keys[key] = value;
              else delete keys[key];
            }
          }
          saveState();
        },
      },
    },
    saveCreds: () => saveState(false), // Use debounced save by default
    saveCredsImmediate: () => saveState(true), // Immediate save for critical moments
  };
};

/**
 * Check if socket is valid and connected
 */
function isSocketValid(socket?: any): boolean {
  if (!socket) return false;
  // During initial connection, ws might be undefined temporarily
  if (socket.ws === undefined) return true; // Still connecting, consider valid
  // Once ws exists, check if it's closed
  return !socket.ws?.isClosed && !socket.ws?.isClosing;
}

/**
 * NOTE: LID resolution is no longer needed!
 * Baileys provides remoteJidAlt and participantAlt fields in msg.key that contain
 * the phone number JID when the main JID is a LID. Use those fields instead.
 * This function is kept for backward compatibility but should not be used.
 */
async function resolveLidToPhone(socket: any, lidJid: string): Promise<string | null> {
  console.warn('[WA] resolveLidToPhone() called but should use remoteJidAlt/participantAlt instead');
  return null;
}

/**
 * Universal function to extract phone number from Baileys JID
 * Handles ALL Baileys JID formats: @s.whatsapp.net, @c.us, @g.us, @lid, @broadcast, @status
 * 
 * NOTE: For @lid JIDs, use resolveLidToPhone() instead - this function cannot resolve LIDs
 * 
 * @param jid - The JID string from Baileys (e.g., "919876543210:0@s.whatsapp.net", "919876543210@c.us")
 * @returns Extracted phone number (digits only, 9-15 digits) or empty string if invalid
 */
function extractPhoneFromJid(jid?: string): string {
  if (!jid) {
    console.log('[WA] extractPhoneFromJid: empty JID');
    return '';
  }

  // If it's a @lid JID, we cannot extract the phone directly - must be resolved
  if (jid.endsWith('@lid')) {
    console.log('[WA] ⚠️ Cannot extract phone from @lid JID directly, must resolve:', jid);
    return '';
  }

  // Baileys can return ANY of these domains: @s.whatsapp.net, @c.us, @g.us, @broadcast, @status
  // Normalize by removing ALL domain suffixes, device IDs, and non-digits
  const afterDomainRemoved = jid.replace(/@.*$/, '');   // Remove any domain suffix
  const afterDeviceRemoved = afterDomainRemoved.replace(/:.*/, '');    // Remove device ID (:0, :29, etc.)
  const cleaned = afterDeviceRemoved.replace(/\D/g, '');   // Keep only digits

  console.log('[WA] ===== PHONE EXTRACTION =====');
  console.log('[WA] Original JID:', jid);
  console.log('[WA] After removing domain:', afterDomainRemoved);
  console.log('[WA] After removing device ID:', afterDeviceRemoved);
  console.log('[WA] Final cleaned phone:', cleaned);
  console.log('[WA] Phone length:', cleaned.length);

  // Phone numbers are 9-15 digits (international format)
  if (cleaned.length < 9 || cleaned.length > 15) {
    console.log('[WA] ❌ EXTRACTION FAILED: Invalid length');
    return '';
  }

  console.log('[WA] ✅ EXTRACTION SUCCESS:', cleaned);
  console.log('[WA] ============================');
  return cleaned;
}

/**
 * Attach CRM message listener (only once per socket)
 */
function attachMessageListener(socket: any, businessId: string, sessionRecord: SessionRecord) {
  // Prevent duplicate listeners
  if (sessionRecord.listenerAttached) {
    console.log(`[WA] ⚠️ Message listener already attached for ${businessId}, skipping`);
    return;
  }
  
  console.log(`[WA] 📡 Attaching message listener for business ${businessId}`);
  
  // Baileys often emits partial connection.update (e.g. after AwaitingInitialSync); only log meaningful slices
  socket.ev.on('connection.update', (update: any) => {
    const has =
      update?.connection != null ||
      update?.qr ||
      update?.lastDisconnect != null ||
      update?.isNewLogin != null;
    if (!has) return;
    console.log(`[WA] 🔌 Connection update (message listener):`, {
      connection: update.connection,
      qr: update.qr ? `${String(update.qr).substring(0, 50)}…` : undefined,
      isNewLogin: update.isNewLogin,
      lastDisconnect: update.lastDisconnect?.error?.message
    });
  });

      socket.ev.on('messages.upsert', async (m: any) => {
    console.log('[WA] 📨 messages.upsert event received:', {
      type: m.type,
      messagesCount: m.messages?.length || 0,
      businessId,
      timestamp: new Date().toISOString()
    });
    
    // Log raw message keys to understand what we're receiving
    if (m.messages && m.messages.length > 0) {
      console.log('[WA] 📋 Raw message keys sample:', m.messages[0].key);
    }
    
    const messages = m.messages || [];
    /** Baileys: `notify` = live message; `append` = history sync — never auto-reply to history. */
    const allowBotReplyForBatch = (m.type || 'notify') === 'notify';
    
    for (const msg of messages) {
      try {
      // Skip status updates (WhatsApp stories)
      const msgRemoteJid = msg.key.remoteJid || '';
      if (msgRemoteJid === 'status@broadcast' || msgRemoteJid.endsWith('@broadcast')) {
        console.log('[WA] ⏭️ Skipping status broadcast message from:', msgRemoteJid);
        continue;
      }
      // WhatsApp Channels / updates — not 1:1 CRM chats; media keys differ → avoid download/extraction noise
      if (msgRemoteJid.endsWith('@newsletter')) {
        console.log('[WA] ⏭️ Skipping channel/newsletter message from:', msgRemoteJid);
        continue;
      }

      console.log('[WA] Processing message:', {
        fromMe: msg.key.fromMe,
        hasMessage: !!msg.message,
        remoteJid: msg.key.remoteJid,
        messageId: msg.key.id,
        businessId,
        pushName: msg.pushName, // Log pushName to see if it's available
        msgKeys: Object.keys(msg) // Log all available keys
      });
      
      // Process BOTH incoming and outgoing messages (for complete CRM history)
      const isFromMe = msg.key.fromMe === true;
      
      if (!msg.message) {
        console.log('[WA] ⏭️ Skipping message - no message content');
        continue;
      }
      
      // Extract message content using the module-level helper (shared with history / messages.set)
      let extracted: ExtractedMessage;
      try {
        extracted = await extractMessageContent(msg);
      } catch (err: any) {
        // Media fetch failures (ECONNRESET/terminated/410 Gone) must never crash the listener.
        console.warn('[WA] ⚠️ extractMessageContent failed; skipping message', {
          businessId,
          messageId: msg?.key?.id,
          remoteJid: msg?.key?.remoteJid,
          error: err?.message || String(err || ''),
        });
        continue;
      }
      if (extracted.skip) {
        console.log('[WA] ⏭️ Skipping message (type=reaction/protocol/empty)');
        continue;
      }

      const { messageText, messageType, mediaUrl } = crmFieldsFromExtracted(extracted);
      const hasMedia = extracted.hasMedia;

      if (!String(messageText || '').trim() && !hasMedia) {
        console.log('[WA] ⏭️ Skipping message - nothing to store', { messageType, messageId: msg.key?.id });
        continue;
      }
      if (hasMedia && !String(extracted.text || '').trim()) {
        console.log('[WA] 💾 Storing media with placeholder', { messageType, messageId: msg.key?.id, source: 'upsert' });
      }
      
      // Get remoteJid, participant, and their alternate JIDs (for LID resolution)
      const remoteJid = msg.key.remoteJid || '';
      const participant = msg.key.participant || '';
      const remoteJidAlt = msg.key.remoteJidAlt || ''; // Alternate JID (phone number when remoteJid is LID)
      const participantAlt = msg.key.participantAlt || ''; // Alternate JID (phone number when participant is LID)
      const messageId = msg.key.id || '';
      
      console.log(`[WA] ✅ Processing ${isFromMe ? 'outgoing' : 'incoming'} message:`, {
        messageText: messageText.substring(0, 50),
        messageId,
        remoteJid,
        remoteJidAlt,
        participant,
        participantAlt,
        businessId,
        isFromMe
      });
      
      if (!remoteJid || !messageId) continue;

      const sourceTimestampSec = getTimestamp(msg);
      const originalWaTimestampSec = getOriginalWaTimestampSecOrNull(msg);

      // Check if message is from a group (groups end with @g.us)
      const isGroup = remoteJid.endsWith('@g.us');
      
      let fromNumber: string = '';
      let groupName: string | undefined;
      let groupJid: string | undefined;
      let senderJid: string = '';
      
      if (isGroup) {
        // GROUP MESSAGE: remoteJid is the group ID, participant is the actual sender
        groupJid = remoteJid;
        
        console.log('[WA] 🔍 Group message detected:', {
          remoteJid,
          participant,
          participantAlt,
          fromMe: isFromMe,
          hasParticipant: !!participant
        });
        
        // Extract phone number from participant JID (the actual sender)
        // For outgoing messages (fromMe=true), participant might be empty - use business phone
        if (isFromMe) {
          // Outgoing group message - use business phone
          const businessPhone = sessionRecord.phoneNumber || '';
          fromNumber = businessPhone;
          senderJid = `${businessPhone}@s.whatsapp.net`;
          console.log('[WA] 📤 Outgoing group message detected, using business phone:', businessPhone);
        } else if (participant) {
          // Incoming group message with participant - extract sender phone
          // If participant is a LID, use participantAlt (contains the phone number JID)
          const actualParticipantJid = participant.endsWith('@lid') && participantAlt 
            ? participantAlt 
            : participant;
          
          senderJid = actualParticipantJid;
          fromNumber = extractPhoneFromJid(actualParticipantJid);
          
          console.log('[WA] Group participant extraction:', {
            originalParticipant: participant,
            participantAlt,
            actualParticipantJid,
            extractedPhone: fromNumber
          });
          
          if (!fromNumber) {
            console.warn('[WA] Could not extract phone number from participant JID:', participant);
            // Don't skip - use a placeholder so message can still be saved
            fromNumber = 'unknown';
            senderJid = participant;
          }
        } else {
          // Incoming group message without participant field
          // This can happen in some cases - use a placeholder to allow message processing
          console.warn('[WA] ⚠️ Group message without participant JID (using placeholder):', remoteJid);
          fromNumber = 'unknown'; // Placeholder to allow message processing
          senderJid = remoteJid; // Use group JID as fallback
        }
        
        console.log('[WA] Group message extraction:', {
          groupJid: remoteJid,
          participantJid: participant,
          extractedPhone: fromNumber,
          phoneLength: fromNumber?.length || 0,
          isFromMe
        });
        
        // Final check for fromNumber (should be set by now for both incoming and outgoing)
        if (!fromNumber) {
          console.warn('[WA] ⚠️ Final check failed: fromNumber is missing for group message');
          continue;
        }
        
        // Try to get group metadata (with caching to avoid rate limits)
        try {
          // Check cache first to avoid expensive API calls
          if (groupMetadataCache.has(remoteJid)) {
            groupName = groupMetadataCache.get(remoteJid) || 'Group Chat';
          } else {
            const groupMetadata = await socket.groupMetadata(remoteJid);
            groupName = groupMetadata.subject || 'Unknown Group';
            // Cache the result
            groupMetadataCache.set(remoteJid, groupName);
          }
        } catch (err) {
          console.error('[WA] Error fetching group metadata:', err);
          // Use cached value if available, otherwise default
          groupName = groupMetadataCache.get(remoteJid) || 'Group Chat';
        }
      } else {
        // INDIVIDUAL MESSAGE: remoteJid contains the sender's JID
        // If remoteJid is a LID, use remoteJidAlt (contains the phone number JID)
        const actualRemoteJid = remoteJid.endsWith('@lid') && remoteJidAlt 
          ? remoteJidAlt 
          : remoteJid;
        
        senderJid = actualRemoteJid;
        fromNumber = extractPhoneFromJid(actualRemoteJid);
        
        console.log('[WA] Individual message extraction:', {
          originalRemoteJid: remoteJid,
          remoteJidAlt,
          actualRemoteJid,
          extractedPhone: fromNumber,
          phoneLength: fromNumber.length
        });
        
        if (!fromNumber) {
          console.warn('[WA] Could not extract phone number from individual JID:', actualRemoteJid);
          // If extraction fails (e.g., number is too short), skip.
          continue;
        }
      }
      
      // Ensure the final check for fromNumber is still there (redundant but safe)
      if (!fromNumber) {
        console.warn('[WA] Final check failed: fromNumber is missing. Skipping.');
        continue;
      }

      const businessPhone = sessionRecord.phoneNumber || '';
      
      // Handle STOP/START unsubscribe detection (for incoming messages only)
      if (!isFromMe && messageText) {
        const normalizedText = messageText.trim().toUpperCase();
        const unsubscribeKeywords = ['STOP', 'UNSUBSCRIBE', 'UNSUB'];
        const resubscribeKeywords = ['START', 'SUBSCRIBE', 'SUB'];
        
        console.log(`[WA] 🔍 Checking unsubscribe keywords:`, {
          isFromMe,
          messageText,
          normalizedText,
          fromNumber,
          businessId,
          matchesUnsubscribe: unsubscribeKeywords.includes(normalizedText),
          matchesResubscribe: resubscribeKeywords.includes(normalizedText)
        });
        
        // Check if message matches unsubscribe keywords
        if (unsubscribeKeywords.includes(normalizedText)) {
          console.log(`[WA] 🛑 Unsubscribe request detected from ${fromNumber}`);
          
          // Add to unsubscribe list
          try {
            const { query } = await import('@/lib/db');
            await query(`
              INSERT INTO whatsapp_unsubscribes (business_id, phone)
              VALUES ($1, $2)
              ON CONFLICT (business_id, phone) DO NOTHING
            `, [businessId, fromNumber]);
            
            console.log(`[WA] ✅ Added ${fromNumber} to unsubscribe list`);
            
            // Send confirmation message
            await socket.sendMessage(remoteJid, {
              text: 'You have been unsubscribed from our messages. Reply START to resubscribe.'
            });
            
            console.log(`[WA] ✅ Sent unsubscribe confirmation to ${fromNumber}`);
          } catch (err) {
            console.error(`[WA] ❌ Error adding to unsubscribe list:`, err);
          }
          
          // Continue processing the message normally (so it appears in conversation history)
        }
        
        // Check if message matches resubscribe keywords
        else if (resubscribeKeywords.includes(normalizedText)) {
          console.log(`[WA] ✅ Resubscribe request detected from ${fromNumber}`);
          
          // Remove from unsubscribe list
          try {
            const { query } = await import('@/lib/db');
            await query(`
              DELETE FROM whatsapp_unsubscribes 
              WHERE business_id = $1 AND phone = $2
            `, [businessId, fromNumber]);
            
            console.log(`[WA] ✅ Removed ${fromNumber} from unsubscribe list`);
            
            // Send confirmation message
            await socket.sendMessage(remoteJid, {
              text: 'You have been resubscribed to our messages. Reply STOP to unsubscribe.'
            });
            
            console.log(`[WA] ✅ Sent resubscribe confirmation to ${fromNumber}`);
          } catch (err) {
            console.error(`[WA] ❌ Error removing from unsubscribe list:`, err);
          }
          
          // Continue processing the message normally
        }
      }
      
      // Await in batch order; CRM + emit run in queue (or direct fallback)
        try {
          if (isFromMe) {
            const recipientPhone = fromNumber;
            const recipientJid = senderJid;
            const conversationIdStr = isGroup ? (groupJid || remoteJid) : recipientPhone;
            const normalizedRecipient = recipientPhone;

            console.log('[WA] 📤 Enqueue outgoing (messages.upsert):', {
              businessId,
              messageId,
              isGroup: !!isGroup
            });

            await addWhatsAppMessageJob({
              type: 'outgoing',
              sub: 'upsert',
              businessId,
              messageId,
              conversationId: conversationIdStr,
              timestamp: Date.now(),
              isGroup: !!isGroup,
              businessPhone,
              messageText,
              messageType,
              mediaUrl,
              sourceTimestampSec,
              originalWaTimestampSec,
              recipientJid,
              conversationIdStr,
              normalizedRecipient,
              groupName,
              groupJid,
              remoteJid,
              remoteJidAlt: msg.key?.remoteJidAlt || undefined
            });
          } else {
            const _msgContent = normalizeMessage(msg.message, 'upsert:pushName') || {};
            const _ctxInfo =
              (_msgContent as any)?.extendedTextMessage?.contextInfo ||
              (_msgContent as any)?.imageMessage?.contextInfo ||
              (_msgContent as any)?.videoMessage?.contextInfo ||
              (_msgContent as any)?.documentMessage?.contextInfo ||
              (_msgContent as any)?.audioMessage?.contextInfo ||
              {};
            const whatsappDisplayName =
              msg.pushName ||
              (msg as any).notifyName ||
              _ctxInfo?.pushName ||
              undefined;

            const finalMessageType = (typeof messageType === 'string' ? messageType : 'text');
            const finalMediaUrl = (typeof mediaUrl === 'string' ? mediaUrl : undefined);
            const finalIsGroup = !!isGroup;
            const finalGroupName = (typeof groupName === 'string' ? groupName : undefined);
            const finalGroupJid = (typeof groupJid === 'string' ? groupJid : undefined);
            const convKey = isGroup ? (groupJid || remoteJid) : fromNumber;

            console.log('[WA] 📥 Enqueue incoming (messages.upsert, bot in worker):', {
              businessId,
              messageId,
              upsertType: m.type || 'notify',
              enableBotReply: allowBotReplyForBatch
            });

            await addWhatsAppMessageJob({
              type: 'incoming',
              sub: 'upsert',
              businessId,
              messageId,
              conversationId: convKey,
              timestamp: Date.now(),
              enableBotReply: allowBotReplyForBatch,
              senderJid,
              businessPhone,
              messageText,
              messageType: finalMessageType,
              mediaUrl: finalMediaUrl,
              isGroup: finalIsGroup,
              groupName: finalGroupName,
              groupJid: finalGroupJid,
              whatsappDisplayName,
              sourceTimestampSec,
              originalWaTimestampSec,
              fromNumber
            });
          }
        } catch (err) {
          console.error('[WA] Error processing message:', err);
        }
      } catch (err) {
        // Absolute last-resort guard: never let a single message crash the upsert handler.
        console.error('[WA] ❌ Unhandled error while processing a message.upsert item:', err);
      }
    }
  });

  // Listen for message status updates (delivered, read) and ACK errors
  socket.ev.on('messages.update', async (updates: any) => {
    // Handle both array and single update
    const updateList = Array.isArray(updates) ? updates : [updates];
    
    for (const update of updateList) {
      const { key, update: statusUpdate } = update;
      
      // Only process updates for messages we sent (fromMe)
      if (!key?.fromMe || !key.id) continue;
      
      const messageId = key.id;
      let newStatus: string | null = null;
      
      // Handle ACK errors (rate limiting, etc.)
      if (statusUpdate?.status === undefined && update?.error) {
        const errorCode = update.error;
        const errorMsg = update.message || '';
        
        // Error 479 = Rate limit exceeded
        if (errorCode === 479 || errorCode === '479') {
          console.warn(`[WA] Rate limit hit for message ${messageId} (error 479). This may trigger device disconnection if repeated.`);
          // Don't update status - message was sent, just rate limited
          continue;
        }
        
        // Log other ACK errors for debugging
        if (errorCode) {
          console.warn(`[WA] ACK error for message ${messageId}: code=${errorCode}, message=${errorMsg}`);
        }
        continue;
      }
      
      // Map Baileys status to our status
      // Baileys uses: 1=PENDING, 2=SERVER_ACK, 3=DELIVERY_ACK, 4=READ
      if (statusUpdate?.status !== undefined) {
        switch (statusUpdate.status) {
          case 1: // PENDING
            newStatus = 'sent';
            break;
          case 2: // SERVER_ACK
            newStatus = 'sent';
            break;
          case 3: // DELIVERY_ACK
            newStatus = 'delivered';
            break;
          case 4: // READ
            newStatus = 'read';
            break;
          default:
            // If status is 0 or unknown, keep as sent
            newStatus = 'sent';
        }
      }
      
      if (newStatus) {
        // Update message status in database (await — no setImmediate; keeps ordering vs other DB work)
        try {
          const result = await db.query(
            `UPDATE whatsapp_conversation_messages 
             SET status = $1
             WHERE message_id = $2 AND business_id = $3
             RETURNING conversation_id, id, message_text, message_type, media_url, direction, buttons, created_at`,
            [newStatus, messageId, businessId]
          );

          if ((result.rowCount || 0) > 0) {
            console.log(`[WA] Updated message ${messageId} status to ${newStatus}`);

            const updatedMessage = result.rows[0];
            if (updatedMessage && updatedMessage.conversation_id) {
              try {
                const { emitNewMessage } = await import('@/lib/whatsapp-websocket');
                emitNewMessage(businessId, updatedMessage.conversation_id, {
                  ...updatedMessage,
                  status: newStatus,
                  message_id: messageId
                });
                console.log(`[WA] ✅ Emitted WebSocket update for message ${messageId} status: ${newStatus}`);
              } catch (wsError) {
                console.error('[WA] Error emitting WebSocket update for message status:', wsError);
              }
            }
          }

          // Reminder / outbox log (whatsapp_messages) — same Baileys id as conversation row
          const logUp = await db.query(
            `UPDATE whatsapp_messages
             SET status = $1
             WHERE business_id = $2 AND baileys_message_id = $3`,
            [newStatus, businessId, messageId]
          );
          if ((logUp.rowCount || 0) > 0) {
            console.log(
              `[WA] Updated whatsapp_messages log(s) for ${messageId} to ${newStatus} (${logUp.rowCount} row(s))`
            );
          }
        } catch (err) {
          console.error('[WA] Error updating message status:', err);
        }
      }
    }
  });

  // Handle emoji reactions from WhatsApp
  socket.ev.on('messages.reaction', async (reactions: any) => {
    const reactionList = Array.isArray(reactions) ? reactions : [reactions];
    for (const item of reactionList) {
      const key = item?.key;
      const reaction = item?.reaction;
      if (!key?.id || !key?.remoteJid || reaction === undefined) continue;

      const messageId = key.id;
      const chatJid = key.remoteJid;
      const senderJid = item.key?.participant || chatJid;
      const emoji = reaction?.text ?? '';

      try {
        const convRows = await db.queryRows(
          `SELECT id FROM whatsapp_conversations WHERE business_id = $1
             AND (conversation_id = $2 OR from_number = $2)
             LIMIT 1`,
          [businessId, chatJid]
        );
        if (convRows.length === 0) return;
        const conversationDbId = convRows[0].id;

        if (emoji === '') {
          await db.query(
            `DELETE FROM whatsapp_message_reactions
               WHERE business_id = $1 AND message_id = $2 AND sender_jid = $3`,
            [businessId, messageId, senderJid]
          );
        } else {
          await db.query(
            `INSERT INTO whatsapp_message_reactions
                 (business_id, conversation_id, message_id, sender_jid, reaction)
               VALUES ($1, $2, $3, $4, $5)
               ON CONFLICT (business_id, message_id, sender_jid)
               DO UPDATE SET reaction = $5, updated_at = NOW()`,
            [businessId, conversationDbId, messageId, senderJid, emoji]
          );
        }

        const waEmitter = (globalThis as any).__waWSEventEmitter;
        if (waEmitter) {
          waEmitter.emit(`event:business:${businessId}`, {
            type: 'reaction_update',
            businessId,
            messageId,
            conversationId: conversationDbId,
            senderJid,
            reaction: emoji,
          });
        }

        console.log(`[WA] ⚡ Reaction ${emoji || '(removed)'} on msg ${messageId} by ${senderJid}`);
      } catch (err) {
        console.error('[WA] Error saving reaction:', err);
      }
    }
  });

  sessionRecord.listenerAttached = true;
  console.log(`[WA] ✅ Message listener attached successfully for business ${businessId}`);
  
  // Verify socket is valid and has event emitter
  if (socket && socket.ev) {
    console.log(`[WA] ✅ Socket event emitter confirmed for business ${businessId}`);
  } else {
    console.error(`[WA] ❌ Socket or event emitter is invalid for business ${businessId}`);
  }
  
  // Test: Listen to ALL message-related events to catch anything we might be missing
  try {
    // Process historical messages from messaging-history.set event (Baileys standard pattern)
    // This event fires when WhatsApp sends chat history (chats, contacts, messages)
    socket.ev.on('messaging-history.set', async (historyData: any) => {
      const { chats, contacts, messages, isLatest } = historyData || {};
      console.log('[WA] 📚 messaging-history.set event received:', {
        chatsCount: chats?.length || 0,
        contactsCount: contacts?.length || 0,
        messagesCount: messages?.length || 0,
        isLatest,
        businessId
      });
      
      // Process and save historical messages to database (WhatsApp sync after link / reconnect).
      // Cap volume so many businesses reconnecting at once does not overload the DB/server.
      const MAX_HISTORY_MESSAGES_PER_SYNC = Number(process.env.WHATSAPP_MAX_HISTORY_MESSAGES_PER_SYNC || 2000);
      if (messages && Array.isArray(messages) && messages.length > 0) {
        const toProcess = messages.slice(0, MAX_HISTORY_MESSAGES_PER_SYNC);
        if (messages.length > MAX_HISTORY_MESSAGES_PER_SYNC) {
          console.warn(
            `[WA] 📚 Historical sync truncated: ${messages.length} messages, processing first ${MAX_HISTORY_MESSAGES_PER_SYNC} (set WHATSAPP_MAX_HISTORY_MESSAGES_PER_SYNC to change)`
          );
        }
        console.log(`[WA] 📚 Processing ${toProcess.length} historical messages and saving to database...`);
        
        // Process messages in batches to avoid overwhelming the database
        const BATCH_SIZE = 50;
        let savedCount = 0;
        let skippedCount = 0;
        
        for (let i = 0; i < toProcess.length; i += BATCH_SIZE) {
          const batch = toProcess.slice(i, i + BATCH_SIZE);
          
          for (const msg of batch) {
            try {
              const messageId = msg.key?.id;
              const remoteJid = msg.key?.remoteJid;
              const fromMe = msg.key?.fromMe === true;
              
              if (!messageId || !remoteJid || !msg.message) {
                skippedCount++;
                continue;
              }

              let extracted: ExtractedMessage;
              try {
                extracted = await extractMessageContent(msg);
              } catch (err: any) {
                console.warn('[WA] ⚠️ extractMessageContent failed during history sync; skipping message', {
                  businessId,
                  messageId,
                  remoteJid,
                  error: err?.message || String(err || ''),
                });
                skippedCount++;
                continue;
              }
              if (extracted.skip) {
                skippedCount++;
                continue;
              }
              const { messageText, messageType, mediaUrl } = crmFieldsFromExtracted(extracted);
              if (!String(messageText || '').trim() && !extracted.hasMedia) {
                skippedCount++;
                continue;
              }
              if (extracted.hasMedia && !String(extracted.text || '').trim()) {
                console.log(
                  '[WA] 📚 messaging-history: saving media (previously lost when messageText was empty)',
                  { messageId, messageType, fromMe }
                );
              }
              console.log('[WA] 📚 history sync: parsed message', { messageId, messageType, fromMe, hasMedia: extracted.hasMedia });

              const mCtx = normalizeMessage(msg.message) || {};
              const businessPhone = socket.user?.id?.split(':')[0] || '';
              
              if (!fromMe) {
                const isGrp = remoteJid.includes('@g.us');
                const senderJidH = isGrp ? (msg.key?.participant || remoteJid) : remoteJid;
                let historyGroupName: string | undefined;
                if (isGrp) {
                  if (groupMetadataCache.has(remoteJid)) {
                    historyGroupName = groupMetadataCache.get(remoteJid) || 'Group Chat';
                  } else {
                    try {
                      const groupMetadata = await socket.groupMetadata(remoteJid);
                      historyGroupName = groupMetadata.subject || 'Unknown Group';
                      groupMetadataCache.set(remoteJid, historyGroupName);
                    } catch {
                      historyGroupName = groupMetadataCache.get(remoteJid) || 'Group Chat';
                    }
                  }
                }
                const _hCtx =
                  (mCtx as any)?.extendedTextMessage?.contextInfo ||
                  (mCtx as any)?.imageMessage?.contextInfo ||
                  (mCtx as any)?.videoMessage?.contextInfo ||
                  (mCtx as any)?.documentMessage?.contextInfo ||
                  {};
                const historyPushName =
                  msg.pushName ||
                  (msg as any).notifyName ||
                  _hCtx?.pushName ||
                  undefined;
                const fromNumH = isGrp
                  ? (extractPhoneFromJid(msg.key?.participant || '') || 'unknown')
                  : (extractPhoneFromJid(senderJidH) || 'unknown');
                const convKeyH = isGrp ? remoteJid : fromNumH;

                await addWhatsAppMessageJob({
                  type: 'incoming',
                  sub: 'messaging-history',
                  businessId,
                  messageId,
                  conversationId: convKeyH,
                  timestamp: Date.now(),
                  enableBotReply: false,
                  senderJid: senderJidH,
                  businessPhone,
                  messageText,
                  messageType,
                  mediaUrl,
                  isGroup: isGrp,
                  groupName: historyGroupName,
                  groupJid: isGrp ? remoteJid : undefined,
                  whatsappDisplayName: historyPushName,
                  sourceTimestampSec: getTimestamp(msg),
                  originalWaTimestampSec: getOriginalWaTimestampSecOrNull(msg),
                  fromNumber: fromNumH
                });
                savedCount++;
              } else {
                const remoteJidAlt = msg.key?.remoteJidAlt || '';
                const isGroup = remoteJid.endsWith('@g.us');
                let fromNumberOut: string = '';
                let groupName: string | undefined;
                let groupJid: string | undefined;
                let senderJid: string = '';

                if (isGroup) {
                  groupJid = remoteJid;
                  const businessPh = sessionRecord.phoneNumber || '';
                  fromNumberOut = businessPh;
                  senderJid = `${businessPh}@s.whatsapp.net`;
                  if (groupMetadataCache.has(remoteJid)) {
                    groupName = groupMetadataCache.get(remoteJid) || 'Group Chat';
                  } else {
                    try {
                      const groupMetadata = await socket.groupMetadata(remoteJid);
                      groupName = groupMetadata.subject || 'Unknown Group';
                      groupMetadataCache.set(remoteJid, groupName);
                    } catch {
                      groupName = groupMetadataCache.get(remoteJid) || 'Group Chat';
                    }
                  }
                } else {
                  const actualRemoteJid = remoteJid.endsWith('@lid') && remoteJidAlt
                    ? remoteJidAlt
                    : remoteJid;
                  senderJid = actualRemoteJid;
                  fromNumberOut = extractPhoneFromJid(actualRemoteJid);
                  if (!fromNumberOut) {
                    skippedCount++;
                    continue;
                  }
                }

                if (!fromNumberOut) {
                  skippedCount++;
                  continue;
                }

                const businessPhoneOut = sessionRecord.phoneNumber || '';
                const conversationIdStr = isGroup ? (groupJid || remoteJid) : fromNumberOut;
                const normalizedRecipient = fromNumberOut;

                await addWhatsAppMessageJob({
                  type: 'outgoing',
                  sub: 'messaging-history',
                  businessId,
                  messageId,
                  conversationId: conversationIdStr,
                  timestamp: Date.now(),
                  isGroup,
                  businessPhone: businessPhoneOut,
                  messageText,
                  messageType,
                  mediaUrl,
                  sourceTimestampSec: getTimestamp(msg),
                  originalWaTimestampSec: getOriginalWaTimestampSecOrNull(msg),
                  recipientJid: senderJid,
                  conversationIdStr,
                  normalizedRecipient,
                  groupName,
                  groupJid,
                  remoteJid,
                  remoteJidAlt: msg.key?.remoteJidAlt || undefined
                });
                savedCount++;
              }
            } catch (err) {
              console.error('[WA] ⚠️ Error processing historical message:', err);
              skippedCount++;
            }
          }
          
          // Small delay between batches to avoid overwhelming DB
          if (i + BATCH_SIZE < toProcess.length) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        }
        
        console.log(`[WA] ✅ Finished processing historical messages:`, {
          total: toProcess.length,
          saved: savedCount,
          skipped: skippedCount,
          businessId
        });
      }
    });
    
    // Also listen to messages.set as fallback (older Baileys versions)
    socket.ev.on('messages.set', async (messagesData: any) => {
      const messages = messagesData?.messages || [];
      console.log('[WA] 📬 messages.set event received (message history):', {
        messagesCount: messages.length,
        businessId
      });
      
      if (messages.length === 0) return;
      
      // Process each historical message using the same logic as messages.upsert
      // Reuse the message processing logic from messages.upsert handler
      for (const msg of messages) {
        // Skip status updates (WhatsApp stories)
        const remoteJid = msg.key?.remoteJid || '';
        if (remoteJid === 'status@broadcast' || remoteJid.endsWith('@broadcast')) {
          continue;
        }
        if (remoteJid.endsWith('@newsletter')) {
          continue;
        }

        // Use the same processing logic as messages.upsert
        // We'll extract this into a shared function to avoid duplication
        try {
          const isFromMe = msg.key?.fromMe === true;
          if (!msg.message) continue;

          const extracted = await extractMessageContent(msg);
          if (extracted.skip) continue;
          const { messageText, messageType, mediaUrl } = crmFieldsFromExtracted(extracted);
          if (!String(messageText || '').trim() && !extracted.hasMedia) continue;
          if (extracted.hasMedia && !String(extracted.text || '').trim()) {
            console.log('[WA] 📬 messages.set: saving media (previously empty text)', { messageId: msg.key?.id, messageType });
          }
          console.log('[WA] 📬 messages.set: parsed', { messageId: msg.key?.id, messageType, hasMedia: extracted.hasMedia });

          const mCtx = normalizeMessage(msg.message) || {};
          
          const remoteJid = msg.key?.remoteJid || '';
          const participant = msg.key?.participant || '';
          const remoteJidAlt = msg.key?.remoteJidAlt || '';
          const participantAlt = msg.key?.participantAlt || '';
          const messageId = msg.key?.id || '';
          
          if (!remoteJid || !messageId) continue;

          const messagesSetTs = getTimestamp(msg);
          
          const isGroup = remoteJid.endsWith('@g.us');
          let fromNumber: string = '';
          let groupName: string | undefined;
          let groupJid: string | undefined;
          let senderJid: string = '';
          
          if (isGroup) {
            groupJid = remoteJid;
            if (isFromMe) {
              const businessPhone = sessionRecord.phoneNumber || '';
              fromNumber = businessPhone;
              senderJid = `${businessPhone}@s.whatsapp.net`;
            } else if (participant) {
              const actualParticipantJid = participant.endsWith('@lid') && participantAlt 
                ? participantAlt 
                : participant;
              senderJid = actualParticipantJid;
              fromNumber = extractPhoneFromJid(actualParticipantJid);
              if (!fromNumber) {
                fromNumber = 'unknown';
                senderJid = participant;
              }
            } else {
              fromNumber = 'unknown';
              senderJid = remoteJid;
            }
            
            if (groupMetadataCache.has(remoteJid)) {
              groupName = groupMetadataCache.get(remoteJid) || 'Group Chat';
            } else {
              try {
                const groupMetadata = await socket.groupMetadata(remoteJid);
                groupName = groupMetadata.subject || 'Unknown Group';
                groupMetadataCache.set(remoteJid, groupName);
              } catch (err) {
                groupName = groupMetadataCache.get(remoteJid) || 'Group Chat';
              }
            }
          } else {
            const actualRemoteJid = remoteJid.endsWith('@lid') && remoteJidAlt 
              ? remoteJidAlt 
              : remoteJid;
            senderJid = actualRemoteJid;
            fromNumber = extractPhoneFromJid(actualRemoteJid);
            if (!fromNumber) continue;
          }
          
          if (!fromNumber) continue;
          
          const businessPhone = sessionRecord.phoneNumber || '';
          
          // Process message (same as messages.upsert) — queue or direct fallback
            try {
              if (isFromMe) {
                const conversationIdStr = isGroup ? (groupJid || remoteJid) : fromNumber;
                const normalizedRecipient = fromNumber;
                await addWhatsAppMessageJob({
                  type: 'outgoing',
                  sub: 'messages-set',
                  businessId,
                  messageId,
                  conversationId: conversationIdStr,
                  timestamp: Date.now(),
                  isGroup: !!isGroup,
                  businessPhone,
                  messageText,
                  messageType,
                  mediaUrl,
                  sourceTimestampSec: messagesSetTs,
                  originalWaTimestampSec: getOriginalWaTimestampSecOrNull(msg),
                  recipientJid: senderJid,
                  conversationIdStr,
                  normalizedRecipient,
                  groupName,
                  groupJid,
                  remoteJid,
                  remoteJidAlt: msg.key?.remoteJidAlt || undefined
                });
              } else {
                const _lhCtx =
                  (mCtx as any)?.extendedTextMessage?.contextInfo ||
                  (mCtx as any)?.imageMessage?.contextInfo ||
                  (mCtx as any)?.videoMessage?.contextInfo ||
                  (mCtx as any)?.documentMessage?.contextInfo ||
                  {};
                const whatsappDisplayName =
                  msg.pushName ||
                  (msg as any).notifyName ||
                  _lhCtx?.pushName ||
                  undefined;
                const convKeySet = isGroup ? (groupJid || remoteJid) : fromNumber;

                await addWhatsAppMessageJob({
                  type: 'incoming',
                  sub: 'messages-set',
                  businessId,
                  messageId,
                  conversationId: convKeySet,
                  timestamp: Date.now(),
                  enableBotReply: false,
                  senderJid,
                  businessPhone,
                  messageText,
                  messageType,
                  mediaUrl,
                  isGroup: !!isGroup,
                  groupName,
                  groupJid,
                  whatsappDisplayName,
                  sourceTimestampSec: messagesSetTs,
                  originalWaTimestampSec: getOriginalWaTimestampSecOrNull(msg),
                  fromNumber
                });
              }
            } catch (err) {
              console.error('[WA] Error processing historical message:', err);
            }
        } catch (err) {
          console.error('[WA] Error processing messages.set:', err);
        }
      }
    });
    
    socket.ev.on('message-receipt.update', (receipts: any) => {
      console.log('[WA] ✅ Message receipt update:', {
        receiptCount: Array.isArray(receipts) ? receipts.length : 1,
        businessId
      });
    });
    
    console.log(`[WA] ✅ All message event listeners attached for business ${businessId}`);
  } catch (err) {
    console.error(`[WA] ❌ Error attaching additional message listeners:`, err);
  }
}

// Presence + stale-activity health: @/lib/whatsapp-connection-manager (20s presence, 30s health)

/**
 * Initialize or retrieve an active WhatsApp socket
 * CRITICAL: Only creates socket if necessary, never destroys valid sockets
 */
export async function getWhatsAppSocket(businessId: string, options?: { syncFullHistory?: boolean }): Promise<SessionRecord> {
  WACM.registerBusiness(businessId);

  // Step 1: Check if valid session exists
  const existingSession = sessions.get(businessId);
  
  if (existingSession) {
    // Check if socket is valid
    if (isSocketValid(existingSession.socket)) {
      // Socket is valid, return existing session
      // Ensure listener is attached
      if (existingSession.socket && !existingSession.listenerAttached) {
        attachMessageListener(existingSession.socket, businessId, existingSession);
      }
      return existingSession;
    } else {
      // Socket is invalid (closed), but don't delete session during restart
      // Just clear the socket reference - the session record will be reused
      console.log(`[WA] Invalid socket detected for ${businessId}, clearing socket reference for reuse`);
      if (existingSession.reconnectTimer) {
        clearTimeout(existingSession.reconnectTimer);
        existingSession.reconnectTimer = undefined;
      }
      if (existingSession.healthCheckTimer) {
        clearTimeout(existingSession.healthCheckTimer);
        existingSession.healthCheckTimer = undefined;
      }
      if (existingSession.keepAliveTimer) {
        clearTimeout(existingSession.keepAliveTimer);
        existingSession.keepAliveTimer = undefined;
      }
      if (existingSession.authStateSaveTimer) {
        clearTimeout(existingSession.authStateSaveTimer);
        existingSession.authStateSaveTimer = undefined;
      }
      if (existingSession.socket) {
        try {
          existingSession.socket.ws?.close();
        } catch (e) {
          // Ignore errors during cleanup
        }
        existingSession.socket = undefined;
      }
      // Don't delete the session - keep it so DB status stays consistent
      // Mark as disconnected temporarily - new socket will update status once connected
      existingSession.status = 'disconnected';
      existingSession.listenerAttached = false; // Reset listener flag
      // Reuse this session record - don't create a new one
      // sessionRecord will be assigned below
    }
  }
  
  // CRITICAL: Prevent concurrent socket creation
  // If another call is already creating a socket, wait for it to finish
  if (creatingSockets.has(businessId)) {
    console.log(`[WA] Socket creation already in progress for ${businessId}, waiting...`);
    // Wait up to 10 seconds for the other creation to complete
    for (let i = 0; i < 50; i++) {
      await new Promise(resolve => setTimeout(resolve, 200));
      const session = sessions.get(businessId);
      if (session && isSocketValid(session.socket)) {
        console.log(`[WA] Socket created by another call for ${businessId}, returning it`);
        if (session.socket && !session.listenerAttached) {
          attachMessageListener(session.socket, businessId, session);
        }
        return session;
      }
      if (!creatingSockets.has(businessId)) {
        // Creation finished (or failed), break and try again
        break;
      }
    }
    // If we waited too long, check one more time
    const session = sessions.get(businessId);
    if (session && isSocketValid(session.socket)) {
      if (session.socket && !session.listenerAttached) {
        attachMessageListener(session.socket, businessId, session);
      }
      return session;
    }
    // If still not ready, proceed to create (might have failed)
    console.log(`[WA] Wait timeout for ${businessId}, proceeding with creation`);
  }
  
  // Mark that we're creating a socket
  creatingSockets.add(businessId);
  
  // Step 2: Get or create session record (declare outside try so it's accessible after finally)
  let sessionRecord: SessionRecord;
  const existingSessionForReuse = sessions.get(businessId);
  if (existingSessionForReuse) {
    // Reuse existing session record (socket was cleared above if invalid)
    sessionRecord = existingSessionForReuse;
  } else {
    // Create new session record (no existing session to reuse)
    sessionRecord = {
      status: 'disconnected',
      retryCount: 0,
      listenerAttached: false
    };
    sessions.set(businessId, sessionRecord);
  }
  
  // Step 3: Load auth state and create socket
  let sock: any;
  try {
    const { state, saveCreds, saveCredsImmediate } = await usePostgresAuthState(businessId);
    const { version } = await fetchLatestBaileysVersion();

    console.log(`[WA] Creating socket for ${businessId}...`);

    // Create simple in-memory store for messages, chats, and contacts
    // This is REQUIRED for sock.store.messages to be available
    // Baileys doesn't provide makeInMemoryStore in this version, so we create it manually
    const store: any = {
      chats: {},
      contacts: {},
      messages: {},
      bindToEv: (ev: any) => {
        // Listen to events and populate store
        ev.on('messaging-history.set', (data: any) => {
          console.log(`[Store] messaging-history.set received:`, {
            hasChats: !!data.chats,
            hasContacts: !!data.contacts,
            hasMessages: !!data.messages,
            messagesType: Array.isArray(data.messages) ? 'array' : typeof data.messages,
            messagesLength: Array.isArray(data.messages) ? data.messages.length : Object.keys(data.messages || {}).length
          });
          
          if (data.chats) store.chats = data.chats;
          if (data.contacts) store.contacts = data.contacts;
          
          // CRITICAL: messages from messaging-history.set is an ARRAY, we need to organize by JID
          if (data.messages) {
            if (Array.isArray(data.messages)) {
              // Messages is an array - organize by JID
              for (const msg of data.messages) {
                const jid = msg.key?.remoteJid;
                if (jid) {
                  if (!store.messages[jid]) {
                    store.messages[jid] = [];
                  }
                  // Check if message already exists
                  const exists = store.messages[jid].some((m: any) => 
                    m.key?.id === msg.key?.id
                  );
                  if (!exists) {
                    store.messages[jid].push(msg);
                  }
                }
              }
              
              const jidsWithMessages = Object.keys(store.messages);
              console.log(`[Store] ✅ Organized ${data.messages.length} messages into ${jidsWithMessages.length} conversations`);
              console.log(`[Store] 📋 Sample JIDs in store:`, jidsWithMessages.slice(0, 10));
              console.log(`[Store] 📊 Messages per conversation (first 5):`, jidsWithMessages.slice(0, 5).map(jid => ({ 
                jid, 
                count: store.messages[jid].length 
              })));
            } else {
              // Already organized by JID
              store.messages = data.messages;
            }
          }
        });
        
        // Baileys v6+ does not emit `chats.set`; the chat list comes from these (see @whiskeysockets/baileys event-buffer)
        ev.on('chats.set', (chats: any) => {
          if (chats) store.chats = chats;
        });

        const mergeChatsObject = (list: any[]) => {
          if (!Array.isArray(list) || list.length === 0) return;
          if (!store.chats || typeof store.chats !== 'object') store.chats = {} as any;
          const m = store.chats as Record<string, any>;
          for (const chat of list) {
            const id = chat?.id;
            if (!id) continue;
            const prev = m[id];
            m[id] = prev ? { ...prev, ...chat } : { ...chat };
          }
        };

        ev.on('chats.upsert', (list: any) => {
          const arr = Array.isArray(list) ? list : list ? [list] : [];
          mergeChatsObject(arr);
        });

        ev.on('chats.update', (list: any) => {
          const arr = Array.isArray(list) ? list : list ? [list] : [];
          if (!store.chats || typeof store.chats !== 'object') store.chats = {} as any;
          const m = store.chats as Record<string, any>;
          for (const partial of arr) {
            const id = partial?.id;
            if (!id) continue;
            m[id] = m[id] ? { ...m[id], ...partial } : { ...partial };
          }
        });

        ev.on('chats.delete', (ids: any) => {
          const list = Array.isArray(ids) ? ids : ids ? [ids] : [];
          if (!store.chats || typeof store.chats !== 'object') return;
          const m = store.chats as Record<string, any>;
          for (const id of list) {
            if (id) delete m[id];
          }
        });
        
        ev.on('contacts.set', (contacts: any) => {
          store.contacts = contacts;
        });
        
        ev.on('messages.set', (data: any) => {
          // messages.set can be called with { messages: [...], isLatest: bool }
          const messages = data.messages || data;
          
          console.log(`[Store] messages.set received:`, {
            isArray: Array.isArray(messages),
            type: typeof messages,
            length: Array.isArray(messages) ? messages.length : Object.keys(messages || {}).length,
            hasMessagesField: !!data.messages,
            isLatest: data.isLatest
          });
          
          // CRITICAL: messages.set also provides an ARRAY
          if (Array.isArray(messages)) {
            // Organize by JID
            let organized = 0;
            for (const msg of messages) {
              const jid = msg.key?.remoteJid;
              if (jid) {
                if (!store.messages[jid]) {
                  store.messages[jid] = [];
                }
                const exists = store.messages[jid].some((m: any) => 
                  m.key?.id === msg.key?.id
                );
                if (!exists) {
                  store.messages[jid].push(msg);
                  organized++;
                }
              }
            }
            const jidsWithMessages = Object.keys(store.messages);
            console.log(`[Store] ✅ messages.set: Organized ${organized} messages into ${jidsWithMessages.length} conversations`);
            console.log(`[Store] 📋 Sample JIDs:`, jidsWithMessages.slice(0, 10));
          } else if (messages && typeof messages === 'object') {
            store.messages = messages;
            console.log(`[Store] ✅ messages.set: Replaced store with object containing ${Object.keys(messages).length} JIDs`);
          }
        });
        
        ev.on('messages.upsert', (data: any) => {
          const messages = data.messages || data;
          if (!Array.isArray(messages)) return;
          
          for (const msg of messages) {
            const jid = msg.key?.remoteJid;
            if (jid) {
              if (!store.messages[jid]) {
                store.messages[jid] = [];
              }
              // Check if message already exists
              const exists = store.messages[jid].some((m: any) => 
                m.key?.id === msg.key?.id
              );
              if (!exists) {
                store.messages[jid].push(msg);
                // Cap per-JID memory (default 5000) so scroll-back can stay in memory; override via env.
                const cap = Math.min(
                  50_000,
                  Math.max(200, Number(process.env.WHATSAPP_STORE_MAX_MESSAGES_PER_CHAT) || 5000)
                );
                if (store.messages[jid].length > cap) {
                  store.messages[jid] = store.messages[jid].slice(-cap);
                }
              }
            }
          }
        });
      }
    };

    // Create socket using STANDARD BAILEYS (stable, no _c errors)
    // We use standard Baileys for connection management, QR, listening, and regular messages
    // baileys-pro is ONLY used for sending interactive button messages (via helper function)
    // Check if we should sync full history (from options or session record flag)
    const shouldSyncFullHistory = options?.syncFullHistory || sessionRecord.syncFullHistory || false;
    
    sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: 'warn' }),
      browser: ['Khatario', 'Chrome', '1.0'],
      connectTimeoutMs: 60000,
      syncFullHistory: shouldSyncFullHistory, // Enable full history sync if requested
      shouldSyncHistoryMessage: (msg: any) => {
        // Allow syncing messages that we might have missed
        // This enables Baileys to sync messages from WhatsApp when they come through
        // Our message listener will process and save them to the database
        return true;
      },
      generateHighQualityLinkPreview: true,
      markOnlineOnConnect: false,
      retryRequestDelayMs: 250,
      maxMsgRetryCount: 5,
      defaultQueryTimeoutMs: 60000,
      keepAliveIntervalMs: 30000,
      fireInitQueries: true, // Standard Baileys handles this correctly
      /**
       * Baileys needs this to resolve message bodies for retry/decrypt flows
       * (e.g. send retry, event responses, “message not found” during processing).
       * Return the inner `proto.IMessage` from our in-memory store, keyed like WhatsApp (with JID normalisation).
       */
      getMessage: async (key: { remoteJid?: string | null; id?: string | null; fromMe?: boolean | null }) => {
        const remoteJid = key?.remoteJid || '';
        const id = key?.id || '';
        if (!remoteJid || !id) {
          console.warn(`[WA] getMessage: missing key (businessId=${businessId})`, {
            remoteJid: key?.remoteJid,
            id: key?.id,
          });
          return undefined;
        }
        try {
          const storeKey = findStoreMessageJidKey(store.messages, remoteJid);
          const list = store.messages[storeKey] as any[] | undefined;
          if (!Array.isArray(list) || list.length === 0) {
            console.warn(`[WA] getMessage: no store bucket for JID (businessId=${businessId})`, {
              remoteJid,
              storeKey,
              id,
            });
            return undefined;
          }
          const byId = (m: any) => m?.key?.id === id;
          const withFromMe =
            key.fromMe === undefined || key.fromMe === null
              ? list.find(byId)
              : list.find((m: any) => m?.key?.id === id && m?.key?.fromMe === key.fromMe) || list.find(byId);
          const wa = withFromMe;
          if (wa?.message) {
            console.log(`[WA] getMessage: hit (businessId=${businessId})`, {
              remoteJid,
              storeKey,
              id,
              fromMe: key.fromMe,
            });
            return wa.message;
          }
          console.warn(`[WA] getMessage: miss — id not in store (businessId=${businessId})`, {
            remoteJid,
            storeKey,
            id,
            fromMe: key.fromMe,
            bucketSize: list.length,
          });
          return undefined;
        } catch (e) {
          console.error(`[WA] getMessage: error (businessId=${businessId})`, e);
          return undefined;
        }
      },
    });

    // Load persisted store from file if exists (like WhatsApp Web's IndexedDB)
    const storeFilePath = path.join(process.cwd(), 'whatsapp-data', `store-${businessId}.json`);
    try {
      if (fs.existsSync(storeFilePath)) {
        const storedData = JSON.parse(fs.readFileSync(storeFilePath, 'utf-8'));
        store.chats = storedData.chats || {};
        store.contacts = storedData.contacts || {};
        store.messages = storedData.messages || {};
        console.log(`[WA] 📂 Loaded persisted store from file:`, {
          chats: Object.keys(store.chats).length,
          messages: Object.keys(store.messages).length,
          file: storeFilePath
        });
      }
    } catch (err) {
      console.warn(`[WA] ⚠️ Failed to load persisted store, starting fresh:`, err);
    }
    
    // Bind store to socket events AFTER socket creation
    // This populates the store automatically when events fire (chats.set, messages.upsert, etc.)
    console.log(`[WA] 📚 Binding store to socket events for ${businessId}...`);
    store.bindToEv(sock.ev);
    WACM.bindActivityProbes(businessId, sock.ev);
    
    // Attach store to socket so it's accessible via sock.store
    sock.store = store;
    
    // Save store to file periodically (like WhatsApp Web saves to IndexedDB)
    const saveStore = () => {
      try {
        const storeDir = path.dirname(storeFilePath);
        if (!fs.existsSync(storeDir)) {
          fs.mkdirSync(storeDir, { recursive: true });
        }
        fs.writeFileSync(storeFilePath, JSON.stringify({
          chats: store.chats,
          contacts: store.contacts,
          messages: store.messages
        }, null, 2));
        console.log(`[WA] 💾 Store persisted to file for ${businessId}`);
      } catch (err) {
        console.error(`[WA] ❌ Failed to persist store:`, err);
      }
    };
    
    // Save every 60 seconds (like WhatsApp Web auto-saves)
    const storeSaveInterval = setInterval(saveStore, 60000);
    
    // Clean up interval on disconnect
    sock.ev.on('connection.update', (update: any) => {
      if (update.connection === 'close') {
        clearInterval(storeSaveInterval);
        saveStore(); // Final save on disconnect
      }
    });
    
    console.log(`[WA] ✅ Store bound successfully. Auto-save enabled every 60s.`);
    
    console.log(`[WA] Socket created for ${businessId}, store initialized, attaching event handlers...`);
    sessionRecord.socket = sock;

    // CRITICAL: Attach connection update handler FIRST, IMMEDIATELY after socket creation
    // This must be done synchronously BEFORE any other handlers to catch early events
    // Some connection events fire immediately during socket initialization
    sock.ev.on('connection.update', async (update: any) => {
      const { connection, lastDisconnect, qr } = update;
      
      // Log all connection updates for debugging (but only key ones to avoid spam)
      if (qr || connection === 'open' || connection === 'close') {
        console.log(`[WA] connection.update for ${businessId}:`, { connection, hasQR: !!qr, hasLastDisconnect: !!lastDisconnect });
      }

      // Handle QR code generation
      // CRITICAL: Only update QR if it's different from the current one
      // This prevents multiple QR regenerations that invalidate the current QR code
      if (qr) {
        // Don't regenerate QR if we already have one and it's been less than 20 seconds since last generation
        // This prevents rapid QR regeneration that breaks mobile scanning
        const now = Date.now();
        const timeSinceLastQR = sessionRecord.lastQRGeneratedAt 
          ? now - sessionRecord.lastQRGeneratedAt 
          : Infinity;
        
        // If QR is the same, ignore it
        if (sessionRecord.qr === qr) {
          console.log(`[WA] Received duplicate QR code for ${businessId}, ignoring`);
          return;
        }
        
        // If we already have a QR code and it's been less than 40 seconds since last generation,
        // don't update (QR codes typically last 60 seconds, we want to keep the current one)
        // This prevents rapid QR regeneration that causes mobile WhatsApp to fail scanning
        if (sessionRecord.status === 'pending_qr' && sessionRecord.qr && timeSinceLastQR < 40000) {
          console.log(`[WA] QR already exists for ${businessId}, ignoring new QR to prevent breaking scan (${Math.round(timeSinceLastQR/1000)}s since last, QR codes last ~60s)`);
          return;
        }
        
        console.log(`[WA] QR generated for ${businessId}${sessionRecord.qr ? ` (replacing QR from ${Math.round(timeSinceLastQR/1000)}s ago)` : ''}`);
        sessionRecord.status = 'pending_qr';
        sessionRecord.qr = qr;
        sessionRecord.lastQRGeneratedAt = now;
        
        await db.query(`
          UPDATE whatsapp_sessions 
          SET status = 'pending_qr', last_qr = $2, last_error = NULL, updated_at = CURRENT_TIMESTAMP 
          WHERE business_id = $1
        `, [businessId, qr]);
        invalidateStatusCache(businessId);
      }

    // Handle connection open
    if (connection === 'open') {
      console.log(`[WA] Connection OPEN for ${businessId}`);
      
      try {
        // Standard Baileys doesn't have the _c error, so we don't need long waits
        // Just wait a short time to ensure socket is fully initialized
        const connectionStartTime = Date.now();
        sessionRecord.connectionOpenedAt = connectionStartTime;
        
        // Small delay to ensure socket is fully ready (standard Baileys is stable)
        await new Promise(resolve => setTimeout(resolve, 2000)); // 2 seconds should be enough
          
        // Verify connection is still valid and user is authenticated
        console.log(`[WA] Validating connection for ${businessId}:`, {
          socketValid: isSocketValid(sock),
          hasUser: !!sock.user,
          userJid: sock.user?.id,
          wsState: sock.ws ? {
            isClosed: sock.ws.isClosed,
            isClosing: sock.ws.isClosing,
            readyState: sock.ws.readyState
          } : 'no ws'
        });
        
        if (!isSocketValid(sock)) {
          console.warn(`[WA] Connection opened but socket is invalid for ${businessId}, ignoring`);
          return;
        }
        
        const userJid = sock.user?.id;
        if (!userJid) {
          console.warn(`[WA] Connection opened but user not authenticated yet for ${businessId}, waiting...`);
          // Don't mark as connected yet - wait for user to be set
          return;
        }
        
        // Additional check: Verify socket is actually ready for messaging
        // If socket was closed during the wait, don't mark as connected
        if (sock.ws?.isClosed || sock.ws?.isClosing) {
          console.warn(`[WA] Connection opened but socket closed during wait for ${businessId}, ignoring`);
          return;
        }
        
        const phoneNumber = userJid.split(':')[0];
        const waitDuration = Math.round((Date.now() - connectionStartTime) / 1000);
        
        console.log(`[WA] ✅ Connection fully authenticated for ${businessId}, phone: ${phoneNumber}`);
        console.log(`[WA] Connection is ready for messaging after ${waitDuration}s wait (using stable standard Baileys)`);
        
        // Final validation before marking as connected
        // Check socket is still valid and stable
        if (!isSocketValid(sock) || sock.ws?.isClosed || sock.ws?.isClosing) {
          console.error(`[WA] ⚠️ Socket became invalid/unstable during wait - not marking as connected for ${businessId}`);
          return;
        }
        
        // History sync can be extremely noisy (messaging-history.set floods + media fetch failures).
        // We only want to sync when the user explicitly clicks "Sync Messages".
        const autoHistory = String(process.env.WHATSAPP_AUTO_HISTORY_SYNC || '').toLowerCase();
        const autoHistoryEnabled = autoHistory === '1' || autoHistory === 'true' || autoHistory === 'yes';
        if (autoHistoryEnabled) {
          console.log(`[WA] 📚 Auto history sync enabled (WHATSAPP_AUTO_HISTORY_SYNC). Checking store...`);
          setTimeout(async () => {
            try {
              const chatJids = sock.store?.chats ? Object.keys(sock.store.chats) : [];
              console.log(`[WA] 📚 Auto-sync: store currently has ${chatJids.length} chats`);
            } catch (err) {
              console.error(`[WA] ⚠️ Auto-sync setup error:`, err);
            }
          }, 5000);
        } else {
          console.log(
            `[WA] 📚 Auto history sync disabled. Use "Sync Messages" button to fetch history (set WHATSAPP_AUTO_HISTORY_SYNC=1 to re-enable).`
          );
        }
          
        // Mark as connected BEFORE saving to DB - this ensures UI updates quickly
        sessionRecord.status = 'connected';
        sessionRecord.qr = undefined; // Clear QR when connected
        sessionRecord.retryCount = 0;
        sessionRecord.phoneNumber = phoneNumber;
        
        // Clear any reconnect timer
        if (sessionRecord.reconnectTimer) {
          clearTimeout(sessionRecord.reconnectTimer);
          sessionRecord.reconnectTimer = undefined;
        }

        // CRITICAL: Force save creds immediately to persist successful connection state
        // This ensures the auth state is saved to DB without waiting for debounce
        // This prevents state loss if connection drops shortly after opening
        try {
          await saveCredsImmediate();
          console.log(`[WA] Credentials saved immediately after connection for ${businessId}`);
        } catch (saveError) {
          console.error(`[WA] Failed to save creds immediately for ${businessId}:`, saveError);
          // Don't fail the connection if creds save fails - debounced save will handle it
        }

        // Attach message listener if not already attached
        attachMessageListener(sock, businessId, sessionRecord);

        WACM.onConnectionOpen(businessId, {
          getSocket: () => sessions.get(businessId)?.socket,
          isSocketValid,
          reconnect: async () => {
            WACM.onConnectionClosed(businessId, { reason: 'stale_or_dead', message: 'health' });
            const s = sessions.get(businessId);
            if (s) {
              try {
                s.socket?.ws?.close();
                (s.socket as { end?: () => void } | undefined)?.end?.();
              } catch { /* */ }
              s.socket = undefined;
              s.listenerAttached = false;
              s.status = 'disconnected';
            }
            await getWhatsAppSocket(businessId);
          }
        });

        // Update database status - use try/catch to prevent DB errors from affecting connection
        try {
          await db.query(`
            UPDATE whatsapp_sessions 
            SET status = 'connected', last_qr = NULL, phone_number = $2, last_error = NULL, updated_at = CURRENT_TIMESTAMP 
            WHERE business_id = $1
          `, [businessId, phoneNumber]);
          invalidateStatusCache(businessId);
          console.log(`[WA] Database status updated to 'connected' for ${businessId}`);
        } catch (dbError) {
          console.error(`[WA] Failed to update DB status for ${businessId}:`, dbError);
          // Don't fail the connection if DB update fails - in-memory status is still correct
        }
      } catch (openError) {
        // Catch any errors during connection open handling
        console.error(`[WA] Error during connection open handling for ${businessId}:`, openError);
        // Don't mark as disconnected - the connection might still be valid
        // Let the connection close handler deal with it if needed
      }
    }

    // Handle connection close
    if (connection === 'close') {
      const reason = (lastDisconnect?.error as any)?.output?.statusCode;
      const error = lastDisconnect?.error;
      const errorMessage = error?.message || String(error || '');
      const wasPendingQR = sessionRecord.status === 'pending_qr';
      
      // Check if connection closed shortly after opening (indicates init query failure)
      const timeSinceOpen = sessionRecord.connectionOpenedAt 
        ? Date.now() - sessionRecord.connectionOpenedAt 
        : Infinity;
      const closedQuickly = timeSinceOpen < 10000; // Closed within 10 seconds of opening
      
      console.log(`[WA] Connection CLOSED for ${businessId}. Reason: ${reason}, Error: ${errorMessage}${closedQuickly ? ` (closed ${Math.round(timeSinceOpen/1000)}s after opening - possible init query failure)` : ''}`);

      WACM.onConnectionClosed(businessId, { reason, message: errorMessage });
      
      // If connection closed quickly after opening, it might be due to init query error
      // Don't immediately mark as logged out - try to reconnect
      if (closedQuickly && reason !== DisconnectReason.loggedOut && reason !== 401) {
        console.log(`[WA] Connection closed quickly - likely due to init query error. Will attempt to reconnect.`);
        // Don't mark as logged out, allow retry logic to handle it
      }

      // Stop health check on disconnect
      if (sessionRecord.healthCheckTimer) {
        clearTimeout(sessionRecord.healthCheckTimer);
        sessionRecord.healthCheckTimer = undefined;
      }
      
      // Stop keep-alive ping on disconnect
      if (sessionRecord.keepAliveTimer) {
        clearTimeout(sessionRecord.keepAliveTimer);
        sessionRecord.keepAliveTimer = undefined;
      }
      
      // Stop periodic auth save on disconnect
      if (sessionRecord.authStateSaveTimer) {
        clearTimeout(sessionRecord.authStateSaveTimer);
        sessionRecord.authStateSaveTimer = undefined;
      }

      // Case 1: Logged Out (Explicitly or by phone)
      if (reason === DisconnectReason.loggedOut) {
        console.log(`[WA] Logged out. Clearing session.`);
        WACM.onLoggedOut(businessId);
        if (sessionRecord.reconnectTimer) {
          clearTimeout(sessionRecord.reconnectTimer);
        }
        sessions.delete(businessId);
        await db.query(`
          UPDATE whatsapp_sessions 
          SET status = 'disconnected', auth_state = NULL, last_qr = NULL, phone_number = NULL, 
              last_error = 'Logged out', updated_at = CURRENT_TIMESTAMP 
          WHERE business_id = $1
        `, [businessId]);
        return;
      }

      // Case 2: Connection Replaced (440) - Multi-device conflict
      if (reason === 440) { // DisconnectReason.connectionReplaced
        console.log(`[WA] Connection replaced (Conflict). Another session opened.`);
        WACM.onLoggedOut(businessId);
        if (sessionRecord.reconnectTimer) {
          clearTimeout(sessionRecord.reconnectTimer);
        }
        sessions.delete(businessId);
        await db.query(`
          UPDATE whatsapp_sessions 
          SET status = 'disconnected', last_error = 'Connection replaced by another session', updated_at = CURRENT_TIMESTAMP 
          WHERE business_id = $1
        `, [businessId]);
        invalidateStatusCache(businessId);
        return;
      }

      // Case 3: QR Timeout (408) or QR attempts ended
      // CRITICAL: Don't retry, don't recreate socket - user must manually reconnect
      if (reason === 408 || errorMessage.includes('QR refs attempts ended') || 
          errorMessage.includes('QR code expired') || errorMessage.includes('expired')) {
        console.log(`[WA] QR code expired or timeout. Stopping retries. User must manually reconnect.`);
        if (sessionRecord.reconnectTimer) {
          clearTimeout(sessionRecord.reconnectTimer);
        }
        // Keep session record but mark as disconnected
        sessionRecord.status = 'disconnected';
        WACM.onLoggedOut(businessId);
        // Don't delete session - keep QR for frontend to show expired state
        await db.query(`
          UPDATE whatsapp_sessions 
          SET status = 'disconnected', 
              last_error = 'QR code expired. Please click Connect again to generate a new QR code.', 
              updated_at = CURRENT_TIMESTAMP 
          WHERE business_id = $1
        `, [businessId]);
        invalidateStatusCache(businessId);
        return;
      }

      // Case 4: Restart Required (check BEFORE other pending_qr checks)
      // Handle both the constant and explicit error codes/messages
      // Error 515 = "Stream Errored (restart required)" - common after QR generation
      // IMPORTANT: If we just generated a QR and got error 515, wait longer before restarting
      // to avoid regenerating QR codes too quickly
      if (reason === DisconnectReason.restartRequired || 
          reason === 515 || 
          errorMessage.includes('restart required') || 
          errorMessage.includes('Stream Errored')) {
        console.log(`[WA] Restart required (reason: ${reason}, wasPendingQR: ${wasPendingQR}). Retrying...`);
        
        // Clear reconnect timer if exists
        if (sessionRecord.reconnectTimer) {
          clearTimeout(sessionRecord.reconnectTimer);
        }
        
        // If we have a pending QR and just got error 515, wait a bit longer before restarting
        // This prevents rapid QR regeneration that breaks mobile scanning
        // Also increase delay if connection closed quickly after opening (init query failure)
        const closedQuickly = sessionRecord.connectionOpenedAt 
          ? Date.now() - sessionRecord.connectionOpenedAt < 10000 
          : false;
        const restartDelay = closedQuickly ? 5000 : (wasPendingQR && sessionRecord.qr ? 3000 : 1000);
        
        if (wasPendingQR && sessionRecord.qr) {
          console.log(`[WA] QR exists, waiting ${restartDelay}ms before restart to avoid breaking scan`);
        } else if (closedQuickly) {
          console.log(`[WA] Connection closed quickly after opening, waiting ${restartDelay}ms before restart (likely init query issue)`);
        }
        
        // For restartRequired, don't delete the session from memory - just mark as connecting
        // This prevents the DB from showing 'connected' while in-memory session is missing
        // The new socket creation will reuse the session record
        sessionRecord.status = 'disconnected'; // Mark as disconnected temporarily
        sessionRecord.socket = undefined; // Clear socket reference
        
        // Clean up the current socket (for restartRequired, use ws.close to avoid extra lifecycle noise)
        // Don't delete from memory - let the new socket reuse the session record
        try {
          // For restartRequired, close websocket directly to avoid triggering extra connection.close events
          const oldSocket = sessionRecord.socket;
          if (oldSocket) {
            oldSocket.ws?.close();
          }
        } catch (e) {
          // Ignore cleanup errors
        }
        
        // Don't update DB status during restart - keep it as 'connected' if it was connected
        // This prevents the "connected in DB but disconnected in memory" race condition
        // The new socket will update the status once it connects
        
        // Retry after delay (longer if we have a QR to give user time to scan)
        setTimeout(() => {
          getWhatsAppSocket(businessId).catch(err => {
            console.error('[WA] Error during restart retry:', err);
          });
        }, restartDelay);
        return;
      }

      // Case 5: If we were waiting for QR and got disconnected (non-restart error)
      if (wasPendingQR) {
        console.log(`[WA] Disconnected while waiting for QR scan. Stopping retries. User must manually reconnect.`);
        WACM.onLoggedOut(businessId);
        if (sessionRecord.reconnectTimer) {
          clearTimeout(sessionRecord.reconnectTimer);
        }
        sessionRecord.status = 'disconnected';
        await db.query(`
          UPDATE whatsapp_sessions 
          SET status = 'disconnected', last_qr = NULL, 
              last_error = 'Connection lost. Please click Connect again.', 
              updated_at = CURRENT_TIMESTAMP 
          WHERE business_id = $1
        `, [businessId]);
        invalidateStatusCache(businessId);
        return;
      }

      if (sessionRecord.reconnectTimer) {
        clearTimeout(sessionRecord.reconnectTimer);
        sessionRecord.reconnectTimer = undefined;
      }

      // Remaining closes: use Baileys disconnect code — reconnect except logged out (already returned)
      const shouldReconnect = reason !== DisconnectReason.loggedOut;
      if (shouldReconnect) {
        const credRow = await db.queryOne<{ auth_state: unknown }>(
          `SELECT auth_state FROM whatsapp_sessions WHERE business_id = $1`,
          [businessId]
        );
        if (credRow?.auth_state) {
          sessionRecord.socket = undefined;
          sessionRecord.listenerAttached = false;
          sessionRecord.status = 'disconnected';
          sessionRecord.retryCount = 0;
          try {
            await db.query(
              `UPDATE whatsapp_sessions 
              SET status = 'disconnected', 
                  last_error = $2, 
                  updated_at = CURRENT_TIMESTAMP 
              WHERE business_id = $1`,
              [
                businessId,
                `Connection lost (code: ${String(reason)}). Reconnecting with backoff…`
              ]
            );
            invalidateStatusCache(businessId);
          } catch (e) {
            console.error(`[WA] DB update on disconnect:`, e);
          }
          WACM.scheduleReconnectWithBackoff(businessId, () => getWhatsAppSocket(businessId), { reason });
          return;
        }
      }

      console.log(`[WA] No auth in DB for ${businessId} — not auto-reconnecting.`);
      if (sessionRecord.reconnectTimer) {
        clearTimeout(sessionRecord.reconnectTimer);
        sessionRecord.reconnectTimer = undefined;
      }
      sessions.delete(businessId);
      await db.query(
        `UPDATE whatsapp_sessions 
         SET status = 'disconnected', 
             last_error = 'Not connected. Scan QR or open WhatsApp worker with stored session.', 
             updated_at = CURRENT_TIMESTAMP 
         WHERE business_id = $1`,
        [businessId]
      );
      invalidateStatusCache(businessId);
    }
    }); // End of connection.update handler

    // Attach auth state saver
    sock.ev.on('creds.update', saveCreds);
    
    // Catch and suppress errors from baileys internal processes (like init queries)
    // We've patched baileys-pro to fix the "_c is not defined" error, so init queries should work now
    // But we still track errors for debugging
    sock.ev.on('error', (err: any) => {
      const errorMsg = err?.message || String(err || '');
      const errorStack = err?.stack || '';
      
      // Track init query errors for debugging (should be rare now that _c bug is fixed)
      const errorStr = JSON.stringify(err || {});
      const isInitQueryError = 
        errorMsg.includes('_c is not defined') || 
        errorMsg.includes('init queries') ||
        errorStr.includes('_c is not defined') ||
        errorStr.includes('init queries') ||
        (errorStack.includes('fetchProps') && errorStack.includes('chats.js')) ||
        (errorStr.includes('fetchProps') && errorStr.includes('chats.js')) ||
        (errorStack.includes('executeInitQueries'));
      
      if (isInitQueryError) {
        // Track that we saw this error - log it for debugging
        const session = sessions.get(businessId);
        if (session) {
          session.initQueryErrorSeen = true;
          console.error(`[WA] ⚠️ Init query error detected for ${businessId}:`, errorMsg || errorStr);
          console.error(`[WA] Error stack:`, errorStack);
        }
        // Still suppress the error to prevent crashes, but we've logged it
        return;
      }
      
      // Suppress other non-critical errors
      if (errorMsg.includes('No SenderKeyRecord') || 
          errorMsg.includes('decrypt') ||
          errorMsg.includes('skipping app state sync')) {
        // These are normal and can be ignored
        return;
      }
      
      // Check for ACK errors (rate limiting, etc.)
      const errorCode = err?.attrs?.error || err?.error;
      // Error 479 = Rate limit exceeded - important to track
      if (errorCode === 479 || errorCode === '479' || errorMsg.includes('479')) {
        console.warn(`[WA] Rate limit error (479) detected for ${businessId}. This may cause device disconnection if repeated frequently.`);
        return; // Don't treat as fatal error
      }
      
      // Log other errors that might be important
      console.error(`[WA] Socket error for ${businessId}:`, err?.message || err, errorCode ? `(code: ${errorCode})` : '');
    });

    // NOTE: Message listener is attached ONLY after connection === 'open' to avoid race conditions
    // This prevents duplicate listeners and ghost message processing during restart loops

    console.log(`[WA] Socket initialization complete for ${businessId}. Waiting for connection events...`);
    
    // Give the socket a moment to emit initial connection events (QR, etc.)
    // This helps ensure we don't miss immediate events
    await new Promise(resolve => setTimeout(resolve, 100));
    
  } catch (error: any) {
    console.error(`[WA] Failed to create socket for ${businessId}:`, error);
    console.error(`[WA] Error stack:`, error.stack);
    
    sessionRecord.status = 'error';
    sessions.delete(businessId);
    
    const errorMessage = error.message || 'Unknown error';
    await db.query(`
      UPDATE whatsapp_sessions 
      SET status = 'error', 
          last_error = $2, 
          updated_at = CURRENT_TIMESTAMP 
      WHERE business_id = $1
    `, [businessId, `Failed to initialize WhatsApp connection: ${errorMessage}`]);
    invalidateStatusCache(businessId);
    
    throw error;
  } finally {
    // Always remove from creatingSockets to allow future attempts
    creatingSockets.delete(businessId);
    
    // Clear syncFullHistory flag after using it (only if sessionRecord exists)
    if (sessionRecord && sessionRecord.syncFullHistory) {
      sessionRecord.syncFullHistory = false;
    }
  }

  // Return session record (only reached if no error was thrown)
  return sessionRecord;
}

/**
 * Fetch message history for a specific chat/conversation using Baileys fetchMessageHistory
 * This is the proper way to fetch older messages on demand
 */
export async function fetchWhatsAppMessageHistory(
  businessId: string,
  jid: string,
  limit: number = 50
): Promise<{ success: boolean; message: string; messagesCount?: number }> {
  try {
    console.log(`[WA] 🔄 Fetching message history for ${jid} (limit: ${limit})...`);
    
    // Get current session
    const session = sessions.get(businessId);
    if (!session || session.status !== 'connected' || !session.socket) {
      return {
        success: false,
        message: 'WhatsApp is not connected. Please connect first before syncing messages.'
      };
    }
    
    // Check if fetchMessageHistory is available on the socket
    if (typeof session.socket.fetchMessageHistory !== 'function') {
      return {
        success: false,
        message: 'fetchMessageHistory is not available on this socket. Please update Baileys version.'
      };
    }
    
    // Get the oldest message in this conversation from our database
    const { queryOne } = await import('@/lib/db');
    const oldestMessage = await queryOne<{ message_id: string; created_at: Date }>(`
      SELECT message_id, created_at
      FROM whatsapp_conversation_messages
      WHERE business_id = $1 
        AND (
          (is_group = false AND (from_number = $2 OR to_number = $2))
          OR (is_group = true AND from_number = $2)
        )
      ORDER BY created_at ASC, message_id ASC
      LIMIT 1
    `, [businessId, jid]);
    
    if (!oldestMessage) {
      return {
        success: false,
        message: 'No messages found in database for this conversation. Historical messages will be synced automatically when WhatsApp sends them.'
      };
    }
    
    // Construct message key for fetchMessageHistory
    // Note: We need to construct the key from the oldest message
    // The key format is: { remoteJid: string, id: string, fromMe: boolean }
    // We'll need to know if the oldest message was from us or not
    const messageKey = {
      remoteJid: jid,
      id: oldestMessage.message_id,
      fromMe: false, // We'll try false first, might need adjustment based on actual message direction
    };
    
    // Call fetchMessageHistory - this will trigger messaging-history.set events
    // The messages will be processed by our event listener
    await session.socket.fetchMessageHistory(
      limit,
      messageKey as any,
      Math.floor(new Date(oldestMessage.created_at).getTime() / 1000) // timestamp in seconds
    );
    
    console.log(`[WA] ✅ fetchMessageHistory called for ${jid}. Messages will arrive via messaging-history.set events.`);
    
    return {
      success: true,
      message: `Fetching older messages for this conversation. Messages will be synced as WhatsApp sends them.`
    };
  } catch (error: any) {
    console.error(`[WA] ❌ Error fetching message history for ${jid}:`, error);
    return {
      success: false,
      message: `Failed to fetch message history: ${error.message || 'Unknown error'}`
    };
  }
}

function protoMessageTimestampSec(m: { messageTimestamp?: number | { low?: number; high?: number } | null }): number {
  const t = m.messageTimestamp;
  if (t == null) return 0;
  if (typeof t === 'object' && t !== null && 'low' in t) {
    return (t as { low: number; high?: number }).low;
  }
  if (typeof t === 'number') return t;
  return 0;
}

/**
 * Collect chat messages from a Baileys store entry and sort oldest → newest.
 */
function collectAndSortStoreMessagesForJid(
  entry: unknown
): Array<{ key?: { id?: string; fromMe?: boolean; remoteJid?: string; participant?: string }; messageTimestamp?: any }> {
  let arr: any[] = [];
  if (Array.isArray(entry)) {
    arr = [...entry];
  } else if (entry && typeof entry === 'object') {
    const o = entry as { all?: () => any[] };
    if (typeof o.all === 'function') {
      arr = o.all();
    } else {
      arr = Object.values(entry as object);
    }
  }
  return arr.sort((a, b) => protoMessageTimestampSec(a) - protoMessageTimestampSec(b));
}

/**
 * Fetch older messages for a chat using Baileys fetchMessageHistory (live mode)
 * This fetches directly from WhatsApp without database
 */
function chatsObjectFromStore(chats: unknown): Record<string, unknown> {
  if (!chats || typeof chats !== 'object') return {};
  if (chats instanceof Map) {
    return Object.fromEntries(chats as Map<string, unknown>);
  }
  return chats as Record<string, unknown>;
}

/**
 * When the Baileys message store is empty for a chat, request on-demand history using
 * the chat row's message range (same anchor Baileys uses for HISTORY_SYNC_ON_DEMAND).
 */
export async function bootstrapChatHistoryFromWhatsApp(
  businessId: string,
  requestedJid: string
): Promise<{ ok: boolean; detail?: string }> {
  try {
    const session = sessions.get(businessId);
    if (!session || session.status !== 'connected' || !session.socket) {
      return { ok: false, detail: 'not_connected' };
    }
    const sock = session.socket;
    if (typeof sock.fetchMessageHistory !== 'function') {
      return { ok: false, detail: 'no_fetchMessageHistory' };
    }
    const store = sock.store;
    if (!store?.messages) {
      return { ok: false, detail: 'no_store' };
    }
    const storeKey = findStoreMessageJidKey(store.messages as Record<string, unknown>, requestedJid);
    const raw = (store.messages as Record<string, unknown>)[storeKey];
    const sorted = collectAndSortStoreMessagesForJid(raw);
    if (sorted.length > 0) {
      return { ok: true, detail: 'already_has_messages' };
    }

    const chats = chatsObjectFromStore(store.chats);
    if (!Object.keys(chats).length) {
      return { ok: false, detail: 'no_chats' };
    }
    const chatKey =
      (chats[requestedJid] ? requestedJid : null) ||
      (chats[storeKey] ? storeKey : null) ||
      findStoreMessageJidKey(chats, requestedJid);
    const chat = chatKey ? chats[chatKey] : null;
    const anchor = extractHistoryAnchorFromChat(chat);
    if (!anchor) {
      return { ok: false, detail: 'no_chat_anchor' };
    }

    await sock.fetchMessageHistory(50, anchor.key as any, anchor.timestampSec);
    await new Promise((r) => setTimeout(r, 1500));
    return { ok: true, detail: 'fetch_triggered' };
  } catch (e: any) {
    console.error('[WA] bootstrapChatHistoryFromWhatsApp:', e);
    return { ok: false, detail: e?.message || 'error' };
  }
}

function extractHistoryAnchorFromChat(chat: unknown): {
  key: { remoteJid: string; id: string; fromMe: boolean };
  timestampSec: number;
} | null {
  if (!chat || typeof chat !== 'object') return null;
  const msgs = (chat as { messages?: unknown }).messages;
  if (!Array.isArray(msgs) || msgs.length === 0) return null;
  const oldest = msgs[msgs.length - 1] as {
    key?: { remoteJid?: string; id?: string; fromMe?: boolean };
    messageTimestamp?: number | { low?: number };
  };
  const key = oldest?.key;
  const ts = protoMessageTimestampSec(oldest);
  if (!key?.id || !key.remoteJid || !ts) return null;
  return {
    key: {
      remoteJid: key.remoteJid,
      id: key.id,
      fromMe: !!key.fromMe,
    },
    timestampSec: ts,
  };
}

export async function fetchOlderMessagesFromWhatsApp(
  businessId: string,
  jid: string,
  limit: number = 50
): Promise<{ success: boolean; messages?: any[]; error?: string }> {
  try {
    const session = sessions.get(businessId);
    if (!session || session.status !== 'connected' || !session.socket) {
      return { success: false, error: 'WhatsApp is not connected' };
    }

    const sock = session.socket;
    
    if (typeof sock.fetchMessageHistory !== 'function') {
      return { success: false, error: 'fetchMessageHistory not available on this socket' };
    }

    const store = sock.store?.messages as Record<string, unknown> | undefined;
    const storeKey = findStoreMessageJidKey(store, jid);
    const raw = store?.[storeKey];
    const messages = collectAndSortStoreMessagesForJid(raw);
    if (messages.length === 0) {
      return { success: false, error: 'No messages in store to fetch older ones' };
    }

    // Oldest in session store (chronological first) is the history anchor
    const oldestMessage = messages[0];
    const messageKey = {
      remoteJid: storeKey,
      id: oldestMessage.key?.id || '',
      fromMe: oldestMessage.key?.fromMe || false,
    };

    // Baileys messageTimestamp is in seconds, not ms — do not divide by 1000
    const timestampSec = protoMessageTimestampSec(oldestMessage);
    if (!timestampSec) {
      return { success: false, error: 'No valid timestamp on oldest message' };
    }

    // Fetch older messages
    // Note: This will trigger 'messaging-history.set' event
    // The messages will be added to sock.store.messages[jid] automatically
    await sock.fetchMessageHistory(
      limit,
      messageKey as any,
      timestampSec
    );

    // Wait a bit for messages to arrive via events and be stored
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Get updated messages from store
    const updatedRaw = (sock.store?.messages as Record<string, unknown> | undefined)?.[storeKey];
    const updatedMessages = collectAndSortStoreMessagesForJid(updatedRaw);
    
    return {
      success: true,
      messages: updatedMessages
    };
  } catch (error: any) {
    console.error(`[WA] Error fetching older messages for ${jid}:`, error);
    return { success: false, error: error.message || 'Unknown error' };
  }
}

/**
 * Trigger message sync for all conversations
 * Uses fetchMessageHistory for each conversation to fetch older messages
 * Note: This is a best-effort approach - WhatsApp controls what messages it sends
 */
export async function syncWhatsAppMessages(businessId: string): Promise<{ success: boolean; message: string }> {
  try {
    console.log(`[WA] 🔄 Starting message sync for all conversations (${businessId})...`);
    
    // Get current session
    const session = sessions.get(businessId);
    if (!session || session.status !== 'connected') {
      return {
        success: false,
        message: 'WhatsApp is not connected. Please connect first before syncing.'
      };
    }
    
    // Get all active conversations for this business
    const { queryRows } = await import('@/lib/db');
    const conversations = await queryRows<{ conversation_id: string; is_group: boolean }>(`
      SELECT DISTINCT conversation_id, is_group
      FROM whatsapp_conversations
      WHERE business_id = $1 AND status = 'active'
      LIMIT 20
    `, [businessId]);
    
    if (conversations.length === 0) {
      return {
        success: true,
        message: 'No active conversations found to sync. Messages will be synced automatically as they arrive.'
      };
    }
    
    // Fetch history for each conversation (limit to prevent overload)
    let syncedCount = 0;
    for (const conv of conversations.slice(0, 10)) { // Limit to 10 conversations at a time
      try {
        const jid = conv.is_group 
          ? conv.conversation_id 
          : `${conv.conversation_id}@s.whatsapp.net`;
        
        const result = await fetchWhatsAppMessageHistory(businessId, jid, 50);
        if (result.success) {
          syncedCount++;
        }
        
        // Small delay between requests to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (err) {
        console.warn(`[WA] Error syncing conversation ${conv.conversation_id}:`, err);
      }
    }
    
    console.log(`[WA] ✅ Message sync initiated for ${syncedCount} conversations`);
    
    return {
      success: true,
      message: `Message sync initiated for ${syncedCount} conversations. Older messages will be fetched as WhatsApp sends them.`
    };
  } catch (error: any) {
    console.error(`[WA] ❌ Error syncing messages for ${businessId}:`, error);
    return {
      success: false,
      message: `Failed to sync messages: ${error.message || 'Unknown error'}`
    };
  }
}

/**
 * Exposed status.connection: 'connected' | 'reconnecting' | 'disconnected' (Baileys manager).
 */
function resolveWhatsappConnectionField(
  businessId: string,
  options?: { memoryStatus?: SessionStatus; dbStatus?: string }
): 'connected' | 'reconnecting' | 'disconnected' {
  const m = WACM.getConnectionApiStatus(businessId);
  if (m === 'reconnecting') return 'reconnecting';
  if (options?.memoryStatus === 'connected' || options?.dbStatus === 'connected') return 'connected';
  if (m === 'connected') return 'connected';
  return 'disconnected';
}

/**
 * Public API to get current status
 * Checks in-memory first, then DB
 */
export async function getWhatsAppStatus(businessId: string) {
  WACM.registerBusiness(businessId);
  // First check in-memory session (most up-to-date)
  const inMemorySession = sessions.get(businessId);
  
  if (inMemorySession) {
    // IMPORTANT: "connected" must reflect a live socket, otherwise inbound events won't be received.
    // If we report connected when the socket is stale/closed, UI stays green but bot never replies.
    const socketValid = isSocketValid(inMemorySession.socket);

    if (inMemorySession.status === 'connected' && !socketValid) {
      console.warn('[WA] In-memory session marked connected but socket is invalid. Triggering revive...');
      // Revive asynchronously; do not block status endpoint.
      setImmediate(() => {
        getWhatsAppSocket(businessId).catch((err) => {
          console.error('[WA] Failed to revive invalid connected session:', err);
        });
      });

      // Fall through to DB/cached status (which may still be connected) but avoid lying based on memory.
    } else if (socketValid) {
      // Self-heal: on hot reload / long-running dev sessions, listener flags can drift.
      // Ensure message listeners are attached whenever we have a valid socket.
      if (inMemorySession.socket && !inMemorySession.listenerAttached) {
        attachMessageListener(inMemorySession.socket, businessId, inMemorySession);
      }
      return {
        status: inMemorySession.status,
        connection: resolveWhatsappConnectionField(businessId, {
          memoryStatus: inMemorySession.status,
        }),
        qr: inMemorySession.qr || null,
        phoneNumber: inMemorySession.phoneNumber || null,
        lastError: null,
        updatedAt: new Date().toISOString()
      };
    }
  }

  // Check cache before hitting database (to reduce DB load)
  const cached = statusCache.get(businessId);
  const now = Date.now();
  if (cached && (now - cached.timestamp) < STATUS_CACHE_TTL) {
    // Use cached status
    const row = cached.status;
    
    // If DB says 'connected', return it immediately
    if (row.status === 'connected') {
      return {
        status: 'connected' as SessionStatus,
        connection: resolveWhatsappConnectionField(businessId, { dbStatus: row.status }),
        qr: null,
        phoneNumber: row.phone_number || null,
        lastError: null,
        updatedAt: row.updated_at?.toISOString() || new Date().toISOString()
      };
    }
    
    // For pending_qr, check in-memory first
    let qrCode = null;
    if (row.status === 'pending_qr') {
      if (inMemorySession?.qr) {
        qrCode = inMemorySession.qr;
      } else if (row.last_qr) {
        qrCode = row.last_qr;
      }
    }
    
    return {
      status: row.status as SessionStatus,
      connection: resolveWhatsappConnectionField(businessId, { dbStatus: row.status, memoryStatus: inMemorySession?.status }),
      qr: qrCode,
      phoneNumber: row.phone_number || null,
      lastError: row.last_error || null,
      updatedAt: row.updated_at?.toISOString() || new Date().toISOString()
    };
  }

  // Cache miss - query database
  const row = await db.queryOne(`
    SELECT status, last_qr, phone_number, last_error, updated_at, auth_state 
    FROM whatsapp_sessions 
    WHERE business_id = $1
  `, [businessId]);
  
  // Update cache
  if (row) {
    statusCache.set(businessId, { status: row, timestamp: now });
  }

  if (!row) {
    return { status: 'disconnected' as SessionStatus };
  }

  // CRITICAL: If DB says 'connected', return it immediately regardless of in-memory state
  // This ensures the frontend gets the correct status even if in-memory session is stale
  // This is especially important right after connection opens when DB is updated but in-memory might be lagging
  if (row.status === 'connected') {
    // If DB says connected, update in-memory session status to match (if session exists)
    if (inMemorySession && inMemorySession.status !== 'connected') {
      console.log(`[WA] DB says connected but in-memory says ${inMemorySession.status}, updating in-memory to match DB`);
      inMemorySession.status = 'connected';
      inMemorySession.qr = undefined;
      if (row.phone_number) {
        inMemorySession.phoneNumber = row.phone_number;
      }
    }
    
    // Try to revive session if we don't have it in memory (but throttle to avoid excessive revivals)
    if (!inMemorySession && row.auth_state) {
      const now = Date.now();
      const lastRevivalTime = revivalTimestamps.get(businessId) || 0;
      
      // Only revive if it's been at least 5 minutes since last attempt
      // This prevents excessive revival attempts during status polling
      if (now - lastRevivalTime > 300000) {
        revivalTimestamps.set(businessId, now);
        
        console.log(`[WA] Found orphaned active session in DB. Reviving...`);
        // Revive asynchronously without blocking the status check
        setImmediate(() => {
          getWhatsAppSocket(businessId).catch(err => {
            console.error('[WA] Failed to revive session:', err);
          });
        });
      }
    }
    
    // Return connected status immediately - don't wait for in-memory session
    return {
      status: 'connected' as SessionStatus,
      connection: resolveWhatsappConnectionField(businessId, { dbStatus: 'connected' }),
      qr: null, // Always clear QR when connected
      phoneNumber: row.phone_number || null,
      lastError: null,
      updatedAt: row.updated_at?.toISOString() || new Date().toISOString()
    };
  }

  // For pending_qr, prioritize in-memory QR (more recent)
  let qrCode = null;
  if (row.status === 'pending_qr') {
    if (inMemorySession?.qr) {
      qrCode = inMemorySession.qr;
    } else if (row.last_qr) {
      qrCode = row.last_qr;
    }
  }

  return {
    status: row.status as SessionStatus,
    connection: resolveWhatsappConnectionField(businessId, { dbStatus: row.status, memoryStatus: inMemorySession?.status }),
    qr: qrCode,
    phoneNumber: row.phone_number || null,
    lastError: row.last_error || null,
    updatedAt: row.updated_at?.toISOString() || new Date().toISOString()
  };
}

/**
 * Disconnect/Logout
 */
export async function disconnectWhatsApp(businessId: string) {
  const session = sessions.get(businessId);
  
  if (session) {
    // Clear reconnect timer
    if (session.reconnectTimer) {
      clearTimeout(session.reconnectTimer);
    }
    
    // Clear health check timer
    if (session.healthCheckTimer) {
      clearTimeout(session.healthCheckTimer);
    }
    
    // Logout and cleanup socket
    if (session.socket) {
      try {
        await session.socket.logout();
      } catch (e) {
        // Ignore logout errors
      }
      try {
        session.socket.end(undefined);
      } catch (e) {
        // Ignore end errors
      }
    }
    
    // Remove from memory
    sessions.delete(businessId);
  }
  
  // Clear revival timestamp
  revivalTimestamps.delete(businessId);
  
  // Update database
  await db.query(`
    UPDATE whatsapp_sessions 
    SET status = 'disconnected', auth_state = NULL, last_qr = NULL, phone_number = NULL, 
        last_error = NULL, updated_at = CURRENT_TIMESTAMP 
    WHERE business_id = $1
  `, [businessId]);
  invalidateStatusCache(businessId);
  
  return true;
}

// formatButtonMessage and sendButtonMessage are now imported from baileys-hybrid

/**
 * Send Text Message
 * Ensures socket is ready before sending
 * Uses standard Baileys for regular messages, baileys-pro ONLY for buttons
 */
export async function sendWhatsAppMessage(
  businessId: string,
  to: string,
  text: string,
  media?: string | Buffer,
  messageType: 'text' | 'image' | 'button' | 'document' = 'text',
  buttons?: Array<{ id: string; title: string; type?: 'quick_reply' | 'call' | 'url'; phone?: string; url?: string }>,
  footer?: string
) {
  console.log('[WA] sendWhatsAppMessage called with:', {
    messageType,
    hasButtons: !!buttons,
    buttonsCount: buttons?.length || 0,
    buttons: buttons,
    hasMedia: !!media,
    hasFooter: !!footer,
    textPreview: text?.substring(0, 50)
  });
  
  // Step 1: Check in-memory session first
  let session = sessions.get(businessId);
  
  // Step 2: Verify session is valid and connected
  if (session && session.status === 'connected' && isSocketValid(session.socket)) {
    // Session is ready, proceed to send
    console.log(`[WA] Using existing in-memory session for ${businessId} to send message`);
  } else {
    // Step 3: Check DB status
    console.log(`[WA] In-memory session not available for ${businessId}, checking DB...`);
    const dbStatus = await db.queryOne<{ status: string; auth_state: any }>(
      `SELECT status, auth_state FROM whatsapp_sessions WHERE business_id = $1`,
      [businessId]
    );

    console.log(`[WA] DB status for ${businessId}:`, { 
      status: dbStatus?.status, 
      hasAuthState: !!dbStatus?.auth_state,
      inMemorySessionExists: !!session,
      inMemoryStatus: session?.status 
    });

    // Step 4: If DB says connected, try to revive
    if (dbStatus?.status === 'connected' && dbStatus.auth_state) {
      console.log(`[WA] Reviving session for ${businessId} to send message (DB says connected)`);
      try {
        session = await getWhatsAppSocket(businessId);
        
        // Wait for connection (up to 10 seconds)
        let retries = 0;
        while (retries < 20) {
          // Re-check session from memory (most up-to-date)
          const currentSession = sessions.get(businessId);
          if (currentSession && currentSession.status === 'connected' && isSocketValid(currentSession.socket)) {
            console.log(`[WA] Session revived successfully after ${retries} retries`);
            session = currentSession;
            break;
          }
          
          // Only throw error if we've given it enough time (at least 2 seconds / 4 retries)
          // This gives the connection time to establish
          if (retries >= 4) {
            if (currentSession?.status === 'pending_qr') {
              throw new Error('WhatsApp connection was lost. Please reconnect via the settings page.');
            }
            // Don't throw on 'disconnected' status during revival - it might be in transition
          }
          
          await new Promise(r => setTimeout(r, 500));
          retries++;
        }
        
        // Final check after retry loop
        const finalSession = sessions.get(businessId);
        if (!finalSession || finalSession.status !== 'connected' || !isSocketValid(finalSession.socket)) {
          throw new Error('Session revival timed out. Please reconnect via the settings page.');
        }
        session = finalSession;
      } catch (err: any) {
        console.error(`[WA] Failed to revive session for ${businessId}:`, err);
        if (err.message && err.message.includes('WhatsApp')) {
          throw err;
        }
        throw new Error(`Failed to revive WhatsApp connection: ${err.message || 'Unknown error'}. Please reconnect via the settings page.`);
      }
    } else {
      // DB says not connected
      console.error(`[WA] Cannot send message - DB status: ${dbStatus?.status || 'not found'}, hasAuthState: ${!!dbStatus?.auth_state}`);
      throw new Error('WhatsApp is not connected. Please connect via the settings page.');
    }
  }

  // Step 5: Final verification
  if (!session || session.status !== 'connected' || !session.socket || !isSocketValid(session.socket)) {
    throw new Error('WhatsApp is not connected. Please reconnect via the settings page.');
  }

  // Step 6: Send message
  // Normalize JID: use @s.whatsapp.net for standard Baileys connections
  // (@c.us is for WhatsApp Business API, not standard Baileys)
  const normalizedPhone = extractPhoneFromJid(to);
  const jid = to.includes('@s.whatsapp.net') || to.includes('@c.us') || to.includes('@g.us') 
    ? to 
    : `${normalizedPhone}@s.whatsapp.net`;
  
  let messageResult: any = null;
  try {
    // Handle different message types
    console.log('[WA] Message type check - messageType:', messageType, 'buttons:', buttons?.length || 0, 'buttons array:', buttons);
    if (messageType === 'button' && buttons && buttons.length > 0) {
      // Interactive button message (max 3 quick replies OR 2 call-to-actions)
      // CRITICAL: WhatsApp does NOT allow mixing quick_reply buttons with call/url buttons
      // Filter and validate buttons based on type
      const validButtons = buttons.filter(b => {
        if (!b.id || !b.title) return false;
        // For call and url buttons, validate phone/url fields
        if (b.type === 'call' && !b.phone) return false;
        if (b.type === 'url' && !b.url) return false;
        return true;
      });
      
      if (validButtons.length === 0) {
        throw new Error('At least one valid button (with ID and title, and phone/url if applicable) is required');
      }

      // According to Baileys Pro research, ALL button types (cta_reply, cta_call, cta_url) 
      // can be mixed in nativeFlowMessage - no need to filter or prioritize
      const finalButtons = validButtons;
      
      if (finalButtons.length === 0) {
        throw new Error('No valid buttons to send');
      }
      
      console.log('[WA] Sending ALL button types together (Baileys Pro nativeFlowMessage):', {
        total: finalButtons.length,
        types: finalButtons.map(b => b.type || 'quick_reply')
      });

      // Use the new viewOnceMessage format with nativeFlowMessage (based on Perplexity research)
      // This format supports call, URL, and quick reply buttons natively
      console.log('[WA] Attempting to send interactive button message with buttons:', finalButtons);
      console.log('[WA] Button types:', finalButtons.map(b => ({ type: b.type, id: b.id, title: b.title })));
      
      // Verify connection is still valid before sending
      if (!isSocketValid(session.socket)) {
        throw new Error('WhatsApp connection lost. Please reconnect.');
      }
      
      messageResult = await sendButtonMessage(session.socket, jid, text, finalButtons, footer, media);
      console.log('[WA] ✅ Interactive button message sent successfully via baileys-pro (proto + relayMessage)!');
      
      console.log('[WA] Message ID:', messageResult?.key?.id);
    } else if (messageType === 'image' && media) {
      // Image message with caption
      const imageBuffer = Buffer.isBuffer(media) ? media : undefined;
      const imageUrl = Buffer.isBuffer(media) ? undefined : (media as string);
      
      if (imageBuffer) {
        messageResult = await session.socket.sendMessage(jid, {
          image: imageBuffer,
          caption: text || undefined
        });
      } else if (imageUrl) {
        messageResult = await session.socket.sendMessage(jid, {
          image: { url: imageUrl },
          caption: text || undefined
        });
      } else {
        throw new Error('Invalid image data');
      }
    } else if (media) {
      // Document/PDF (existing logic)
      const document = Buffer.isBuffer(media) ? media : { url: media as string };
      messageResult = await session.socket.sendMessage(jid, { 
        document: document, 
        mimetype: 'application/pdf',
        fileName: 'Invoice.pdf',
        caption: text
      });
    } else {
      // Plain text message
      console.log('[WA] Sending plain text message to', jid);
      messageResult = await session.socket.sendMessage(jid, { text });
      console.log('[WA] ✅ Text message sent, message ID:', messageResult?.key?.id);
      console.log('[WA] Message result keys:', messageResult ? Object.keys(messageResult) : 'null');
    }
  } catch (err: any) {
    console.error('[WA] Error sending message:', err);
    
    // Handle connection closed errors (error code 1006 = WebSocket connection closed)
    if (err === 1006 || err.code === 1006 || (typeof err === 'number' && err === 1006)) {
      console.error('[WA] Connection closed (1006) during send. This indicates the WebSocket connection was lost.');
      throw new Error('WhatsApp connection was lost while sending. Please try again. If this persists, reconnect via settings.');
    }
    
    // Handle connection terminated errors
    if (err.message?.includes('Connection Closed') || err.message?.includes('Connection Terminated') || 
        err.output?.payload?.message?.includes('Connection Closed') ||
        err.output?.payload?.error === 'Precondition Required') {
      throw new Error('WhatsApp connection was terminated. Please reconnect via the settings page.');
    }
    
    throw new Error(`Failed to send message: ${err.message || err || 'Unknown error'}`);
  }
  
  // Step 7: Log message with real message ID from Baileys
  const mediaUrlStr = Buffer.isBuffer(media) 
    ? (messageType === 'image' ? 'blob:image' : 'blob:pdf') 
    : media;
  
  // Extract message ID - handle both direct objects and nested key.id structures
  let baileysMessageId: string | null = null;
  if (messageResult) {
    if (typeof messageResult === 'string') {
      baileysMessageId = messageResult;
    } else if (messageResult.key?.id) {
      baileysMessageId = messageResult.key.id;
    } else if (messageResult.id) {
      baileysMessageId = messageResult.id;
    }
  }
  
  // Log warning if button message doesn't have a message ID (but don't throw - message might still be sent)
  if (messageType === 'button' && !baileysMessageId) {
    console.warn('[WA] ⚠️ Button message sent but no message ID found in result. Message may still be sent.');
    console.warn('[WA] Message result type:', typeof messageResult);
    console.warn('[WA] Message result keys:', messageResult ? Object.keys(messageResult) : 'null');
    console.warn('[WA] Full message result:', JSON.stringify(messageResult, null, 2).substring(0, 500));
  }

  // Classify request (API path) — used when Baileys result is missing or not parseable
  let logMessageType = 'text';
  if (messageType === 'button') {
    logMessageType = 'button';
  } else if (messageType === 'image' && media) {
    logMessageType = 'image';
  } else if (media) {
    logMessageType = 'document';
  }

  // Same storage shape as events: prefer Baileys WAMessage body when present (API + phone parity)
  let fromBaileys = false;
  let outText = text || '';
  let outType = logMessageType;
  let outMedia: string | null = (mediaUrlStr as string | null) || null;
  let outHasMedia = !!(media && (messageType === 'image' || messageType === 'document'));
  if (messageResult && typeof messageResult === 'object' && (messageResult as any).message) {
    const ex = await extractMessageContent(messageResult as any);
    if (!ex.skip) {
      const f = crmFieldsFromExtracted(ex);
      outText = f.messageText;
      outType = f.messageType;
      outMedia = f.mediaUrl ?? outMedia;
      outHasMedia = ex.hasMedia;
      fromBaileys = true;
    }
  }
  if (!fromBaileys) {
    const f = crmFieldsFromExtracted({
      type: logMessageType,
      text: text || '',
      hasMedia: !!(media && (messageType === 'image' || messageType === 'document')),
      mediaUrl: typeof mediaUrlStr === 'string' ? mediaUrlStr : undefined,
      skip: false,
    });
    outText = f.messageText;
    outType = f.messageType;
    outMedia = f.mediaUrl ?? outMedia;
  }
  console.log('[WA] sendWhatsAppMessage: outbox', {
    outType,
    hasMedia: outHasMedia,
    hasMediaUrl: !!outMedia,
    source: fromBaileys ? 'extractMessageContent' : 'crmFieldsFromExtracted(send-args)',
  });

  const outboxSourceTimestampSec =
    messageResult && typeof messageResult === 'object'
      ? getTimestamp(messageResult as { messageTimestamp?: unknown })
      : Math.floor(Date.now() / 1000);
  const outboxOriginalWaSec =
    messageResult && typeof messageResult === 'object'
      ? getOriginalWaTimestampSecOrNull(messageResult as { messageTimestamp?: unknown })
      : null;

  try {
    await db.query(
      `
      INSERT INTO whatsapp_messages (business_id, to_number, message_type, message_text, media_url, status, baileys_message_id)
      VALUES ($1, $2, 'manual', $3, $4, 'sent', $5)
    `,
      [businessId, to, outText, outMedia || null, baileysMessageId]
    );
    
            if (baileysMessageId) {
              const conv = await db.queryOne<{ id: string }>(
                `SELECT id FROM whatsapp_conversations 
                 WHERE business_id = $1 AND conversation_id = $2`,
                [businessId, normalizedPhone]
              );
              if (conv?.id) {
                await addWhatsAppMessageJob({
                  type: 'outgoing-after-send',
                  businessId,
                  messageId: baileysMessageId,
                  conversationId: conv.id,
                  timestamp: Date.now(),
                  toJid: jid,
                  normalizedPhone,
                  outText,
                  outType,
                  outMedia: outMedia || null,
                  outboxSourceTimestampSec,
                  outboxOriginalWaSec
                });
              }
            }
  } catch (err) {
    console.error('[WA] Error logging message:', err);
    // Don't throw - message was sent, logging is secondary
  }

  return baileysMessageId || true;
}

/**
 * Send Interactive Button Message (baileys-pro format)
 * Helper function for sending button messages
 */
export async function sendInteractiveButton(
  businessId: string,
  to: string,
  text: string,
  buttons: Array<{ id: string; title: string }>,
  footer?: string
) {
  return sendWhatsAppMessage(businessId, to, text, undefined, 'button', buttons);
}

/**
 * Send Interactive List Message (baileys-pro format)
 * Helper function for sending list messages
 */
export async function sendInteractiveList(
  businessId: string,
  to: string,
  header: string,
  body: string,
  buttonTitle: string,
  sections: Array<{
    title: string;
    rows: Array<{ id: string; title: string; description?: string }>;
  }>,
  footer?: string
) {
  let session = sessions.get(businessId);
  
  if (!session || session.status !== 'connected' || !session.socket || !isSocketValid(session.socket)) {
    const dbStatus = await db.queryOne<{ status: string; auth_state: any }>(
      `SELECT status, auth_state FROM whatsapp_sessions WHERE business_id = $1`,
      [businessId]
    );
    
    if (dbStatus?.status === 'connected' && dbStatus.auth_state) {
      session = await getWhatsAppSocket(businessId);
      let retries = 0;
      while (session.status !== 'connected' && retries < 20) {
        await new Promise(r => setTimeout(r, 500));
        retries++;
        const currentSession = sessions.get(businessId);
        if (currentSession && currentSession.status === 'connected' && isSocketValid(currentSession.socket)) {
          session = currentSession;
          break;
        }
        if (session.status === 'pending_qr' || session.status === 'disconnected') {
          throw new Error('WhatsApp connection was lost. Please reconnect via the settings page.');
        }
      }
    } else {
      throw new Error('WhatsApp is not connected. Please connect via the settings page.');
    }
  }

  if (!session || session.status !== 'connected' || !session.socket || !isSocketValid(session.socket)) {
    throw new Error('WhatsApp is not connected. Please reconnect via the settings page.');
  }

  const normalizedPhone = extractPhoneFromJid(to);
  const jid = to.includes('@s.whatsapp.net') || to.includes('@g.us') ? to : `${normalizedPhone}@s.whatsapp.net`;
  
  try {
    // baileys-pro format: use interactiveButtons with single_select for lists
    const listMessage = {
      text: body,
      title: header,
      subtitle: '',
      footer: footer || '',
      media: false, // No media header
      interactiveButtons: [
        {
          name: 'single_select',
          buttonParamsJson: JSON.stringify({
            title: buttonTitle,
            sections: sections.map(section => ({
              title: section.title,
              rows: section.rows.map(row => ({
                id: row.id,
                title: row.title,
                description: row.description || ''
              }))
            }))
          })
        }
      ]
    };
    
    const messageResult = await session.socket.sendMessage(jid, listMessage as any);
    console.log('[WA] ✅ Interactive list message sent successfully!');
    return messageResult;
  } catch (error: any) {
    console.error('[WA] Error sending interactive list:', error);
    throw new Error(`Failed to send interactive list: ${error.message || 'Unknown error'}`);
  }
}
