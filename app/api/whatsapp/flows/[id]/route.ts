export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { withWhatsAppPremiumApi } from '@/lib/security/premium-module-api';
import { assertNotConnectAgentWrite } from '@/lib/security/whatsapp-api-gates';
import { deleteFlow, getFlow, updateFlow } from '@/lib/whatsapp/flows/store';
import { parseFlowDefinition, type FlowDefinition } from '@/lib/whatsapp/flows/schema';

export const GET = withWhatsAppPremiumApi<{ id: string }>({ managePermission: true }, async ({ businessId, params }) => {
  const flow = await getFlow(businessId, params.id);
  if (!flow) return NextResponse.json({ error: 'Flow not found' }, { status: 404 });
  return NextResponse.json({ flow });
});

export const PATCH = withWhatsAppPremiumApi<{ id: string }>(
  { parseJsonBody: true, managePermission: true },
  async ({ businessId, userId, params, body, request }) => {
    const blocked = await assertNotConnectAgentWrite({ request, userId });
    if (blocked) return blocked;
    const raw = body && typeof body === 'object' ? (body as { name?: unknown; definition?: unknown }) : {};
    const patch: { name?: string; definition?: FlowDefinition } = {};
    if (typeof raw.name === 'string') patch.name = raw.name;
    if (raw.definition) {
      const parsed = parseFlowDefinition(raw.definition);
      if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
      patch.definition = parsed.data;
    }
    try {
      const flow = await updateFlow(businessId, userId, params.id, patch);
      if (!flow) return NextResponse.json({ error: 'Flow not found' }, { status: 404 });
      return NextResponse.json({ flow });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not save' }, { status: 400 });
    }
  },
);

export const DELETE = withWhatsAppPremiumApi<{ id: string }>({ managePermission: true }, async ({ businessId, userId, params, request }) => {
  const blocked = await assertNotConnectAgentWrite({ request, userId });
  if (blocked) return blocked;
  const ok = await deleteFlow(businessId, params.id);
  if (!ok) return NextResponse.json({ error: 'Flow not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
});
