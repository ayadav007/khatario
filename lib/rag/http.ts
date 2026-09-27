import { randomBytes } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { answerTurn, type AnswerEvent, type AnswerInput } from './answer';
import { ragConfig } from './config';

export const VISITOR_COOKIE = 'kh_av';
const VISITOR_RE = /^[a-f0-9]{32}$/;

/** Anonymous visitor id for public chat: ties conversations and leads to one browser. */
export function readOrCreateVisitorId(request: NextRequest): { id: string; isNew: boolean } {
  const existing = request.cookies.get(VISITOR_COOKIE)?.value;
  if (existing && VISITOR_RE.test(existing)) return { id: existing, isNew: false };
  return { id: randomBytes(16).toString('hex'), isNew: true };
}

export function setVisitorCookie(response: NextResponse, id: string): void {
  response.cookies.set({
    name: VISITOR_COOKIE,
    value: id,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });
}

export function rateLimited(keys: Array<[string, number, number]>): NextResponse | null {
  for (const [key, limit, windowMs] of keys) {
    const r = checkRateLimit(key, limit, windowMs);
    if (!r.allowed) {
      return NextResponse.json(
        { error: 'Too many messages. Please wait a moment and try again.', code: 'RATE_LIMITED' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil(r.retryAfterMs / 1000)) } },
      );
    }
  }
  return null;
}

export function publicChatLimits(request: NextRequest, visitorId: string): Array<[string, number, number]> {
  const ip = getClientIp(request);
  return [
    [`assistant:ip:min:${ip}`, 20, 60_000],
    [`assistant:ip:day:${ip}`, 300, 86_400_000],
    [`assistant:visitor:min:${visitorId}`, 10, 60_000],
  ];
}

export interface ChatBody {
  message: string;
  conversationId: string | null;
  pagePath: string | null;
}

export async function readChatBody(request: NextRequest): Promise<ChatBody | NextResponse> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (!message) return NextResponse.json({ error: 'Please type a question.' }, { status: 400 });
  if (message.length > ragConfig().maxMessageChars) {
    return NextResponse.json({ error: 'That message is too long. Please keep it shorter.' }, { status: 400 });
  }
  return {
    message,
    conversationId: typeof body.conversationId === 'string' ? body.conversationId : null,
    pagePath: typeof body.pagePath === 'string' ? body.pagePath.slice(0, 300) : null,
  };
}

function sse(event: AnswerEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

/** Stream one assistant turn as server-sent events. */
export function streamAnswer(request: NextRequest, input: AnswerInput): NextResponse {
  const encoder = new TextEncoder();
  const abort = new AbortController();
  request.signal?.addEventListener('abort', () => abort.abort());

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of answerTurn({ ...input, signal: abort.signal })) {
          controller.enqueue(encoder.encode(sse(event)));
        }
      } catch (err) {
        console.error('[assistant] turn failed:', err instanceof Error ? err.message : err);
        controller.enqueue(
          encoder.encode(sse({ type: 'error', message: 'Something went wrong. Please try again in a moment.' })),
        );
      } finally {
        controller.close();
      }
    },
    cancel() {
      abort.abort();
    },
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
