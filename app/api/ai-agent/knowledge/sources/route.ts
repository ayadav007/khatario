import { NextResponse } from 'next/server';
import { withWhatsAppPremiumApi } from '@/lib/security/premium-module-api';
import { listKnowledgeSources } from '@/lib/ai-agent/knowledge-status';

export const dynamic = 'force-dynamic';

/** GET /api/ai-agent/knowledge/sources — index status of this shop's knowledge (catalogue, policies, FAQs, notes, files). */
export const GET = withWhatsAppPremiumApi({ module: 'whatsapp', action: 'read' }, async ({ businessId }) => {
  return NextResponse.json({ sources: await listKnowledgeSources(businessId) });
});
