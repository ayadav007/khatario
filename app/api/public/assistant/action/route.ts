import { NextRequest } from 'next/server';
import { getClientIp } from '@/lib/rate-limit';
import { rateLimited, readOrCreateVisitorId } from '@/lib/rag/http';
import { handleAction } from '@/lib/rag/route-handlers';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const visitor = readOrCreateVisitorId(request);
  const limited = rateLimited([
    [`assistant:action:ip:${getClientIp(request)}`, 12, 60_000],
    [`assistant:action:visitor:${visitor.id}`, 8, 60_000],
  ]);
  if (limited) return limited;
  const channel = request.nextUrl.searchParams.get('channel') === 'signup' ? 'signup' : 'web';
  return handleAction(request, { channel, audience: 'prospect', visitorId: visitor.isNew ? null : visitor.id });
}
