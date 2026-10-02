import { NextResponse } from 'next/server';
import { withWhatsAppPremiumApi } from '@/lib/security/premium-module-api';
import { checkRateLimit } from '@/lib/rate-limit';
import { helperCompletion, HelperAiError, parseJsonArray } from '@/lib/ai-agent/helper-ai';
import { listKnowledge } from '@/lib/ai-agent/knowledge';
import {
  loadTenantCatalogSource,
  loadTenantFileSource,
  loadTenantPolicySource,
  loadTenantTextSource,
} from '@/lib/rag/ingest/tenant-sources';

export const dynamic = 'force-dynamic';

const MATERIAL_MAX = 12_000;

async function shopMaterial(businessId: string): Promise<string> {
  const [policy, catalog, notes, files] = await Promise.all([
    loadTenantPolicySource(businessId).catch(() => null),
    loadTenantCatalogSource(businessId).catch(() => null),
    loadTenantTextSource(businessId).catch(() => null),
    loadTenantFileSource(businessId).catch(() => null),
  ]);
  const parts: string[] = [];
  for (const d of policy?.documents ?? []) parts.push(d.body.slice(0, 2500));
  for (const d of [...(notes?.documents ?? []), ...(files?.documents ?? [])]) parts.push(d.body.slice(0, 2500));
  const items = (catalog?.documents ?? []).slice(0, 40).map((d) => d.body.split('\n').slice(0, 4).join(' | '));
  if (items.length) parts.push(`# Products\n${items.join('\n')}`);
  return parts.join('\n\n').slice(0, MATERIAL_MAX);
}

/**
 * POST /api/ai-agent/knowledge/generate-faqs — 8-10 draft FAQs from the shop's catalogue, policies
 * and notes. Nothing is saved: the owner reviews and adds the ones they want.
 */
export const POST = withWhatsAppPremiumApi({ module: 'whatsapp', action: 'update' }, async ({ businessId }) => {
  const rl = checkRateLimit(`ai-agent-gen-faqs:${businessId}`, 5, 60 * 60_000);
  if (!rl.allowed) return NextResponse.json({ error: 'Try again in a little while.' }, { status: 429 });

  const material = await shopMaterial(businessId);
  if (material.length < 80) {
    return NextResponse.json(
      { error: 'Add some items, store policies or notes first — there is not enough to write FAQs from.' },
      { status: 400 },
    );
  }
  const existing = (await listKnowledge(businessId)).filter((k) => k.kind === 'faq').map((k) => k.question);

  try {
    const raw = await helperCompletion(
      businessId,
      'You write FAQ entries for a small business WhatsApp assistant. Use only facts in the material. Never invent prices, timings or policies. Reply with a JSON array only: [{"question":"...","answer":"..."}]. Questions are what a customer would type; answers are 1-3 short sentences.',
      `Write 8 to 10 FAQs from this shop material.${existing.length ? `\nSkip these, they already exist:\n- ${existing.slice(0, 30).join('\n- ')}` : ''}\n\nMATERIAL:\n${material}`,
    );
    const faqs = parseJsonArray<{ question?: unknown; answer?: unknown }>(raw)
      .map((f) => ({
        question: typeof f.question === 'string' ? f.question.trim().slice(0, 300) : '',
        answer: typeof f.answer === 'string' ? f.answer.trim().slice(0, 2000) : '',
      }))
      .filter((f) => f.question && f.answer)
      .slice(0, 10);
    if (!faqs.length) return NextResponse.json({ error: "Couldn't write FAQs this time. Try again." }, { status: 502 });
    return NextResponse.json({ faqs });
  } catch (error) {
    if (error instanceof HelperAiError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('[ai-agent] generate-faqs failed:', error);
    return NextResponse.json({ error: "Couldn't write FAQs this time. Try again." }, { status: 502 });
  }
});
