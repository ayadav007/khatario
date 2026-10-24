import { NextRequest, NextResponse } from 'next/server';
import { assertUserSessionVersionMatches } from '@/lib/auth-helpers';
import {
  requireNotificationSession,
  userBelongsToSessionBusiness,
} from '@/lib/notifications/notification-session';
import { RETRY_AFTER_SHUTDOWN_S } from '@/lib/notifications/stream/config';
import type { AuthCheck } from '@/lib/notifications/stream/connection';
import { getNotificationStreamHub } from '@/lib/notifications/stream/hub';
import { parseCursor } from '@/lib/notifications/stream/sse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function unavailable(status: 429 | 503, code: string, error: string, retryAfterS: number) {
  return NextResponse.json({ error, code }, { status, headers: { 'Retry-After': String(retryAfterS) } });
}

/**
 * Server-Sent Events stream of the caller's notifications (own rows and business-wide rows).
 *
 * - Identity is the middleware-verified session only; `business_id` / `user_id` query
 *   parameters from older clients are accepted and ignored.
 * - Resumes after `Last-Event-ID` (EventSource reconnect) or `?after_seq=`; without a cursor
 *   the stream starts at the newest row (no replay).
 * - Events: `message` (id = seq cursor, payload includes `seq`), `connected`, `resync`,
 *   `reconnect`, `auth`; `: ping` every 25s. Older clients only handle `message`.
 * - 429 + Retry-After over the per-user / per-process stream limits, 503 + Retry-After while
 *   the server is shutting down.
 */
export async function GET(request: NextRequest) {
  const hub = getNotificationStreamHub();
  if (hub.isShuttingDown) {
    return unavailable(503, 'SHUTTING_DOWN', 'Server is restarting', RETRY_AFTER_SHUTDOWN_S);
  }

  let businessId: string;
  let userId: string;
  try {
    const session = await requireNotificationSession(request);
    if (!session.ok) return session.response;
    businessId = session.businessId;
    userId = session.userId;
  } catch (error) {
    console.error('[SSE] Error verifying user:', error);
    return NextResponse.json({ error: 'Failed to verify user' }, { status: 500 });
  }

  const authorize = async (): Promise<AuthCheck> => {
    const version = await assertUserSessionVersionMatches(request, userId);
    if (!version.ok) return 'revoked';
    return (await userBelongsToSessionBusiness(userId, businessId)) ? 'ok' : 'forbidden';
  };

  const opened = hub.open({
    scope: { businessId, userId },
    initialCursor: parseCursor(request.headers.get('last-event-id'), request.nextUrl.searchParams.get('after_seq')),
    authorize,
  });
  if (!opened.ok) {
    return opened.code === 'SHUTTING_DOWN'
      ? unavailable(503, opened.code, 'Server is restarting', opened.retryAfterS)
      : unavailable(429, opened.code, 'Too many notification streams', opened.retryAfterS);
  }

  const connection = opened.connection;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      connection.attach(controller);
    },
    cancel() {
      connection.close('cancelled');
    },
  });

  if (request.signal.aborted) connection.close('aborted');
  else request.signal.addEventListener('abort', () => connection.close('aborted'), { once: true });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
