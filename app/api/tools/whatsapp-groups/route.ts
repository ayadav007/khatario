/**
 * API endpoint for fetching WhatsApp groups and extracting participant phone numbers
 */

import { NextRequest, NextResponse } from 'next/server';
import { getWhatsAppSocket, getWhatsAppStatus } from '@/lib/whatsapp';
import { hasWhatsAppBotAddon } from '@/lib/subscription';
import { queryRows } from '@/lib/db';

/**
 * Extract phone number from JID (matching the logic from lib/whatsapp.ts)
 * Also handles LID JIDs by attempting to resolve them
 */
async function extractPhoneFromJid(socket: any, jid: string): Promise<string | null> {
  if (!jid) return null;
  
  // If it's a @lid JID, try to resolve it using onWhatsApp
  // Note: This can be slow for many participants, so we'll batch resolve them
  if (jid.endsWith('@lid')) {
    try {
      console.log(`[Phone Extraction] Attempting to resolve LID JID: ${jid}`);
      // Use Promise.race with timeout to avoid hanging
      const timeoutPromise = new Promise<null>((resolve) => 
        setTimeout(() => resolve(null), 3000) // 3 second timeout
      );
      
      const resolvePromise = socket.onWhatsApp(jid).then((result: any) => {
        if (result && result.length > 0 && result[0]?.jid) {
          // Got the phone number JID from the resolution
          const phoneJid = result[0].jid;
          console.log(`[Phone Extraction] ✅ Resolved LID ${jid} to ${phoneJid}`);
          // Recursively extract from the resolved JID
          return extractPhoneFromJid(socket, phoneJid);
        }
        return null;
      });
      
      const phone = await Promise.race([resolvePromise, timeoutPromise]);
      if (phone) return phone;
    } catch (err: any) {
      console.log(`[Phone Extraction] ❌ Failed to resolve LID JID ${jid}:`, err.message);
    }
    console.log(`[Phone Extraction] ⚠️ LID JID ${jid} could not be resolved to phone number`);
    return null;
  }
  
  // Remove any domain suffix (@s.whatsapp.net, @g.us, etc.)
  const afterDomainRemoved = jid.replace(/@.*$/, '');
  // Remove device ID (:0, :29, etc.)
  const afterDeviceRemoved = afterDomainRemoved.replace(/:.*/, '');
  // Keep only digits
  const cleaned = afterDeviceRemoved.replace(/\D/g, '');
  
  // Phone numbers are 8-15 digits (international format)
  // WhatsApp numbers can be 8-15 digits with country code
  // Some valid formats: 8 digits (local), 10 digits (US), 12 digits (India with country code), etc.
  if (cleaned.length < 8 || cleaned.length > 15) {
    // Log for debugging
    console.log(`[Phone Extraction] Invalid length for JID ${jid}: ${cleaned.length} digits (expected 8-15)`);
    return null;
  }
  
  // Log successful extraction
  console.log(`[Phone Extraction] ✅ Extracted ${cleaned.length}-digit number from JID ${jid}: ${cleaned}`);
  
  return cleaned;
}

/** One display name for a 1:1 or linked chat: includes saved contact title and `displayName` (WhatsApp UI label). */
function getNameFromChatRecord(chat: { name?: string | null; displayName?: string | null } | null | undefined): string | null {
  if (!chat) return null;
  const n = (chat.name || chat.displayName)?.toString().trim();
  return n || null;
}

/** Map JID (and related keys on the conversation) → chat list display name, built once per extract. */
function buildChatDisplayNameIndex(chats: Record<string, unknown> | null | undefined): Map<string, string> {
  const m = new Map<string, string>();
  if (!chats || typeof chats !== 'object') return m;
  for (const chat of Object.values(chats) as any[]) {
    if (!chat) continue;
    const display = getNameFromChatRecord(chat);
    if (!display) continue;
    for (const key of [chat.id, chat.newJid, chat.oldJid, chat.pnJid, chat.lidJid]) {
      if (key && typeof key === 'string') m.set(key, display);
    }
  }
  return m;
}

function getNameFromChatIndex(
  index: Map<string, string>,
  participantJid: string,
  phone: string | null,
  participantPhoneJid: string | null
): string | null {
  const tryKeys = [participantJid, participantPhoneJid, phone ? `${phone}@s.whatsapp.net` : null].filter(Boolean) as string[];
  for (const k of tryKeys) {
    const n = index.get(k);
    if (n) return n;
  }
  return null;
}

