import { NextRequest, NextResponse } from 'next/server';
import {
  publicChatLimits,
  rateLimited,
  readChatBody,
  readOrCreateVisitorId,
  setVisitorCookie,
  streamAnswer,
} from '@/lib/rag/http';
import { isChannelEnabled } from '@/lib/rag/settings';

export const dynamic = 'force-dynamic';

const PUBLIC_CHANNELS = new Set(['web', 'signup'] as const);

function channelFrom(request: NextRequest): 'web' | 'signup' {
  const c = request.nextUrl.searchParams.get('channel');
  return c === 'signup' ? 'signup' : 'web';
}

/** Widget boot: whether the assistant is on for this channel. */
export async function GET(request: NextRequest) {
  const channel = channelFrom(request);
  const enabled = PUBLIC_CHANNELS.has(channel) && (await isChannelEnabled(channel));
  const visitor = readOrCreateVisitorId(request);
  const res = NextResponse.json({ enabled, channel });
  if (visitor.isNew) setVisitorCookie(res, visitor.id);
  return res;
}

export async function POST(request: NextRequest) {
  const channel = channelFrom(request);
  if (!(await isChannelEnabled(channel))) {
    return NextResponse.json({ error: 'The assistant is not available right now.' }, { status: 503 });
  }
  const visitor = readOrCreateVisitorId(request);
  const limited = rateLimited(publicChatLimits(request, visitor.id));
  if (limited) return limited;

  const body = await readChatBody(request);
  if (body instanceof NextResponse) return body;

  const res = streamAnswer(request, {
    message: body.message,
    conversationId: body.conversationId,
    pagePath: body.pagePath,
    channel,
    audience: 'prospect',
    visitorId: visitor.id,
  });
  if (visitor.isNew) setVisitorCookie(res, visitor.id);
  return res;
}
