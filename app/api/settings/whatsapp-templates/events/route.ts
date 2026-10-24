import { NextRequest, NextResponse } from 'next/server';
import { isTenantWaEventKey } from '@/lib/whatsapp/tenant-events';
import { withTenantTemplates } from '@/lib/whatsapp/tenant-template-route';
import { listEventMappings, setEventMapping } from '@/lib/whatsapp/tenant-templates';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest) {
  return withTenantTemplates(request, 'read', async ({ businessId }) => {
    return NextResponse.json({ mappings: await listEventMappings(businessId) });
  });
}

/** Body: { event_key, template_id | null, variable_map: string[] }. A null template clears the choice. */
export async function PUT(request: NextRequest) {
  return withTenantTemplates(request, 'update', async ({ businessId, userId }) => {
    const body = (await request.json().catch(() => ({}))) as {
      event_key?: unknown;
      template_id?: unknown;
      variable_map?: unknown;
    };
    if (!isTenantWaEventKey(body.event_key)) {
      return NextResponse.json({ error: 'Unknown message type' }, { status: 400 });
    }
    const templateId = body.template_id == null || body.template_id === '' ? null : String(body.template_id);
    if (templateId && !UUID_RE.test(templateId)) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    }
    const variableMap = Array.isArray(body.variable_map) ? body.variable_map.map(String).slice(0, 20) : [];
    await setEventMapping(businessId, userId, body.event_key, templateId, variableMap);
    return NextResponse.json({ mappings: await listEventMappings(businessId) });
  });
}