function getNameFromContactForLookup(contact: any): string | null {
  if (!contact) return null;
  return (
    contact.name ||
    contact.notify ||
    contact.pushName ||
    contact.shortName ||
    contact.verifiedName ||
    contact.vname ||
    null
  );
}

/**
 * Get participant name from WhatsApp contacts and optional pre-built chat display-name index.
 */
async function getParticipantName(
  socket: any,
  jid: string,
  phone: string | null,
  chatNameIndex?: Map<string, string>
): Promise<string | null> {
  if (!jid) return null;

  try {
    if (chatNameIndex) {
      const fromIndex = getNameFromChatIndex(chatNameIndex, jid, phone, null);
      if (fromIndex) return fromIndex;
    }

    // Direct chat row (same data as index, but O(1) for hot path)
    const directChat = socket.store?.chats?.[jid];
    const fromChat = getNameFromChatRecord(directChat);
    if (fromChat) return fromChat;
    if (phone) {
      const pnJid = `${phone}@s.whatsapp.net`;
      const fromPnChat = getNameFromChatRecord(socket.store?.chats?.[pnJid]);
      if (fromPnChat) return fromPnChat;
    }

    // First check if it's in the socket's contact store with the provided JID
    const contact = socket.store?.contacts?.[jid];
    const nameFromContact = getNameFromContactForLookup(contact);
    if (nameFromContact) {
      return nameFromContact.trim();
    }

    // Also check if contact is stored with phone number as key
    if (phone) {
      const phoneJid = `${phone}@s.whatsapp.net`;
      const contactByPhone = socket.store?.contacts?.[phoneJid];
      const nameFromPhone = getNameFromContactForLookup(contactByPhone);
      if (nameFromPhone) {
        return nameFromPhone.trim();
      }

      // Try with device ID variants (common format: phone:deviceId@s.whatsapp.net)
      for (let i = 0; i <= 4; i++) {
        // Limit to first few device IDs to avoid performance issues
        const jidWithDevice = `${phone}:${i}@s.whatsapp.net`;
        const contactWithDevice = socket.store?.contacts?.[jidWithDevice];
        const nameFromDevice = getNameFromContactForLookup(contactWithDevice);
        if (nameFromDevice) {
          return nameFromDevice.trim();
        }
        const chatWithDevice = getNameFromChatRecord(socket.store?.chats?.[jidWithDevice]);
        if (chatWithDevice) return chatWithDevice;
      }
    }

    // Check all contacts in store to find by phone number (fallback)
    if (phone && socket.store?.contacts) {
      const contacts = socket.store.contacts;
      for (const [contactJid, contactData] of Object.entries(contacts)) {
        if (contactJid.includes(phone)) {
          const nameFromMatch = getNameFromContactForLookup(contactData as any);
          if (nameFromMatch) {
            return nameFromMatch.trim();
          }
        }
      }
    }

    return null;
  } catch (err) {
    console.error(`[getParticipantName] Error getting name for ${jid}:`, err);
    return null;
  }
}

/** Normalize Baileys groupMetadata.participants to an array. */
function participantsArrayFromMetadata(metadata: { participants?: unknown }): any[] {
  const raw = metadata.participants;
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object') return Object.values(raw as Record<string, unknown>);
  return [];
}

function isWhatsAppRateLimitError(err: unknown): boolean {
  const m = err && typeof err === 'object' && 'message' in err ? String((err as { message?: string }).message) : String(err);
  return /rate[- ]?overlimit|rate\s*limit|429|too many requests/i.test(m);
}

/** Baileys often returns rate-overlimit when groupMetadata is called in quick succession. */
async function groupMetadataWithRetry(socket: any, groupJid: string): Promise<any> {
  const maxAttempts = 6;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await socket.groupMetadata(groupJid);
    } catch (err: unknown) {
      lastErr = err;
      if (!isWhatsAppRateLimitError(err) || attempt === maxAttempts) {
        throw err;
      }
      const waitMs = Math.min(2000 * attempt, 15000);
      console.warn(
        `[WhatsApp Groups] groupMetadata rate limit for ${groupJid}, waiting ${waitMs}ms (attempt ${attempt}/${maxAttempts})`
      );
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw lastErr;
}

