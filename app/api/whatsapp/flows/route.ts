export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { withWhatsAppPremiumApi } from '@/lib/security/premium-module-api';
import { assertNotConnectAgentWrite } from '@/lib/security/whatsapp-api-gates';
import { createFlow, listFlows } from '@/lib/whatsapp/flows/store';
import { emptyFlowDefinition, parseFlowDefinition } from '@/lib/whatsapp/flows/schema';
import { shopOrderStarterDefinition } from '@/lib/whatsapp/flows/starter';

export const GET = withWhatsAppPremiumApi({ managePermission: true }, async ({ businessId }) => {
  const flows = await listFlows(businessId);
  return NextResponse.json({ flows });
});

export const POST = withWhatsAppPremiumApi({ parseJsonBody: true, managePermission: true }, async ({ businessId, userId, body, request }) => {
  const blocked = await assertNotConnectAgentWrite({ request, userId });
  if (blocked) return blocked;
  const raw = body && typeof body === 'object' ? (body as { name?: unknown; starter?: unknown; definition?: unknown }) : {};
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!name) return NextResponse.json({ error: 'Give this flow a name.' }, { status: 400 });
  let definition = emptyFlowDefinition();
  if (raw.starter === 'shop_order') definition = shopOrderStarterDefinition();
  else if (raw.definition) {
    const parsed = parseFlowDefinition(raw.definition);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    definition = parsed.data;
  }
  try {
    const flow = await createFlow(businessId, userId, { name, definition });
    return NextResponse.json({ flow }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Could not create flow';
    if (msg.includes('unique') || msg.includes('duplicate')) {
      return NextResponse.json({ error: 'A flow with that name already exists.' }, { status: 409 });
    }
    return NextResponse.json({ error: msg }, { status: 400 });
  }
});
