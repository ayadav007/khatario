import { NextRequest, NextResponse } from 'next/server';
import { requirePlatformRequest } from '@/lib/platform-request-auth';
import { logAdminAction } from '@/lib/platform-auth';
import { MetaWhatsAppError } from '@/lib/meta-whatsapp';
import { syncPlatformWhatsAppTemplates } from '@/lib/platform-whatsapp-templates';
import { FUNNEL_TEMPLATES, listFunnelTemplates, seedFunnelTemplates } from '@/lib/sales-funnel/templates';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requirePlatformRequest(request, 'support');
  if (!auth.ok) return auth.response;
  const templates = await listFunnelTemplates();
  const purposes = Object.fromEntries(FUNNEL_TEMPLATES.map((t) => [t.event_key, t.purpose]));
  const missing = FUNNEL_TEMPLATES.filter((t) => !templates.some((r) => r.event_key === t.event_key)).map((t) => t.event_key);
  return NextResponse.json({ templates, purposes, missing });
}

/** action: seed (create missing drafts) or sync (refresh statuses from Meta). */
export async function POST(request: NextRequest) {
  const auth = await requirePlatformRequest(request, 'admin');
  if (!auth.ok) return auth.response;
  const body = (await request.json().catch(() => null)) as { action?: string } | null;
  try {
    if (body?.action === 'seed') {
      const result = await seedFunnelTemplates(auth.admin.id);
      await logAdminAction(auth.admin.id, 'sales_flow_templates_seed', 'platform_whatsapp_template', undefined, result);
      return NextResponse.json(result);
    }
    if (body?.action === 'sync') {
      await syncPlatformWhatsAppTemplates();
      return NextResponse.json({ templates: await listFunnelTemplates() });
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    if (err instanceof MetaWhatsAppError) return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
