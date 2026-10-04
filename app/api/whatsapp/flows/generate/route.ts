export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { withWhatsAppPremiumApi } from '@/lib/security/premium-module-api';
import { assertNotConnectAgentWrite } from '@/lib/security/whatsapp-api-gates';
import { checkRateLimit } from '@/lib/rate-limit';
import { generateFlowDefinition } from '@/lib/whatsapp/flows/generate';
import { createFlow } from '@/lib/whatsapp/flows/store';

export const POST = withWhatsAppPremiumApi({ parseJsonBody: true, managePermission: true }, async ({ businessId, userId, body, request }) => {
  const blocked = await assertNotConnectAgentWrite({ request, userId });
  if (blocked) return blocked;
  const rl = checkRateLimit(`whatsapp-flows-generate:${businessId}`, 5, 60 * 60_000);
  if (!rl.allowed) return NextResponse.json({ error: 'Try again in a little while.' }, { status: 429 });
  const raw = body && typeof body === 'object' ? (body as { prompt?: unknown }) : {};
  const prompt = typeof raw.prompt === 'string' ? raw.prompt.trim() : '';
  if (prompt.length < 8) {
    return NextResponse.json({ error: 'Describe what the flow should do in a bit more detail.' }, { status: 400 });
  }
  const result = await generateFlowDefinition(businessId, prompt);
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status });
  const name = `Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
  try {
    const flow = await createFlow(businessId, userId, { name, definition: result.definition });
    return NextResponse.json({ flow }, { status: 201 });
  } catch {
    const flow = await createFlow(businessId, userId, {
      name: `${name} ${Date.now().toString().slice(-4)}`,
      definition: result.definition,
    });
    return NextResponse.json({ flow }, { status: 201 });
  }
});
