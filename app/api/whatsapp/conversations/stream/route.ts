import { NextResponse } from 'next/server';
import { wsEventEmitter } from '@/lib/whatsapp-websocket';
import { withWhatsAppPremiumApi } from '@/lib/security/premium-module-api';
import { resolveWhatsAppConversationDbId } from '@/lib/whatsapp-conversation-resolve';
import { canViewConversation, getInboxViewer, touchInboxPresence } from '@/lib/whatsapp/inbox-ownership';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VISIBILITY_TTL_MS = 60_000;

function eventConversationId(event: any): string | null {
  const id = event?.conversation?.id ?? event?.conversationId ?? event?.message?.conversation_id;
  return id ? String(id) : null;
}

/**
 * Server-Sent Events (SSE) endpoint for real-time conversation updates
 * 
 * IMPORTANT: This endpoint must NOT run DB queries on every request.
 * - Addon check is done ONCE and cached
 * - Connection is kept alive until client disconnects
 * - Events are pushed only when they occur, not polled
 *
 * Agents only receive events for chats they can see. Visibility is cached per connection and
 * re-checked whenever a `conversation:update` arrives (ownership or labels may have changed).
 * When a chat the agent could see becomes hidden, a `conversation:hidden` event tells the
 * client to drop it.
 */
export const GET = withWhatsAppPremiumApi({ inboxPermission: true }, async ({ request, businessId, userId }) => {
  const viewer = await getInboxViewer({ businessId, userId });
  void touchInboxPresence(userId).catch(() => undefined);

  // Create a readable stream for SSE
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      
      // Send initial connection message
      controller.enqueue(encoder.encode(': connected\n\n'));

      // Track all listeners so we can remove them on disconnect
      const listeners: Array<{ event: string; handler: (event: any) => void }> = [];
      let isClosed = false;

      // Helper to safely enqueue data
      const safeEnqueue = (data: Uint8Array) => {
        try {
          if (!isClosed) {
            controller.enqueue(data);
          }
        } catch (error) {
          // Connection closed
          isClosed = true;
        }
      };

      const send = (event: any) => {
        try {
          const eventData = JSON.stringify(event);
          if (process.env.NODE_ENV === 'development') {
            console.log(`[SSE] 📤 ${event.type}`, event.message?.id || event.conversationId || '');
          }
          safeEnqueue(encoder.encode(`event: ${event.type}\ndata: ${eventData}\n\n`));
        } catch (error) {
          console.error('[SSE] Error encoding event data:', error);
        }
      };

      const visibility = new Map<string, { visible: boolean; at: number }>();
      const jidToId = new Map<string, string | null>();

      const toDbId = async (raw: string): Promise<string | null> => {
        if (UUID_RE.test(raw)) return raw;
        if (!jidToId.has(raw)) {
          jidToId.set(raw, await resolveWhatsAppConversationDbId(businessId, raw).catch(() => null));
        }
        return jidToId.get(raw) ?? null;
      };

      const isVisible = async (id: string, refresh: boolean): Promise<boolean> => {
        const cached = visibility.get(id);
        if (!refresh && cached && Date.now() - cached.at < VISIBILITY_TTL_MS) return cached.visible;
        const visible = await canViewConversation(viewer, id).catch(() => cached?.visible ?? false);
        visibility.set(id, { visible, at: Date.now() });
        return visible;
      };

      const filterAndSend = async (event: any) => {
        if (viewer.isSupervisor) return send(event);

        if (event.type === 'summary:update') {
          // Business-wide counts would leak hidden chats; the client refetches its own summary.
          return send({ type: event.type, businessId: event.businessId, summary: null });
        }

        const rawId = eventConversationId(event);
        if (!rawId) return;
        const id = await toDbId(rawId);
        if (!id) return;

        const isUpdate = event.type === 'conversation:update';
        const wasVisible = visibility.get(id)?.visible ?? false;
        const visible = await isVisible(id, isUpdate);
        if (visible) return send(event);
        if (isUpdate && wasVisible) {
          send({ type: 'conversation:hidden', businessId: event.businessId, conversationId: id });
        }
      };

      // Events must reach the client in emit order even though visibility checks are async.
      let queue: Promise<void> = Promise.resolve();

      // Listen for all WebSocket events for this business.
      // `emitWSEvent` already emits to `event:business:<id>` for every event; it ALSO emits
      // to `<type>:<business_id>`. Subscribing to both caused duplicate SSE payloads per client
      // (and ×2 in React Strict Mode with two dev connections) — a "never-ending" noisy loop in logs.
      const roomName = `business:${businessId}`;
      const roomEventName = `event:${roomName}`;

      const eventHandler = (event: any) => {
        if (isClosed) return;
        queue = queue.then(() => (isClosed ? undefined : filterAndSend(event))).catch((error) => {
          console.error('[SSE] Error filtering event:', error);
        });
      };

      wsEventEmitter.on(roomEventName, eventHandler);
      listeners.push({ event: roomEventName, handler: eventHandler });

      // Send a heartbeat every 30 seconds to keep connection alive; it also marks the agent online.
      const heartbeatInterval = setInterval(() => {
        if (isClosed) {
          clearInterval(heartbeatInterval);
          return;
        }
        try {
          safeEnqueue(encoder.encode(': heartbeat\n\n'));
          void touchInboxPresence(userId).catch(() => undefined);
        } catch (error) {
          // Connection closed
          isClosed = true;
          clearInterval(heartbeatInterval);
        }
      }, 30000);

      // Cleanup function - CRITICAL: Remove all listeners
      const cleanup = () => {
        if (isClosed) return;
        isClosed = true;

        // Remove ALL listeners we added
        listeners.forEach(({ event, handler }) => {
          try {
            wsEventEmitter.off(event, handler);
          } catch (err) {
            // Ignore errors during cleanup
          }
        });

        // Clear heartbeat
        clearInterval(heartbeatInterval);

        // Close controller
        try {
          controller.close();
        } catch (err) {
          // Ignore errors during close
        }
      };

      // Cleanup on client disconnect
      request.signal.addEventListener('abort', cleanup);

      // Also handle any errors
      request.signal.addEventListener('error', cleanup);
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable buffering in nginx
    },
  }) as NextResponse;
});
