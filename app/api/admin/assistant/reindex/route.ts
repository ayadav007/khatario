import { NextRequest, NextResponse } from 'next/server';
import { requirePlatformRequest } from '@/lib/platform-request-auth';
import { logAdminAction } from '@/lib/platform-auth';
import { ReindexSchema } from '@/lib/rag/admin';
import { enqueueKbReindex } from '@/lib/rag/queue';

export const dynamic = 'force-dynamic';

/** POST /api/admin/assistant/reindex — body { target?: 'markdown'|'plans'|'marketing'|'all', force?: boolean } */
export async function POST(request: NextRequest) {
  const auth = await requirePlatformRequest(request, 'admin');
  if (!auth.ok) return auth.response;

  const parsed = ReindexSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid re-index request' }, { status: 400 });

  const mode = await enqueueKbReindex({ ...parsed.data, reason: `admin:${auth.admin.id}` });
  await logAdminAction(
    auth.admin.id,
    'reindex_assistant_knowledge',
    'kb_sources',
    undefined,
    { target: parsed.data.target, force: parsed.data.force ?? false, mode },
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || undefined,
    request.headers.get('user-agent') || undefined,
  );
  return NextResponse.json({ status: mode });
}
