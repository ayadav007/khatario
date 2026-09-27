import { NextRequest } from 'next/server';
import { getClientIp } from '@/lib/rate-limit';
import { rateLimited, readOrCreateVisitorId } from '@/lib/rag/http';
import { handleFeedback } from '@/lib/rag/route-handlers';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const visitor = readOrCreateVisitorId(request);
  const limited = rateLimited([[`assistant:feedback:ip:${getClientIp(request)}`, 30, 60_000]]);
  if (limited) return limited;
  const channel = request.nextUrl.searchParams.get('channel') === 'signup' ? 'signup' : 'web';
  return handleFeedback(request, { channel, audience: 'prospect', visitorId: visitor.isNew ? null : visitor.id });
}
