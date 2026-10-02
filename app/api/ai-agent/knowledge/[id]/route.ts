import { NextResponse } from 'next/server';
import { withWhatsAppPremiumApi } from '@/lib/security/premium-module-api';
import { deleteKnowledge, getKnowledge, KNOWLEDGE_LIMITS, updateKnowledge } from '@/lib/ai-agent/knowledge';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GET = withWhatsAppPremiumApi<{ id: string }>(
  { module: 'whatsapp', action: 'read' },
  async ({ businessId, params }) => {
    if (!UUID.test(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const item = await getKnowledge(businessId, params.id);
    if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ item });
  },
);

/** PATCH — edit an FAQ or note, or switch a draft to active. */
export const PATCH = withWhatsAppPremiumApi<{ id: string }>(
  { module: 'whatsapp', action: 'update', parseJsonBody: true },
  async ({ businessId, params, body }) => {
    if (!UUID.test(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const b = (body ?? {}) as Record<string, unknown>;
    const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : undefined);
    const patch = {
      title: str(b.title, KNOWLEDGE_LIMITS.titleMax),
      question: str(b.question, KNOWLEDGE_LIMITS.questionMax),
      answer: str(b.answer, KNOWLEDGE_LIMITS.answerMax),
      content: str(b.content, KNOWLEDGE_LIMITS.textMax),
      status: b.status === 'active' || b.status === 'draft' ? (b.status as 'active' | 'draft') : undefined,
    };
    if (patch.question === '' || patch.answer === '' || patch.content === '') {
      return NextResponse.json({ error: 'This field cannot be empty' }, { status: 400 });
    }
    try {
      const item = await updateKnowledge(businessId, params.id, patch);
      if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      return NextResponse.json({ item });
    } catch (error) {
      console.error('[ai-agent] knowledge PATCH failed:', error);
      return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
    }
  },
);

export const DELETE = withWhatsAppPremiumApi<{ id: string }>(
  { module: 'whatsapp', action: 'update' },
  async ({ businessId, params }) => {
    if (!UUID.test(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const ok = await deleteKnowledge(businessId, params.id);
    if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  },
);
