import { NextRequest, NextResponse } from 'next/server';
import { requirePlatformRequest } from '@/lib/platform-request-auth';
import { ADMIN_VIEWS, loadAdminView, type AdminView } from '@/lib/rag/admin';

export const dynamic = 'force-dynamic';

/** GET /api/admin/assistant?view=overview|conversations|leads|unanswered|feedback|sources */
export async function GET(request: NextRequest) {
  // Conversations and leads hold visitor phone numbers and messages: support and above only.
  const auth = await requirePlatformRequest(request, 'support');
  if (!auth.ok) return auth.response;

  const params = request.nextUrl.searchParams;
  const view = (params.get('view') ?? 'overview') as AdminView;
  if (!ADMIN_VIEWS.includes(view)) return NextResponse.json({ error: 'Unknown view' }, { status: 400 });

  try {
    return NextResponse.json(await loadAdminView(view, params));
  } catch (err) {
    console.error('[admin/assistant] view failed:', view, err);
    return NextResponse.json({ error: 'Could not load assistant data. Has migration 302 run?' }, { status: 500 });
  }
}
