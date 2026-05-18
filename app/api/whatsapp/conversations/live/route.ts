/**
 * API endpoint to fetch conversations directly from Baileys store (live mode)
 * This bypasses database storage and shows chats like WhatsApp Web
 */

import { NextRequest, NextResponse } from 'next/server';
import { getWhatsAppSocket } from '@/lib/whatsapp';
import { hasWhatsAppBotAddon } from '@/lib/subscription';
import { queryRows } from '@/lib/db';
import {
  findStoreMessageJidKey,
  maxChatListActivityTimeSec,
  protoMessageTimestampSec,
  toProtoTimestampSec
} from '@/lib/baileys-store-helpers';

// Helper to extract phone number from JID
function extractPhoneFromJid(jid: string): string {
  if (!jid) return '';
  const cleaned = jid
    .replace(/@.*$/, '')   // Remove domain suffix
    .replace(/:.*/, '')    // Remove device ID
    .replace(/\D/g, '');   // Keep only digits
  if (cleaned.length < 9 || cleaned.length > 15) return '';
  return cleaned;
}

/** Per-session timestamp so we only bulk-fetch group metadata at most every 10 minutes. */
const groupBulkFetchState: Map<string, number> = (globalThis as any).__waGroupBulkFetchState
  || ((globalThis as any).__waGroupBulkFetchState = new Map<string, number>());

/** Unwrap view-once / ephemeral so list preview matches WhatsApp Web. */
function unwrapVisibleMessageContent(m: { message?: any } | null | undefined) {
  const raw = m?.message;
  if (!raw) return null;
  const e = raw.ephemeralMessage?.message
    || raw.viewOnceMessage?.message
    || raw.viewOnceMessageV2?.message;
  return e || raw;
}

/** Text shown in the chat list for one proto message (last meaningful row, like Web). */
function listPreviewTextFromMessage(msg: Record<string, unknown> | null): string {
  if (!msg) return '';
  if (msg.conversation) return String(msg.conversation);
  if ((msg as any).extendedTextMessage?.text) return String((msg as any).extendedTextMessage.text);
  if (msg.imageMessage) return (msg as any).imageMessage?.caption || '[Image]';
  if (msg.videoMessage) return (msg as any).videoMessage?.caption || '[Video]';
  if (msg.audioMessage) return '[Audio]';
  if (msg.documentMessage) return String((msg as any).documentMessage?.fileName || '[Document]');
  if (msg.contactMessage) return '[Contact]';
  if (msg.locationMessage) return '[Location]';
  if (msg.stickerMessage) return '[Sticker]';
  if (msg.reactionMessage) {
    return '[Reaction]';
  }
  if (msg.protocolMessage) return '';
  if (Object.keys(msg).length) return '[Media]';
  return '';
}

/** Baileys may store as array, KeyedDB, or plain object — order is not guaranteed. */
function messagesToSortedChronological(raw: unknown): any[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return [...raw].sort((a, b) => protoMessageTimestampSec(a) - protoMessageTimestampSec(b));
  }
  if (typeof raw === 'object' && raw !== null) {
    const o = raw as { all?: () => any[] };
    if (typeof o.all === 'function') {
      return [...o.all()].sort((a, b) => protoMessageTimestampSec(a) - protoMessageTimestampSec(b));
    }
    return (Object.values(raw) as any[]).sort((a, b) => protoMessageTimestampSec(a) - protoMessageTimestampSec(b));
  }
  return [];
}

