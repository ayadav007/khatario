import { queryOne } from '@/lib/db';
import { matchCommand } from '@/lib/insights/commands';
import { appBaseUrl, toWhatsAppText } from '@/lib/insights/format';
import { sendTextMessage } from '@/lib/meta-whatsapp';
import { answerTurn, type AssistantAction } from '@/lib/rag/answer';
import { isChannelEnabled } from '@/lib/rag/settings';
import type { Citation } from '@/lib/rag/types';
import type { PlatformIncomingQueueJob } from '@/lib/whatsapp-queue-types';

export const PLATFORM_REPLY_MAX = 1000;
export const PLATFORM_MESSAGES_PER_HOUR = 30;
const CONVERSATION_IDLE_HOURS = 24;

const OWNER_ON_OWN_NUMBER =
  'Your business figures come from your own business WhatsApp number, not this one. In Khatario open Settings > WhatsApp > Owner updates to link your phone, or ask in the app.';

export function siteUrl(): string {
  return appBaseUrl() || 'https://khatario.com';
}

function absolute(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `${siteUrl()}${url.startsWith('/') ? '' : '/'}${url}`;
}

/** Buttons in the web widget become a line with a link on WhatsApp. */
export function actionToText(action: AssistantAction): string | null {
  switch (action.type) {
    case 'book_demo':
      return `Book a free demo: ${absolute('/book-demo')}`;
    case 'start_trial':
      return `Start your free trial: ${absolute('/signup?src=whatsapp')}`;
    case 'recommend_plan':
      return `Compare plans: ${absolute('/pricing')}`;
    case 'talk_to_human':
      return 'Our team will reply to you here shortly.';
    case 'upgrade':
      return `Upgrade: ${absolute(action.url)}`;
    default:
      return null;
  }
}

function capText(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).replace(/\s+\S*$/, '')}…`;
}

/** WhatsApp reply for a prospect: plain formatting, about 1,000 characters, the first source link and action links. */
export function platformReplyText(input: { text: string; citations: Citation[]; actions: AssistantAction[] }): string {
  const body = capText(toWhatsAppText(input.text), PLATFORM_REPLY_MAX);
  const extra: string[] = [];
  const source = input.citations.find((c) => c.url);
  if (source?.url) extra.push(`More: ${absolute(source.url)}`);
  for (const a of input.actions) {
    const line = actionToText(a);
    if (line && !extra.includes(line)) extra.push(line);
  }
  return [body, ...extra].filter(Boolean).join('\n\n');
}

interface KnownUser {
  user_id: string;
  business_id: string;
}

/** An active Khatario user with this WhatsApp number gets staff help; everyone else is a prospect. */
async function findUserByPhone(phone: string): Promise<KnownUser | null> {
  const last10 = phone.replace(/\D/g, '').slice(-10);
  if (last10.length < 10) return null;
  return queryOne<KnownUser>(
    `SELECT u.id AS user_id, u.business_id
       FROM users u
      WHERE u.is_active = TRUE AND u.business_id IS NOT NULL AND u.phone IS NOT NULL
        AND right(regexp_replace(u.phone, '\\D', '', 'g'), 10) = $1
      ORDER BY u.updated_at DESC NULLS LAST
      LIMIT 1`,
    [last10],
  ).catch(() => null);
}

async function messagesLastHour(phone: string): Promise<number> {
  const row = await queryOne<{ n: string }>(
    `SELECT COUNT(*) AS n FROM whatsapp_inbound_events
      WHERE provider = 'platform' AND direction = 'in' AND sender_phone = $1 AND created_at > NOW() - INTERVAL '1 hour'`,
    [phone],
  ).catch(() => null);
  return Number(row?.n ?? 0);
}

async function recentConversationId(phone: string, audience: string): Promise<string | null> {
  const row = await queryOne<{ id: string }>(
    `SELECT id FROM kb_conversations
      WHERE channel = 'whatsapp' AND phone = $1 AND audience = $2
        AND COALESCE(last_message_at, created_at) > NOW() - ($3 || ' hours')::interval
      ORDER BY COALESCE(last_message_at, created_at) DESC LIMIT 1`,
    [phone, audience, String(CONVERSATION_IDLE_HOURS)],
  ).catch(() => null);
  return row?.id ?? null;
}

async function reply(to: string, body: string) {
  await sendTextMessage({ to, body });
}

/**
 * Messages to Khatario's own WhatsApp number. Never throws: a queue retry would answer twice.
 */
export async function processPlatformIncoming(job: PlatformIncomingQueueJob): Promise<void> {
  try {
    if (!(await isChannelEnabled('whatsapp'))) return;
    const phone = job.from.replace(/\D/g, '');
    const count = await messagesLastHour(phone);
    if (count > PLATFORM_MESSAGES_PER_HOUR) {
      if (count === PLATFORM_MESSAGES_PER_HOUR + 1) {
        await reply(phone, 'Thanks for all the questions! Please try again in a little while, or book a call: ' + absolute('/book-demo'));
      }
      return;
    }

    const user = await findUserByPhone(phone);
    if (user) {
      const command = matchCommand(job.text);
      if (command && !command.howTo) {
        await reply(phone, OWNER_ON_OWN_NUMBER);
        return;
      }
    }

    // No userId: business figures never go out from Khatario's number, only how-to help.
    const audience = user ? 'tenant_user' : 'prospect';
    let text = '';
    let error: string | null = null;
    let citations: Citation[] = [];
    const actions: AssistantAction[] = [];
    for await (const ev of answerTurn({
      message: job.text,
      conversationId: await recentConversationId(phone, audience),
      channel: 'whatsapp',
      audience,
      businessId: user?.business_id ?? null,
      userId: null,
      phone,
      textFormat: 'whatsapp',
    })) {
      if (ev.type === 'delta') text += ev.text;
      else if (ev.type === 'citations') citations = ev.citations;
      else if (ev.type === 'action') actions.push(ev.action);
      else if (ev.type === 'error') error = ev.message;
    }
    const body = platformReplyText({ text: text || error || 'Sorry, I could not answer that. Please try again.', citations, actions });
    await reply(phone, body);
  } catch (err) {
    console.error('[platform-incoming] failed:', err instanceof Error ? err.message : err);
  }
}
