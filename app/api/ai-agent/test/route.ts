import { NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { withWhatsAppPremiumApi } from '@/lib/security/premium-module-api';
import { checkRateLimit } from '@/lib/rate-limit';
import { loadAgentSettings } from '@/lib/ai-agent/settings';
import { matchesTriggerPhrase, isOutsideBusinessHours } from '@/lib/ai-agent/gate';
import { parseAgentReply } from '@/lib/ai-agent/prompt';
import { ORDER_NOT_CREATED_REPLY, parseCreateOrderTag, parseCustomerTag, resolveOrderItems, stripOrderTags } from '@/lib/ai-agent/order-items';
import { DEFAULT_FALLBACK_MESSAGE, DEFAULT_HANDOFF_MESSAGE, normalizeAgentSettings } from '@/lib/ai-agent/types';
import { SalesAgentChatbot, type SalesAgentResult } from '@/lib/services/sales-agent-chatbot';

export const dynamic = 'force-dynamic';

const MAX_HISTORY = 12;
const MAX_MESSAGE = 1000;

const FAILURE_MESSAGE: Record<string, string> = {
  trial_exhausted: 'Your free Khatario AI test replies are used up. Get the Khatario AI add-on or switch to your own API key.',
  quota_exhausted: "This month's Khatario AI replies are used up.",
  no_key: 'Add your API key in the Advanced section to test.',
  not_configured: 'Choose how to power your agent in the Advanced section.',
  live_needs_addon: 'Khatario AI needs the add-on.',
};

type Chip = { kind: 'order' | 'payment' | 'handoff' | 'lead' | 'greeting' | 'after_hours' | 'fallback'; label: string };

const FALLBACK_SUFFIX = 'so your fallback message would be sent';

/** Owner-facing reason. Upstream error text is shown only for the shop's own key, never Khatario's. */
function fallbackReason(result: Pick<SalesAgentResult, 'failure' | 'via' | 'errorMessage'>): string {
  if (result.failure === 'empty') return `The AI returned an empty reply, ${FALLBACK_SUFFIX}`;
  if (result.failure === 'error') {
    const status = /\b(\d{3})\b/.exec(result.errorMessage ?? '')?.[1];
    if (result.via === 'own') {
      const detail = (result.errorMessage ?? '').replace(/\s+/g, ' ').slice(0, 160);
      return `Your AI provider returned an error${detail ? ` (${detail})` : ''}, ${FALLBACK_SUFFIX}`;
    }
    return `Khatario AI is unavailable right now${status ? ` (error ${status})` : ''}, ${FALLBACK_SUFFIX}`;
  }
  return `The AI gave no answer, ${FALLBACK_SUFFIX}`;
}

/**
 * POST /api/ai-agent/test — `{ message, history, draftSettings? }`. Runs the same prompt, knowledge
 * and provider as the live bot on unsaved settings. Nothing is sent to WhatsApp or stored.
 */
export const POST = withWhatsAppPremiumApi(
  { module: 'whatsapp', action: 'update', parseJsonBody: true },
  async ({ businessId, body }) => {
    const rl = checkRateLimit(`ai-agent-test:${businessId}`, 30, 60_000);
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many test messages. Wait a minute and try again.' }, { status: 429 });
    }

    const b = (body ?? {}) as { message?: unknown; history?: unknown; draftSettings?: unknown };
    const message = typeof b.message === 'string' ? b.message.trim().slice(0, MAX_MESSAGE) : '';
    if (!message) return NextResponse.json({ error: 'Type a message' }, { status: 400 });

    const history = (Array.isArray(b.history) ? b.history : [])
      .filter((m): m is { role: 'user' | 'assistant'; content: string } =>
        !!m && typeof m === 'object' &&
        ((m as { role?: unknown }).role === 'user' || (m as { role?: unknown }).role === 'assistant') &&
        typeof (m as { content?: unknown }).content === 'string')
      .slice(-MAX_HISTORY)
      .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_MESSAGE) }));

    const settings = b.draftSettings ? normalizeAgentSettings(b.draftSettings) : await loadAgentSettings(businessId);
    const chips: Chip[] = [];

    if (settings.handoff.enabled && matchesTriggerPhrase(message, settings.handoff.triggerPhrases)) {
      chips.push({ kind: 'handoff', label: 'Would hand off to your team and pause the AI' });
      return NextResponse.json({ reply: settings.handoff.message.trim() || DEFAULT_HANDOFF_MESSAGE, chips, sources: [] });
    }

    const firstMessage = history.length === 0;
    if (firstMessage && settings.behavior.businessHours && isOutsideBusinessHours(settings.behavior.businessHours)) {
      chips.push({ kind: 'after_hours', label: 'Outside business hours: your after-hours message is sent first (once a day)' });
    }

    const biz = await queryOne<{
      name: string; company_introduction: string | null; industry: string | null; business_type: string | null;
      phone: string | null; email: string | null; address_line1: string | null;
    }>(
      `SELECT name, company_introduction, industry, business_type, phone, email, address_line1 FROM businesses WHERE id = $1`,
      [businessId],
    );

    const chatbot = new SalesAgentChatbot();
    const result = await chatbot.generate(businessId, {
      message,
      companyInfo: {
        name: biz?.name ?? 'Our shop',
        introduction: biz?.company_introduction ?? undefined,
        industry: biz?.industry ?? undefined,
        businessType: biz?.business_type ?? undefined,
        phone: biz?.phone ?? undefined,
        email: biz?.email ?? undefined,
        address: biz?.address_line1 ?? undefined,
      },
      conversationHistory: history,
      test: true,
      live: false,
      settingsOverride: settings,
    });

    if (!result.content?.trim()) {
      const known = result.failure ? FAILURE_MESSAGE[result.failure] : undefined;
      if (known) return NextResponse.json({ error: known, code: result.failure }, { status: 402 });
      chips.push({ kind: 'fallback', label: fallbackReason(result) });
      return NextResponse.json({ reply: settings.fallbackMessage.trim() || DEFAULT_FALLBACK_MESSAGE, chips, sources: result.sources });
    }

    const parsed = parseAgentReply(result.content);
    let reply = parsed.text;
    const collectedCustomer = parseCustomerTag(reply);
    reply = reply.replace(/CUSTOMER:\s*\{[\s\S]*?\}\s*/g, '');

    if (/CREATE_ORDER:/.test(reply)) {
      const lines = parseCreateOrderTag(reply);
      const resolved = lines ? await resolveOrderItems(businessId, lines).catch(() => null) : null;
      reply = stripOrderTags(reply.replace(/CREATE_ORDER:\s*\{[\s\S]*?\}\s*/g, ''));
      if (resolved?.items.length) {
        const summary = resolved.items.map((i) => `${i.name} ×${i.quantity}`).join(', ');
        const missing = resolved.unmatched.length ? ` (skipped, not in catalogue: ${resolved.unmatched.join(', ')})` : '';
        const forWhom = collectedCustomer?.name ? ` for ${collectedCustomer.name}` : '';
        chips.push({ kind: 'order', label: `Test only, nothing saved. On WhatsApp this creates a draft sales order${forWhom}: ${summary}${missing}` });
      } else {
        const missing = resolved?.unmatched.length ? `: ${resolved.unmatched.join(', ')} not in your catalogue` : '';
        chips.push({ kind: 'fallback', label: `On WhatsApp no order would be created${missing}, so the customer gets a holding reply` });
        reply = ORDER_NOT_CREATED_REPLY;
      }
    }
    if (/\[(insert )?payment link\]/i.test(reply)) {
      if (settings.skills.paymentLinks) {
        chips.push({ kind: 'payment', label: 'Would send a UPI payment link' });
        reply = reply.replace(/\[(insert )?payment link\]/gi, 'https://pay.example/…');
      } else {
        reply = reply.replace(/\[(insert )?payment link\]/gi, '').trim();
      }
    }
    if (parsed.handoff && settings.handoff.enabled) {
      chips.push({ kind: 'handoff', label: 'Would hand off to your team and pause the AI' });
      if (!reply) reply = settings.handoff.message.trim() || DEFAULT_HANDOFF_MESSAGE;
    }
    if (collectedCustomer?.name) {
      chips.push({ kind: 'lead', label: `Would remember the customer's name: ${collectedCustomer.name}` });
    }
    const lead = Object.entries(parsed.leadData);
    if (lead.length) {
      chips.push({ kind: 'lead', label: `Would save ${lead.map(([k, v]) => `${k}: ${v}`).join(', ')}` });
    }
    if (firstMessage && settings.greetingMessage.trim()) {
      chips.push({ kind: 'greeting', label: 'Greeting added for a new customer' });
      reply = `${settings.greetingMessage.trim()}\n\n${reply}`;
    }

    return NextResponse.json({
      reply: reply || settings.fallbackMessage.trim() || DEFAULT_FALLBACK_MESSAGE,
      quickReplies: settings.quickRepliesEnabled ? parsed.quickReplies : [],
      chips,
      sources: result.sources,
      via: result.via,
    });
  },
);