/** Normalize `sock.store.chats` (plain object, KeyedDB `.all()`, array, or Map) to a chat array. */
function collectChatsArrayFromStore(store: { chats?: unknown } | null | undefined): any[] {
  const raw = store?.chats;
  if (raw == null) return [];
  try {
    if (typeof (raw as { all?: () => any[] }).all === 'function') {
      return (raw as { all: () => any[] }).all();
    }
    if (Array.isArray(raw)) {
      return raw;
    }
    if (raw instanceof Map) {
      return [...raw.values()].filter((c) => c != null);
    }
    if (typeof raw === 'object') {
      return Object.values(raw as object).filter((c) => c != null && c !== undefined);
    }
  } catch (e) {
    console.warn('[Live Conversations] collectChatsArrayFromStore:', e);
  }
  return [];
}

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

    // Get active socket
    const session = await getWhatsAppSocket(businessId);
    
    // DEBUG: Log session state
    console.log('[Live Conversations] Session check:', {
      hasSession: !!session,
      status: session?.status,
      hasSocket: !!session?.socket,
      socketValid: session?.socket ? !session.socket.ws?.isClosed : false
    });
    
    if (!session || session.status !== 'connected' || !session.socket) {
      return NextResponse.json(
        { 
          error: 'WhatsApp is not connected. Please connect your WhatsApp first.',
          errorCode: 'NOT_CONNECTED',
          fallbackToDatabase: true,
          debug: {
            hasSession: !!session,
            status: session?.status,
            hasSocket: !!session?.socket
          }
        },
        { status: 503 }
      );
    }

    const sock = session.socket;
    
    // Access Baileys store - chats are stored in sock.store.chats
    // Wait for store to be fully initialized (it may exist but not have chats property yet)
    let storeReady = false;
    if (!sock.store) {
      // Wait up to 3 seconds for store to be available
      for (let i = 0; i < 15; i++) {
        await new Promise(resolve => setTimeout(resolve, 200));
        if (sock.store) break;
      }
    }
    
    // Check if store has chats property (wait up to 3 more seconds)
    if (sock.store) {
      for (let i = 0; i < 15; i++) {
        // Check different possible structures
        if (sock.store.chats !== undefined) {
          storeReady = true;
          break;
        }
        // Also check if store.chats might be accessed differently
        try {
          if (typeof sock.store.chats?.all === 'function' || 
              Array.isArray(sock.store.chats) ||
              (typeof sock.store.chats === 'object' && sock.store.chats !== null)) {
            storeReady = true;
            break;
          }
        } catch (e) {
          // Property might not be accessible yet
        }
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }
    
    // If store exists but chats is undefined, it might be empty (which is OK)
    // Only fail if store itself doesn't exist
    if (!sock.store) {
      return NextResponse.json(
        { 
          error: 'Chat store not available. The WhatsApp connection may still be initializing. Please try again in a moment or use Database Mode.',
          errorCode: 'STORE_NOT_READY',
          fallbackToDatabase: true
        },
        { status: 503 }
      );
    }
    
    // Store exists - even if chats is undefined/empty, we can return empty array
    // This allows the frontend to show "no conversations" instead of an error

    // Chats arrive via `chats.upsert` / `chats.update` (and history) — may lag a few 100ms after HTTP connect
    let chats: any[] = collectChatsArrayFromStore(sock.store);
    if (chats.length === 0) {
      for (let attempt = 0; attempt < 10; attempt++) {
        await new Promise((r) => setTimeout(r, 350));
        chats = collectChatsArrayFromStore(sock.store);
        if (chats.length > 0) {
          console.log('[Live Conversations] Chats populated after wait', { attempt: attempt + 1, count: chats.length });
          break;
        }
      }
    }
    if (chats.length === 0) {
      console.log('[Live Conversations] No chats in store after wait (new link or sync pending)', {
        storeChatsType: typeof sock.store.chats,
        keys:
          sock.store.chats && typeof sock.store.chats === 'object' && !(sock.store.chats instanceof Map)
            ? Object.keys(sock.store.chats as object).length
            : 0
      });
    }

    // #region agent log — N1/N5 store coverage (pre-reconcile)
    let preReconcileChatCount = chats.length;
    let storeMessagesJidCount = 0;
    let synthesizedCount = 0;
    try {
      const storeMsgs = sock.store.messages as Record<string, unknown> | undefined;
      const chatJids = chats.map((c: any) => c?.id || c?.jid).filter(Boolean) as string[];
      const chatJidSet = new Set(chatJids);
      const msgsJids = storeMsgs && typeof storeMsgs === 'object' ? Object.keys(storeMsgs) : [];
      storeMessagesJidCount = msgsJids.length;
      const msgsJidsNotInChats = msgsJids.filter((j) => !chatJidSet.has(j));
      const sampleMsgsOnly = msgsJidsNotInChats.slice(0, 20).map((j) => {
        const arr = (storeMsgs as Record<string, any>)[j];
        const list = Array.isArray(arr) ? arr : (typeof arr?.all === 'function' ? arr.all() : Object.values(arr || {}));
        const last = list && list.length ? list[list.length - 1] : null;
        return {
          jid: j,
          msgCount: list?.length || 0,
          lastTs: protoMessageTimestampSec(last),
        };
      });
      fetch('http://127.0.0.1:7800/ingest/1dcfd029-2e5d-44e6-a00a-7d1eb37ea4e9', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '29d717' },
        body: JSON.stringify({
          sessionId: '29d717',
          runId: 'post-fix-live-store-coverage',
          location: 'app/api/whatsapp/conversations/live/route.ts:storeCoverage',
          message: 'store coverage snapshot (pre-reconcile)',
          data: {
            hypothesisId: 'N1+N5',
            chatsCount: chats.length,
            messagesJidCount: msgsJids.length,
            jidsWithMessagesButNoChat: msgsJidsNotInChats.length,
            storeChatsIsArray: Array.isArray(sock.store.chats),
            storeChatsType: typeof sock.store.chats,
            sampleMissingChats: sampleMsgsOnly,
          },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
    } catch (probeErr) {
      console.error('[Probe N1/N5] error', probeErr);
    }
    // #endregion

    // FIX (R1+R3+R4 — confirmed by debug session 29d717 logs):
    // Baileys' `messaging-history.set` only delivers chat metadata for a subset of conversations
    // (137 in this account) while the message stream covers many more (1581). Reconcile here:
    // every JID that has messages but no chat row gets a synthetic chat backed by its newest
    // message's timestamp. This is what WhatsApp Web does internally — derive the chat list
    // from the message stream — and matches the user's expectation when "Live mode" is on.
    try {
      const storeMsgs = sock.store.messages as Record<string, unknown> | undefined;
      if (storeMsgs && typeof storeMsgs === 'object') {
        const chatJidSet = new Set(
          chats.map((c: any) => c?.id || c?.jid).filter(Boolean) as string[]
        );
        const synthesized: any[] = [];
        for (const jid of Object.keys(storeMsgs)) {
          if (!jid || chatJidSet.has(jid)) continue;
          if (jid.includes('@broadcast') || jid.endsWith('@status')) continue;
          if (jid === 'status@broadcast') continue;
          const raw = (storeMsgs as Record<string, any>)[jid];
          const list = Array.isArray(raw)
            ? raw
            : typeof raw?.all === 'function'
              ? raw.all()
              : Object.values(raw || {});
          if (!list || list.length === 0) continue;
          // Find newest message and its timestamp.
          let newest: any = null;
          let newestTs = 0;
          for (const m of list) {
            const ts = protoMessageTimestampSec(m);
            if (ts > newestTs) {
              newestTs = ts;
              newest = m;
            } else if (!newest) {
              newest = m;
            }
          }
          synthesized.push({
            id: jid,
            conversationTimestamp: newestTs || undefined,
            unreadCount: 0,
            // Hint downstream code that this row was reconciled from messages, not Baileys chats.
            __reconciledFromMessages: true,
            __lastMessage: newest,
          });
        }
        if (synthesized.length > 0) {
          chats = chats.concat(synthesized);
          synthesizedCount = synthesized.length;
        }
      }
    } catch (reconcileErr) {
      console.error('[Live Conversations] reconcile error', reconcileErr);
    }

    // #region agent log — R1 reconcile result
    try {
      fetch('http://127.0.0.1:7800/ingest/1dcfd029-2e5d-44e6-a00a-7d1eb37ea4e9', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '29d717' },
        body: JSON.stringify({
          sessionId: '29d717',
          runId: 'post-fix-live-store-coverage',
          location: 'app/api/whatsapp/conversations/live/route.ts:reconcile',
          message: 'reconcile from store.messages',
          data: {
            hypothesisId: 'R1',
            preReconcileChatCount,
            storeMessagesJidCount,
            synthesizedCount,
            postReconcileChatCount: chats.length,
          },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
    } catch {}
    // #endregion

    // FIX (A — group names): Bulk-fetch group metadata once per process so the
    // `groupMetadataCache` (already used elsewhere in lib/whatsapp.ts) gets populated.
    // Without this, synthesized groups display as "Group Chat" / raw JID.
    const groupCache: Map<string, string> | undefined =
      (globalThis as any).__waGroupMetadataCache;
    try {
      const lastFetched = groupBulkFetchState.get(businessId) || 0;
      const ageMs = Date.now() - lastFetched;
      // Re-fetch at most every 10 minutes; do nothing if very recent.
      if (ageMs > 10 * 60 * 1000) {
        groupBulkFetchState.set(businessId, Date.now());
        // Fire-and-forget: don't block the first request, but warm the cache for the next ones.
        // Most users hit /live every ~30s in live mode, so the second poll already has names.
        (async () => {
          try {
            const metas = await (sock as any).groupFetchAllParticipating?.();
            if (metas && groupCache) {
              for (const [jid, meta] of Object.entries(metas)) {
                const name = (meta as any)?.subject || (meta as any)?.name;
                if (name) groupCache.set(jid, String(name));
              }
            }
          } catch (e) {
            console.warn('[Live Conversations] groupFetchAllParticipating failed:', e);
          }
        })();
      }
    } catch (e) {
      console.warn('[Live Conversations] group bulk fetch trigger failed:', e);
    }

    // REVERTED — REJECTED by debug session 29d717: hypothesis B+C (@lid resolve+hide).
    // Logs at runId=post-fix-live-store-coverage:enrich showed
    // `lidResolvedRenamed: 0, lidHiddenUnresolved: 1149` — the LID mapping store is empty
    // for incoming-history JIDs (it only fills on outbound message sends). Hiding all @lid
    // dropped 1149 real chats (e.g. Tandoor Studio, Abhi (You)) that WhatsApp Web shows.
    // We now keep @lid rows in the list and let the transform display them with their
    // JID-derived label, same as before this hypothesis.

    // #region agent log — M1/M2/M3 missing-chats probe
    // Investigate why some chats visible on WhatsApp Web (e.g. "IndusInd Bank" 10:05 am,
    // "+91 70420 07959" 5:57 am, "Mitchel HPE" yesterday) are absent from our store
    // entirely (not in store.chats, not in store.messages).
    try {
      const storeMsgs = sock.store.messages as Record<string, unknown> | undefined;
      const msgJids = storeMsgs && typeof storeMsgs === 'object' ? Object.keys(storeMsgs) : [];

      // Look for needles the user pointed out as missing.
      const needles = ['7042007959', 'indusind', 'mitchel', 'hpe', '63785', '61236'];
      const matches: Record<string, string[]> = {};
      for (const n of needles) matches[n] = [];

      // Check store.messages JIDs.
      for (const jid of msgJids) {
        const lower = jid.toLowerCase();
        for (const n of needles) {
          if (lower.includes(n)) matches[n].push(`msgs:${jid}`);
        }
      }
      // Check store.chats objects (subject, name, id).
      for (const c of chats) {
        const id = String(c?.id || c?.jid || '').toLowerCase();
        const subject = String(c?.subject || '').toLowerCase();
        const name = String(c?.name || '').toLowerCase();
        for (const n of needles) {
          if (id.includes(n) || subject.includes(n) || name.includes(n)) {
            matches[n].push(`chat:${c?.id || c?.jid || '?'}|${c?.subject || c?.name || ''}`);
          }
        }
      }
      // Categorize JID suffixes to spot whole categories we might miss.
      const suffixCounts: Record<string, number> = {};
      for (const jid of msgJids) {
        const at = jid.indexOf('@');
        const suffix = at >= 0 ? jid.slice(at) : '(no-@)';
        suffixCounts[suffix] = (suffixCounts[suffix] || 0) + 1;
      }
      // Newsletter sample (in case some "missing" chats are newsletters).
      const newsletterJids = msgJids.filter((j) => j.endsWith('@newsletter'));
      const newsletterSample = newsletterJids.slice(0, 10).map((j) => {
        const arr = (storeMsgs as Record<string, any>)[j];
        const list = Array.isArray(arr)
          ? arr
          : typeof arr?.all === 'function'
            ? arr.all()
            : Object.values(arr || {});
        const last = list && list.length ? list[list.length - 1] : null;
        return { jid: j, count: list?.length || 0, lastTs: protoMessageTimestampSec(last) };
      });
      // Sample of recently-active s.whatsapp.net JIDs to find IndusInd / 70420 etc.
      const swaJids = msgJids.filter((j) => j.endsWith('@s.whatsapp.net'));
      const swaActive = swaJids
        .map((j) => {
          const arr = (storeMsgs as Record<string, any>)[j];
          const list = Array.isArray(arr)
            ? arr
            : typeof arr?.all === 'function'
              ? arr.all()
              : Object.values(arr || {});
          const last = list && list.length ? list[list.length - 1] : null;
          return { jid: j, count: list?.length || 0, lastTs: protoMessageTimestampSec(last) };
        })
        .sort((a, b) => b.lastTs - a.lastTs)
        .slice(0, 30);

      fetch('http://127.0.0.1:7800/ingest/1dcfd029-2e5d-44e6-a00a-7d1eb37ea4e9', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '29d717' },
        body: JSON.stringify({
          sessionId: '29d717',
          runId: 'missing-chats-probe',
          location: 'app/api/whatsapp/conversations/live/route.ts:missingChatsProbe',
          message: 'search store for chats Web shows but app does not',
          data: {
            hypothesisId: 'M1+M2+M3+M5',
            totalMsgJids: msgJids.length,
            totalChats: chats.length,
            groupCacheSize: groupCache?.size || 0,
            needleHits: matches,
            jidSuffixCounts: suffixCounts,
            newsletterSample,
            top30RecentSwaJids: swaActive,
          },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
    } catch (probeErr) {
      console.error('[Probe missing-chats] error', probeErr);
    }
    // #endregion

    // Transform chats to match your frontend format
    // Counters for the post-fix probe.
    let newsletterFiltered = 0;
    let displayResolvedFromPushName = 0;
    let displayResolvedFromContacts = 0;
    const sampleResolvedNames: Array<{ jid: string; via: string; name: string }> = [];

    const conversations = chats
      .filter((chat: any) => {
        const jid = chat.id || chat.jid || '';
        // Skip status broadcasts and other system chats
        if (jid.includes('@broadcast') || jid.includes('@status')) {
          return false;
        }
        // FIX (C — match Web): WhatsApp Web shows newsletters/channels in a separate
        // "Updates" tab, not in the main chat list. Hide them from the main list.
        if (jid.endsWith('@newsletter')) {
          newsletterFiltered += 1;
          return false;
        }
        return true;
      })
      .map((chat: any) => {
        const jid = chat.id || chat.jid || '';
        const isGroup = jid.endsWith('@g.us');
        const phoneNumber = isGroup ? null : extractPhoneFromJid(jid);
        
        // Get last message info
        // Baileys stores messages in sock.store.messages[jid]
        let lastMessage: any = null;
        let lastMessageText = '';
        let lastMessageAt: Date | null = null;
        let lastMessageDirection: 'incoming' | 'outgoing' = 'incoming';
        // FIX (A — name resolution): collect the latest pushName from incoming messages.
        // Every Baileys incoming message carries `pushName` = sender's WhatsApp display
        // name. For 1-on-1 chats (incl. @lid) this is the contact's name as set on their
        // WhatsApp account — exactly what Web shows when the contact isn't in your phone book.
        let pushNameFromMessages = '';

        try {
          const store = sock.store.messages as Record<string, unknown> | undefined;
          const storeKey = findStoreMessageJidKey(store, jid);
          const messages = messagesToSortedChronological(store?.[storeKey]);
          const lastProtoTime = messages.length > 0 ? protoMessageTimestampSec(messages[messages.length - 1]) : 0;
          const activitySec = maxChatListActivityTimeSec(chat, lastProtoTime);
          if (activitySec > 0) {
            lastMessageAt = new Date(activitySec * 1000);
          }

          if (messages.length > 0) {
            // Pick preview like WhatsApp Web: last row with something to show (skip pure protocol / empty)
            for (let i = messages.length - 1; i >= 0; i--) {
              const candidate = messages[i];
              const unwrapped = unwrapVisibleMessageContent(candidate) as Record<string, unknown> | null;
              const text = listPreviewTextFromMessage(unwrapped);
              if (text) {
                lastMessage = candidate;
                lastMessageText = text;
                lastMessageDirection = lastMessage.key?.fromMe ? 'outgoing' : 'incoming';
                break;
              }
            }
            if (!lastMessage) {
              lastMessage = messages[messages.length - 1];
              const unwrapped = unwrapVisibleMessageContent(lastMessage) as Record<string, unknown> | null;
              lastMessageText = listPreviewTextFromMessage(unwrapped) || '[Media]';
              lastMessageDirection = lastMessage.key?.fromMe ? 'outgoing' : 'incoming';
            }

            // Walk newest → oldest, find the latest non-empty pushName from an INCOMING message.
            // Skip outgoing (fromMe) because that pushName would be the bot's own name.
            // Also skip empty/whitespace pushNames.
            if (!isGroup) {
              for (let i = messages.length - 1; i >= 0; i--) {
                const m = messages[i];
                if (m?.key?.fromMe) continue;
                const pn = typeof m?.pushName === 'string' ? m.pushName.trim() : '';
                if (pn) {
                  pushNameFromMessages = pn;
                  break;
                }
              }
            }
          } else {
            if (!lastMessageAt) {
              const t = (chat as { conversationTimestamp?: unknown }).conversationTimestamp;
              if (t) {
                const ts = toProtoTimestampSec(t);
                if (ts) lastMessageAt = new Date(ts * 1000);
              }
            }
          }
        } catch (error) {
          console.error('[Live Conversations] Error processing messages:', error);
        }
        
        // Get unread count
        const unreadCount = chat.unreadCount || chat.unread || 0;
        
        // Resolve group name from the global metadata cache (populated by
        // groupFetchAllParticipating + lib/whatsapp.ts message handlers).
        const cachedGroupName = isGroup ? (groupCache?.get(jid) || '') : '';

        // FIX (A — name resolution): also try Baileys' contacts store. For some chats
        // Baileys carries a name there from app-state sync even before any message arrives.
        const contacts = (sock.store as { contacts?: Record<string, any> } | undefined)?.contacts || {};
        const contactEntry = contacts[jid];
        const contactName: string =
          contactEntry?.name
          || contactEntry?.notify
          || contactEntry?.verifiedName
          || '';

        // Get display name. Priority:
        //   1) Existing chat.name/subject (from store.chats — most authoritative)
        //   2) Cached group metadata (for synthesized groups)
        //   3) Baileys' contacts store entry (for non-groups, addressbook-style)
        //   4) pushName from latest incoming message (this is what Web shows for unknown contacts)
        //   5) Phone number / raw JID fallback
        let displayName: string;
        if (chat.name || chat.subject) {
          displayName = chat.name || chat.subject;
        } else if (cachedGroupName) {
          displayName = cachedGroupName;
        } else if (contactName) {
          displayName = contactName;
          displayResolvedFromContacts += 1;
          if (sampleResolvedNames.length < 20) sampleResolvedNames.push({ jid, via: 'contacts', name: contactName });
        } else if (pushNameFromMessages) {
          displayName = pushNameFromMessages;
          displayResolvedFromPushName += 1;
          if (sampleResolvedNames.length < 20) sampleResolvedNames.push({ jid, via: 'pushName', name: pushNameFromMessages });
        } else {
          displayName = phoneNumber || jid;
        }

        return {
          id: jid, // Use JID as ID for live mode
          conversation_id: jid,
          from_number: phoneNumber || '',
          last_message_text: lastMessageText,
          last_message_at: lastMessageAt ? lastMessageAt.toISOString() : null,
          last_message_direction: lastMessageDirection,
          unread_count: unreadCount,
          is_group: isGroup,
          group_name: isGroup ? (chat.subject || chat.name || cachedGroupName || 'Group Chat') : null,
          group_jid: isGroup ? jid : null,
          whatsapp_display_name: displayName,
          is_pinned: chat.pinned || false,
          is_muted: chat.muteEndTime ? chat.muteEndTime > Date.now() : false,
          // Note: These fields won't be available without DB, but you can add them later
          customer_name: null,
          customer_phone: phoneNumber,
          assigned_to: null,
          lead_status: null,
          conversation_status: null,
          profile_picture_url: null as string | null,
        };
      })
      .sort((a: any, b: any) => {
        // Sort by pinned first, then by last message time
        if (a.is_pinned && !b.is_pinned) return -1;
        if (!a.is_pinned && b.is_pinned) return 1;
        const timeA = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
        const timeB = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
        return timeB - timeA;
      });

    // #region agent log — N2 top-15 returned ordering
    try {
      const top = conversations.slice(0, 15).map((c: any, i: number) => ({
        rank: i + 1,
        id: c.id,
        display: c.whatsapp_display_name,
        last_at: c.last_message_at,
        text: typeof c.last_message_text === 'string' ? c.last_message_text.slice(0, 60) : c.last_message_text,
        unread: c.unread_count,
        is_group: c.is_group,
      }));
      fetch('http://127.0.0.1:7800/ingest/1dcfd029-2e5d-44e6-a00a-7d1eb37ea4e9', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '29d717' },
        body: JSON.stringify({
          sessionId: '29d717',
          runId: 'post-fix-live-store-coverage',
          location: 'app/api/whatsapp/conversations/live/route.ts:top15',
          message: 'top-15 conversations returned',
          data: { hypothesisId: 'N2', total: conversations.length, top },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
    } catch (probeErr) {
      console.error('[Probe N2] error', probeErr);
    }
    // #endregion

    // #region agent log — A/C verification probe
    // Verify hypothesis A (pushName/contacts resolution) and C (newsletter filter) worked.
    try {
      // Search the top results for chats that are still raw "@lid" or raw phone strings.
      const stillRawLid = conversations.filter((c: any) => {
        const id: string = c.id || '';
        return id.endsWith('@lid') && (c.whatsapp_display_name === id || /^\+?\d+$/.test(String(c.whatsapp_display_name).replace(/[\s+]/g, '')));
      }).slice(0, 20).map((c: any) => ({ id: c.id, display: c.whatsapp_display_name }));

      fetch('http://127.0.0.1:7800/ingest/1dcfd029-2e5d-44e6-a00a-7d1eb37ea4e9', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '29d717' },
        body: JSON.stringify({
          sessionId: '29d717',
          runId: 'post-fix-AC',
          location: 'app/api/whatsapp/conversations/live/route.ts:nameAndNewsletterProbe',
          message: 'verify name resolution + newsletter filter',
          data: {
            hypothesisId: 'A+C',
            totalConversations: conversations.length,
            newsletterFiltered,
            displayResolvedFromContacts,
            displayResolvedFromPushName,
            sampleResolvedNames,
            stillRawLid,
            stillRawLidCount: stillRawLid.length,
          },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
    } catch (probeErr) {
      console.error('[Probe A+C] error', probeErr);
    }
    // #endregion

    // #region agent log — B missing-chats deep probe (contacts + history sync state)
    // Inspect Baileys' contacts store + auth-state history-sync markers to find out
    // whether the missing chats are simply absent from history-sync, or hiding under
    // different keys/aliases.
    try {
      const contactsStore = (sock.store as { contacts?: Record<string, any> } | undefined)?.contacts || {};
      const contactJids = Object.keys(contactsStore);
      const needles = ['7042007959', '917042007959', 'mitchel', 'hpe', 'indusind', 'tandoor'];

      const contactHits: Array<{ needle: string; jid: string; name?: string; notify?: string; verifiedName?: string }> = [];
      for (const cjid of contactJids) {
        const entry = contactsStore[cjid] || {};
        const haystack = `${cjid}|${entry.name || ''}|${entry.notify || ''}|${entry.verifiedName || ''}`.toLowerCase();
        for (const n of needles) {
          if (haystack.includes(n)) {
            contactHits.push({ needle: n, jid: cjid, name: entry.name, notify: entry.notify, verifiedName: entry.verifiedName });
          }
        }
      }

      // Sample of 10 contacts so we know the shape of entries we have.
      const contactsSample = contactJids.slice(0, 10).map((cjid) => ({
        jid: cjid,
        ...(contactsStore[cjid] || {}),
      }));

      // History-sync markers from auth state.
      const creds: any = (sock as any)?.authState?.creds || {};
      const historyMeta = {
        processedHistoryMessages: Array.isArray(creds.processedHistoryMessages) ? creds.processedHistoryMessages.length : null,
        accountSyncCounter: creds.accountSyncCounter ?? null,
        lastAccountSyncTimestamp: creds.lastAccountSyncTimestamp ?? null,
        firstUnuploadedATNKeyId: creds.firstUnuploadedATNKeyId ?? null,
        nextPreKeyId: creds.nextPreKeyId ?? null,
      };

      fetch('http://127.0.0.1:7800/ingest/1dcfd029-2e5d-44e6-a00a-7d1eb37ea4e9', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '29d717' },
        body: JSON.stringify({
          sessionId: '29d717',
          runId: 'probe-B-missing-chats',
          location: 'app/api/whatsapp/conversations/live/route.ts:missingChatsContactsProbe',
          message: 'check contacts store + history sync for missing chats',
          data: {
            hypothesisId: 'B',
            totalContacts: contactJids.length,
            contactHits,
            contactHitsCount: contactHits.length,
            contactsSample,
            historyMeta,
          },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
    } catch (probeErr) {
      console.error('[Probe B] error', probeErr);
    }
    // #endregion

    // Enrich with cached profile pictures from DB (single query for all JIDs)
    try {
      const jids = conversations.map((c: any) => c.id).filter(Boolean);
      if (jids.length > 0) {
        const pics = await queryRows<{ conversation_id: string; profile_picture_url: string | null }>(
          `SELECT conversation_id, profile_picture_url
           FROM whatsapp_conversations
           WHERE business_id = $1 AND conversation_id = ANY($2) AND profile_picture_url IS NOT NULL`,
          [businessId, jids]
        );
        const picMap = new Map(pics.map(p => [p.conversation_id, p.profile_picture_url ?? null]));
        for (const conv of conversations) {
          if (picMap.has(conv.id)) {
            conv.profile_picture_url = picMap.get(conv.id) ?? null;
          }
        }
      }
    } catch (_) { /* non-critical */ }

    return NextResponse.json({ 
      conversations,
      total: conversations.length 
    });
  } catch (error: any) {
    console.error('[Live Conversations] Error fetching conversations:', error);
    return NextResponse.json({ 
      error: error.message || 'Failed to fetch live conversations' 
    }, { status: 500 });
  }
}
