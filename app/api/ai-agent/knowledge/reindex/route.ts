import { NextResponse } from 'next/server';
import { withWhatsAppPremiumApi } from '@/lib/security/premium-module-api';
import { enqueueKbReindex } from '@/lib/rag/queue';
import { checkRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

/** POST /api/ai-agent/knowledge/reindex — rebuild this shop's knowledge now. */
export const POST = withWhatsAppPremiumApi({ module: 'whatsapp', action: 'update' }, async ({ businessId }) => {
  const rl = checkRateLimit(`ai-agent-reindex:${businessId}`, 3, 10 * 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Knowledge is already being rebuilt. Try again in a few minutes.' }, { status: 429 });
  }
  const mode = await enqueueKbReindex({ target: 'tenant', businessId, reason: 'ai agent manual reindex', force: true });
  return NextResponse.json({ ok: true, mode });
});