/**
 * Full phone/name extraction for one group (expensive: LID resolution, contact lookup).
 * Used only when the user explicitly requests extraction (POST).
 */
async function extractParticipantsFromMetadata(socket: any, metadata: any): Promise<{
  participants: Array<{ jid: string; phone: string | null; name: string | null; admin: boolean }>;
  withPhone: { jid: string; phone: string; name: string | null; admin: boolean }[];
}> {
  const participantsArray = participantsArrayFromMetadata(metadata);
  const BATCH_SIZE = 30;
  const participants: any[] = [];
  const chatNameIndex = buildChatDisplayNameIndex(socket.store?.chats as Record<string, unknown>);

  for (let i = 0; i < participantsArray.length; i += BATCH_SIZE) {
    const batch = participantsArray.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(async (participant: any) => {
        if (!participant) return null;
        const participantJid = participant.id || participant.jid || '';
        if (!participantJid) return null;

        const phoneJidFromMeta =
          typeof participant.phoneNumber === 'string' && participant.phoneNumber.includes('@')
            ? participant.phoneNumber
            : null;

        let phone: string | null = null;
        if (participant.phoneNumber) {
          phone = await extractPhoneFromJid(socket, participant.phoneNumber);
        } else {
          phone = await extractPhoneFromJid(socket, participantJid);
        }

        let name =
          participant.notify ||
          participant.name ||
          participant.pushName ||
          participant.verifiedName ||
          null;

        if (!name) {
          name =
            getNameFromChatIndex(chatNameIndex, participantJid, phone, phoneJidFromMeta) ||
            (phoneJidFromMeta ? chatNameIndex.get(phoneJidFromMeta) || null : null);
        }

        if (!name) {
          name = await getParticipantName(socket, participantJid, phone, chatNameIndex);
        }
        if (!name && phone) {
          const phoneJid = `${phone}@s.whatsapp.net`;
          name = await getParticipantName(socket, phoneJid, phone, chatNameIndex);
        }
        if (!name && participant.phoneNumber) {
          name = await getParticipantName(socket, participant.phoneNumber, phone, chatNameIndex);
        }
        if (name) name = name.trim();

        return {
          jid: participantJid,
          phone,
          name,
          admin: participant.admin === 'admin' || participant.admin === 'superadmin',
        };
      })
    );
    participants.push(...batchResults);
    if (i + BATCH_SIZE < participantsArray.length) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  const valid = participants.filter((p: any) => p !== null && p.jid) as any[];
  const withPhone = valid.filter((p: any) => p.phone);

  return {
    participants: valid,
    withPhone,
  };
}

