import { NextResponse } from 'next/server';
import { withWhatsAppPremiumApi } from '@/lib/security/premium-module-api';
import {
  countKnowledge,
  createKnowledge,
  KNOWLEDGE_LIMITS,
  listKnowledge,
  parseKnowledgeInput,
  validateKnowledge,
} from '@/lib/ai-agent/knowledge';

export const dynamic = 'force-dynamic';

/** GET /api/ai-agent/knowledge — the owner's FAQs, notes and uploaded files (previews only). */
export const GET = withWhatsAppPremiumApi({ module: 'whatsapp', action: 'read' }, async ({ businessId }) => {
  try {
    return NextResponse.json({ items: await listKnowledge(businessId) });
  } catch (error) {
    console.error('[ai-agent] knowledge GET failed:', error);
    return NextResponse.json({ error: 'Failed to load knowledge' }, { status: 500 });
  }
});

/** POST /api/ai-agent/knowledge — add an FAQ (`{kind:'faq', question, answer}`) or pasted text (`{kind:'text', title, content}`). */
export const POST = withWhatsAppPremiumApi(
  { module: 'whatsapp', action: 'update', parseJsonBody: true },
  async ({ businessId, userId, body }) => {
    try {
      const input = parseKnowledgeInput((body ?? {}) as Record<string, unknown>);
      if (input.kind === 'file') {
        return NextResponse.json({ error: 'Use the upload endpoint for files' }, { status: 400 });
      }
      const invalid = validateKnowledge(input);
      if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });
      if ((await countKnowledge(businessId)) >= KNOWLEDGE_LIMITS.maxItems) {
        return NextResponse.json({ error: `You can add up to ${KNOWLEDGE_LIMITS.maxItems} knowledge items` }, { status: 400 });
      }
      const item = await createKnowledge(businessId, input, userId);
      return NextResponse.json({ item }, { status: 201 });
    } catch (error) {
      console.error('[ai-agent] knowledge POST failed:', error);
      return NextResponse.json({ error: 'Failed to save knowledge' }, { status: 500 });
    }
  },
);
