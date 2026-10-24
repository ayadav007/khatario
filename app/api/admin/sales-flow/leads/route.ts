import { NextRequest, NextResponse } from 'next/server';
import { requirePlatformRequest } from '@/lib/platform-request-auth';
import { listAssignees, listPipelineLeads } from '@/lib/sales-funnel/admin';
import { getPublishedFlow } from '@/lib/sales-funnel/store';
import { listFunnelTemplates } from '@/lib/sales-funnel/templates';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requirePlatformRequest(request, 'support');
  if (!auth.ok) return auth.response;
  const p = request.nextUrl.searchParams;
  try {
    const [result, assignees, published, templates] = await Promise.all([
      listPipelineLeads({
        status: p.get('status'),
        campaign: p.get('campaign'),
        adId: p.get('ad_id'),
        assignedTo: p.get('assigned_to'),
        q: p.get('q'),
        page: Number(p.get('page')) || 1,
        pageSize: Number(p.get('page_size')) || 50,
      }),
      listAssignees(),
      getPublishedFlow(),
      listFunnelTemplates(),
    ]);
    return NextResponse.json({
      ...result,
      assignees,
      steps: published.flow.steps.map((s) => ({ id: s.id, label: s.label })),
      templates: templates
        .filter((t) => t.status === 'approved')
        .map((t) => ({ event_key: t.event_key, name: t.name })),
    });
  } catch (err) {
    console.error('[admin/sales-flow/leads] failed:', err);
    return NextResponse.json({ error: 'Could not load leads' }, { status: 500 });
  }
}
