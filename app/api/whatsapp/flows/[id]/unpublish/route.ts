export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { withWhatsAppPremiumApi } from '@/lib/security/premium-module-api';
import { assertNotConnectAgentWrite } from '@/lib/security/whatsapp-api-gates';
import { unpublishFlow } from '@/lib/whatsapp/flows/store';

export const POST = withWhatsAppPremiumApi<{ id: string }>({ managePermission: true }, async ({ businessId, userId, params, request }) => {
  const blocked = await assertNotConnectAgentWrite({ request, userId });
  if (blocked) return blocked;
  const flow = await unpublishFlow(businessId, userId, params.id);
  if (!flow) return NextResponse.json({ error: 'Flow not found' }, { status: 404 });
  return NextResponse.json({ flow });
});