/**
 * GET /api/tools/whatsapp-groups
 * List groups with metadata only (no per-member phone extraction — use POST to extract one group).
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');

    if (!businessId) {
      return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
    }

    // Check if business has WhatsApp Bot addon
    const hasAddon = await hasWhatsAppBotAddon(businessId);
    if (!hasAddon) {
      return NextResponse.json(
        { error: 'WhatsApp Bot addon is required. Please upgrade to unlock this feature.' },
        { status: 403 }
      );
    }

    // Check WhatsApp connection status
    const status = await getWhatsAppStatus(businessId);
    if (status.status !== 'connected') {
      return NextResponse.json(
        { error: 'WhatsApp is not connected. Please connect your WhatsApp account first.' },
        { status: 400 }
      );
    }

    // Get WhatsApp socket
    const session = await getWhatsAppSocket(businessId);
    if (!session.socket || session.status !== 'connected') {
      return NextResponse.json(
        { error: 'WhatsApp socket is not available. Please reconnect.' },
        { status: 500 }
      );
    }

    const socket = session.socket;

    // Get all chats from store (includes groups)
    const chats = socket.store?.chats || {};
    const groupJids: string[] = [];

    // Filter for groups (end with @g.us)
    Object.keys(chats).forEach(jid => {
      if (jid.endsWith('@g.us')) {
        groupJids.push(jid);
      }
    });

    // Also check database for groups
    const dbGroups = await queryRows(
      `SELECT DISTINCT conversation_id, group_name 
       FROM whatsapp_conversations 
       WHERE business_id = $1 AND is_group = true 
       ORDER BY group_name ASC`,
      [businessId]
    );

    // Merge groups from store and database
    const allGroupJids = new Set<string>();
    groupJids.forEach(jid => allGroupJids.add(jid));
    dbGroups.forEach((group: any) => {
      if (group.conversation_id && group.conversation_id.includes('@g.us')) {
        allGroupJids.add(group.conversation_id);
      }
    });

    // List only: metadata per group (no phone extraction). Throttle calls to reduce rate-overlimit.
    const GROUP_METADATA_GAP_MS = 450;
    const groups: any[] = [];
    const jids = Array.from(allGroupJids);
    for (let idx = 0; idx < jids.length; idx++) {
      const groupJid = jids[idx];
      try {
        const metadata = await groupMetadataWithRetry(socket, groupJid);
        const participantsArray = participantsArrayFromMetadata(metadata);
        const dbGroup = dbGroups.find((g: any) => g.conversation_id === groupJid);
        const groupName = metadata.subject || dbGroup?.group_name || 'Unknown Group';

        groups.push({
          jid: groupJid,
          name: groupName,
          description: metadata.desc || null,
          participantsCount: participantsArray.length,
          createdAt: metadata.creation ? new Date(metadata.creation * 1000).toISOString() : null,
          owner: null,
        });
      } catch (err: any) {
        console.error(`[WhatsApp Groups] Error fetching metadata for ${groupJid}:`, err.message);
        const dbGroup = dbGroups.find((g: any) => g.conversation_id === groupJid);
        const rateLimited = isWhatsAppRateLimitError(err);
        groups.push({
          jid: groupJid,
          name: dbGroup?.group_name || 'Unknown Group',
          description: null,
          participantsCount: 0,
          createdAt: null,
          owner: null,
          error: rateLimited
            ? 'Rate limited — wait and use Refresh, or open Extract after a short pause'
            : 'Failed to fetch metadata',
        });
      }
      if (idx < jids.length - 1) {
        await new Promise((r) => setTimeout(r, GROUP_METADATA_GAP_MS));
      }
    }

    // Sort groups by name
    groups.sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({
      groups: groups,
      total: groups.length,
    });

  } catch (error: any) {
    console.error('[WhatsApp Groups] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch WhatsApp groups' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/tools/whatsapp-groups
 * Get participants for a specific group (alternative to GET with group_jid filter)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { business_id, group_jid } = body;

    if (!business_id || !group_jid) {
      return NextResponse.json(
        { error: 'business_id and group_jid are required' },
        { status: 400 }
      );
    }

    // Check if business has WhatsApp Bot addon
    const hasAddon = await hasWhatsAppBotAddon(business_id);
    if (!hasAddon) {
      return NextResponse.json(
        { error: 'WhatsApp Bot addon is required.' },
        { status: 403 }
      );
    }

    // Check WhatsApp connection status
    const status = await getWhatsAppStatus(business_id);
    if (status.status !== 'connected') {
      return NextResponse.json(
        { error: 'WhatsApp is not connected.' },
        { status: 400 }
      );
    }

    // Get WhatsApp socket
    const session = await getWhatsAppSocket(business_id);
    if (!session.socket || session.status !== 'connected') {
      return NextResponse.json(
        { error: 'WhatsApp socket is not available.' },
        { status: 500 }
      );
    }

    const socket = session.socket;

    const metadata = await groupMetadataWithRetry(socket, group_jid);
    const { withPhone } = await extractParticipantsFromMetadata(socket, metadata);

    const ownerPhone = metadata.owner
      ? await extractPhoneFromJid(socket, metadata.owner)
      : null;

    const list = withPhone.map((p) => ({
      jid: p.jid,
      phone: p.phone as string,
      name: p.name,
      admin: p.admin,
    }));
    const phoneNumbers = list.map((p) => p.phone);

    return NextResponse.json({
      group: {
        jid: group_jid,
        name: metadata.subject || 'Unknown Group',
        description: metadata.desc || null,
        participantsCount: list.length,
        participantsWithPhone: list.length,
        owner: ownerPhone,
      },
      participants: list,
      phoneNumbers,
    });

  } catch (error: any) {
    console.error('[WhatsApp Groups] Error fetching participants:', error);
    const rateLimited = isWhatsAppRateLimitError(error);
    return NextResponse.json(
      {
        error: rateLimited
          ? 'WhatsApp rate limit — wait a few seconds and try Extract again.'
          : error?.message || 'Failed to fetch group participants',
      },
      { status: rateLimited ? 429 : 500 }
    );
  }
}
