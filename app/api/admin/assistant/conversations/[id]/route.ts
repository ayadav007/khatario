import { NextRequest, NextResponse } from 'next/server';
import { requirePlatformRequest } from '@/lib/platform-request-auth';
import { getConversation } from '@/lib/rag/admin';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requirePlatformRequest(request, 'support');
  if (!auth.ok) return auth.response;
  if (!UUID_RE.test(params.id)) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });

  const data = await getConversation(params.id);
  if (!data) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
  return NextResponse.json(data);
}
