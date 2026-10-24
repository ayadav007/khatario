import { NextResponse } from 'next/server';
import { withWhatsAppPremiumApi } from '@/lib/security/premium-module-api';
import { checkRateLimit } from '@/lib/rate-limit';
import { helperCompletion, HelperAiError, parseJsonArray } from '@/lib/ai-agent/helper-ai';
import { loadAgentSettings } from '@/lib/ai-agent/settings';

export const dynamic = 'force-dynamic';

/** POST /api/ai-agent/lead-questions/suggest — 3-5 qualification questions that fit this business. */
export const POST = withWhatsAppPremiumApi({ module: 'whatsapp', action: 'update' }, async ({ businessId }) => {
  const rl = checkRateLimit(`ai-agent-lead-q:${businessId}`, 10, 60 * 60_000);
  if (!rl.allowed) return NextResponse.json({ error: 'Try again in a little while.' }, { status: 429 });

  const settings = await loadAgentSettings(businessId);
  const about = [settings.businessSummary, settings.behavior.advanced?.industryTemplate]
    .filter(Boolean)
    .join('\n')
    .slice(0, 2000);
  try {
    const raw = await helperCompletion(
      businessId,
      'You help small Indian businesses qualify WhatsApp leads. Reply with a JSON array of 3 to 5 short questions (strings) a salesperson would ask before following up, e.g. budget, quantity, city, timeline. No numbering, no extra text.',
      `Business:\n${about || 'A small business selling products to customers.'}`,
    );
    const questions = parseJsonArray<unknown>(raw)
      .filter((q): q is string => typeof q === 'string')
      .map((q) => q.trim().slice(0, 200))
      .filter(Boolean)
      .slice(0, 5);
    if (!questions.length) return NextResponse.json({ error: "Couldn't suggest questions. Try again." }, { status: 502 });
    return NextResponse.json({ questions });
  } catch (error) {
    if (error instanceof HelperAiError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('[ai-agent] suggest questions failed:', error);
    return NextResponse.json({ error: "Couldn't suggest questions. Try again." }, { status: 502 });
  }
});
