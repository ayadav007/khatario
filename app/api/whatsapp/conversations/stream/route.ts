import { NextRequest } from 'next/server';
import { wsEventEmitter } from '@/lib/whatsapp-websocket';
import { hasWhatsAppBotAddon } from '@/lib/subscription';

/**
 * Server-Sent Events (SSE) endpoint for real-time conversation updates
 * 
 * IMPORTANT: This endpoint must NOT run DB queries on every request.
 * - Addon check is done ONCE and cached
 * - Connection is kept alive until client disconnects
 * - Events are pushed only when they occur, not polled
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const businessId = searchParams.get('business_id');

  if (!businessId) {
    return new Response('business_id is required', { status: 400 });
  }

  // Check addon ONCE (cached, won't query DB repeatedly)
  const hasAddon = await hasWhatsAppBotAddon(businessId);
  if (!hasAddon) {
    return new Response(JSON.stringify({ error: 'WhatsApp Bot addon is required. Please upgrade to unlock this feature.' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' }
    });
  }

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

      // Listen for all WebSocket events for this business.
      // `emitWSEvent` already emits to `event:business:<id>` for every event; it ALSO emits
      // to `<type>:<businessId>`. Subscribing to both caused duplicate SSE payloads per client
      // (and ×2 in React Strict Mode with two dev connections) — a "never-ending" noisy loop in logs.
      const roomName = `business:${businessId}`;
      const roomEventName = `event:${roomName}`;

      const eventHandler = (event: any) => {
        if (isClosed) return;

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

      wsEventEmitter.on(roomEventName, eventHandler);
      listeners.push({ event: roomEventName, handler: eventHandler });

      // Send a heartbeat every 30 seconds to keep connection alive
      const heartbeatInterval = setInterval(() => {
        if (isClosed) {
          clearInterval(heartbeatInterval);
          return;
        }
        try {
          safeEnqueue(encoder.encode(': heartbeat\n\n'));
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
  });
}
