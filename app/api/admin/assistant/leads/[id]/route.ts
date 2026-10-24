import { NextRequest, NextResponse } from 'next/server';
import { requirePlatformRequest } from '@/lib/platform-request-auth';
import { logAdminAction } from '@/lib/platform-auth';
import { LeadUpdateSchema, updateLead } from '@/lib/rag/admin';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requirePlatformRequest(request, 'support');
  if (!auth.ok) return auth.response;
  if (!UUID_RE.test(params.id)) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });

  const parsed = LeadUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid body' }, { status: 400 });

  const lead = await updateLead(params.id, parsed.data);
  if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });

  await logAdminAction(
    auth.admin.id,
    'update_assistant_lead',
    'assistant_lead',
    params.id,
    { status: parsed.data.status },
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || undefined,
    request.headers.get('user-agent') || undefined,
  );
  return NextResponse.json({ lead });
}
