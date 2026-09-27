import { NextRequest, NextResponse } from 'next/server';
import { readOrCreateVisitorId } from '@/lib/rag/http';
import { handleHistory } from '@/lib/rag/route-handlers';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const visitor = readOrCreateVisitorId(request);
  if (visitor.isNew) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
  const channel = request.nextUrl.searchParams.get('channel') === 'signup' ? 'signup' : 'web';
  return handleHistory(params.id, { channel, audience: 'prospect', visitorId: visitor.id });
}
