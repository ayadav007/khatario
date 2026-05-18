import { NextRequest } from 'next/server';
import {
  getUserIdFromRequest,
  getBusinessIdFromRequest,
  requirePortalSession,
} from '@/lib/auth-helpers';
import { reminderPipelineLog } from '@/lib/reminder-pipeline-log';
import { getRedisConnection } from '@/lib/queue/redis';
import { queryOne } from '@/lib/db';
import Redis from 'ioredis';

/**
 * Server-Sent Events (SSE) endpoint for real-time notifications
 * 
 * Subscribes to Redis 'notifications' channel and streams events to connected browsers.
 * Business and user-scoped filtering happens server-side for efficiency and security.
 * 
 * Requirements:
 * - Content-Type: text/event-stream
 * - Cache-Control: no-cache
 * - Connection: keep-alive
 * - Handles disconnects cleanly
 * - Requires business_id and user_id query parameters
 * - Verifies user belongs to business
 */
export async function GET(request: NextRequest) {
  const gate = await requirePortalSession(request);
  if (gate) return gate;

  // Get business_id and user_id from query params for filtering
  const { searchParams } = new URL(request.url);
  const businessId = getBusinessIdFromRequest(request);
  const userId = getUserIdFromRequest(request);

  if (!businessId) {
    return new Response(
      JSON.stringify({ error: 'business_id is required' }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  if (!userId) {
    return new Response(
      JSON.stringify({ error: 'user_id is required' }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  // Verify user belongs to business (authentication check)
  try {
    const user = await queryOne<{ id: string; business_id: string }>(
      'SELECT id, business_id FROM users WHERE id = $1 AND is_active = true',
      [userId]
    );

    if (!user) {
      return new Response(
        JSON.stringify({ error: 'User not found or inactive' }),
        {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    if (user.business_id !== businessId) {
      return new Response(
        JSON.stringify({ error: 'User does not belong to this business' }),
        {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }
  } catch (error: any) {
    console.error('[SSE] Error verifying user:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to verify user' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  const redis = getRedisConnection();

  if (!redis) {
    console.log('[SSE] Redis not configured - REDIS_URL not set');
    return new Response(
      JSON.stringify({ error: 'Redis connection not available' }),
      {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  // Ensure Redis is connected before proceeding (handles lazyConnect: true)
  try {
    if ((redis.status as string) !== 'ready') {
      console.log('[SSE] Redis not ready, connecting... (status:', redis.status, ')');
      
      // If connection is not in progress, start it
      if ((redis.status as string) === 'end' || (redis.status as string) === 'close') {
        // Connection was closed, need to create a new one
        console.warn('[SSE] Redis connection was closed, cannot reconnect in this context');
        return new Response(
          JSON.stringify({ error: 'Redis connection closed' }),
          {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }
      
      // If connecting or waiting, just wait
      if ((redis.status as string) === 'connecting' || (redis.status as string) === 'wait') {
        console.log('[SSE] Redis connecting, waiting for ready...');
      } else {
        // Start connection
        await redis.connect();
      }
      
      // Wait for connection to be ready (max 5 seconds)
      let attempts = 0;
      while ((redis.status as string) !== 'ready' && attempts < 50) {
        await new Promise(resolve => setTimeout(resolve, 100));
        attempts++;
      }
      
      if ((redis.status as string) !== 'ready') {
        console.warn('[SSE] Redis connection timeout - status:', redis.status);
        return new Response(
          JSON.stringify({ error: 'Redis connection timeout' }),
          {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }
    }
    console.log('[SSE] ✅ Redis connection ready (status:', redis.status, ')');
  } catch (error: any) {
    console.error('[SSE] Failed to connect Redis:', error.message);
    return new Response(
      JSON.stringify({ error: 'Failed to connect Redis' }),
      {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  // Create a separate Redis connection for pub/sub (required by ioredis)
  const subscriber = redis.duplicate();
  
  // Ensure subscriber is connected before subscribing (duplicate inherits lazyConnect: true)
  try {
    if (subscriber.status !== 'ready') {
      console.log('[SSE] Connecting Redis subscriber...');
      await subscriber.connect();
    }
    console.log('[SSE] Redis subscriber status:', subscriber.status);
  } catch (error) {
    console.error('[SSE] Failed to connect subscriber:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to connect Redis subscriber' }),
      {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  // Create readable stream for SSE
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        console.log('[SSE] Setting up Redis subscriber for business:', businessId, 'user:', userId);
        
        // Subscribe to notifications channel
        await subscriber.subscribe('notifications');
        console.log('[SSE] ✅ Subscribed to Redis notifications channel');

        // Handle messages from Redis
        subscriber.on('message', (_channel: string, message: string) => {
          try {
            console.log('[SSE] Received message from Redis:', message.substring(0, 100));
            // Parse message and filter by business_id and user_id (server-side filtering for security)
            const eventData = JSON.parse(message);
            
            console.log('[SSE] Parsed event data:', { 
              type: eventData.type, 
              businessId: eventData.businessId, 
              userId: eventData.userId,
              requestedBusinessId: businessId,
              requestedUserId: userId
            });
            
            // Only send events for the requested business AND user
            // This ensures users only see their own notifications
            if (eventData.businessId === businessId && eventData.userId === userId) {
              const sseMessage = `data: ${message}\n\n`;
              controller.enqueue(encoder.encode(sseMessage));
              reminderPipelineLog('sse.server.enqueue_to_browser', {
                businessId,
                userId,
                notificationId: eventData.notificationId,
                type: eventData.type,
              });
              console.log('[SSE] Sent event to client for business:', businessId, 'user:', userId);
            } else {
              const reason = eventData.businessId !== businessId 
                ? `business mismatch: ${eventData.businessId} !== ${businessId}`
                : `user mismatch: ${eventData.userId} !== ${userId}`;
              console.log('[SSE] Event filtered out (' + reason + ')');
            }
          } catch (error) {
            console.error('[SSE] Error parsing/encoding message:', error);
          }
        });

        // Handle Redis errors
        subscriber.on('error', (err: Error) => {
          console.error('[SSE] Redis subscriber error:', err);
          // Send error event to client
          try {
            const errorMessage = `event: error\ndata: ${JSON.stringify({ error: 'Redis connection error' })}\n\n`;
            controller.enqueue(encoder.encode(errorMessage));
          } catch (e) {
            // Ignore encoding errors during error handling
          }
        });

        // Handle client disconnect
        request.signal.addEventListener('abort', async () => {
          try {
            await subscriber.unsubscribe('notifications');
            await subscriber.quit();
            try {
              controller.close();
            } catch (e) {
              // Controller might already be closed - ignore
            }
          } catch (error) {
            console.error('[SSE] Error during cleanup:', error);
            try {
              controller.close();
            } catch (e) {
              // Controller might already be closed - ignore
            }
          }
        });

        // Send initial connection message
        const initMessage = `event: connected\ndata: ${JSON.stringify({ message: 'SSE stream connected' })}\n\n`;
        controller.enqueue(encoder.encode(initMessage));
      } catch (error) {
        console.error('[SSE] Error setting up stream:', error);
        controller.close();
      }
    },

    cancel() {
      // Cleanup on stream cancellation
      subscriber.unsubscribe('notifications').catch(() => {});
      subscriber.quit().catch(() => {});
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable nginx buffering
    },
  });
}
