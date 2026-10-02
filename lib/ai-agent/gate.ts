import { query, queryOne } from '@/lib/db';
import type { WhatsAppBotUIConfig } from '@/types/whatsapp-bot-config';
import { performHandoff } from './conversation';
import {
  DEFAULT_AFTER_HOURS_MESSAGE,
  DEFAULT_HANDOFF_MESSAGE,
  type AgentSettings,
} from './types';

export type GateResult =
  | { action: 'continue'; greeting?: string }
  | { action: 'stop'; reason: 'paused' }
  | { action: 'reply'; response: string; reason: 'handoff' | 'after_hours' };

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}

export function matchesTriggerPhrase(message: string, phrases: string[]): boolean {
  const text = ` ${normalize(message)} `;
  return phrases.some((p) => {
    const n = normalize(p);
    return n.length > 0 && text.includes(` ${n} `);
  });
}

function partsInZone(now: Date, timeZone: string): { day: string; minutes: number; date: string } {
  let tz = timeZone || 'Asia/Kolkata';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
  } catch {
    tz = 'Asia/Kolkata';
  }
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const map: Record<string, string> = {};
  for (const p of fmt.formatToParts(now)) map[p.type] = p.value;
  return {
    day: (map.weekday || '').toLowerCase(),
    minutes: Number(map.hour) * 60 + Number(map.minute),
    date: `${map.year}-${map.month}-${map.day}`,
  };
}

function toMinutes(hhmm?: string): number | null {
  if (!hhmm) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** True when business hours are configured and `now` falls outside them. */
export function isOutsideBusinessHours(hours: WhatsAppBotUIConfig['businessHours'], now = new Date()): boolean {
  if (!hours?.schedule?.length) return false;
  const { day, minutes } = partsInZone(now, hours.timezone);
  const today = hours.schedule.find((d) => d.day === day);
  if (!today || !today.isOpen) return true;
  const open = toMinutes(today.openTime);
  const close = toMinutes(today.closeTime);
  if (open == null || close == null) return false;
  if (close <= open) return !(minutes >= open || minutes < close);
  return minutes < open || minutes >= close;
}

export function localDate(timeZone: string | undefined, now = new Date()): string {
  return partsInZone(now, timeZone || 'Asia/Kolkata').date;
}

interface GateInput {
  businessId: string;
  conversationId: string;
  message: string;
  settings: AgentSettings;
  customerLabel?: string;
  now?: Date;
}

/**
 * Decide what the shop's AI agent does with an incoming customer message before the model
 * runs: stay quiet (paused), hand off to a person, send the after-hours notice, or continue
 * (optionally opening with the greeting on a brand-new conversation).
 */
export async function runAgentGate(input: GateInput): Promise<GateResult> {
  const { businessId, conversationId, message, settings } = input;
  const now = input.now ?? new Date();

  const conv = await queryOne<{
    paused: boolean;
    after_hours_notified_on: string | Date | null;
    incoming: string;
    outgoing: string;
  }>(
    `SELECT (c.bot_paused_until IS NOT NULL AND c.bot_paused_until > NOW()) AS paused,
            c.after_hours_notified_on,
            (SELECT COUNT(*) FROM whatsapp_conversation_messages m
              WHERE m.conversation_id = c.id AND m.direction = 'incoming') AS incoming,
            (SELECT COUNT(*) FROM whatsapp_conversation_messages m
              WHERE m.conversation_id = c.id AND m.direction = 'outgoing') AS outgoing
       FROM whatsapp_conversations c
      WHERE c.id = $1 AND c.business_id = $2`,
    [conversationId, businessId],
  ).catch(() => null);

  if (conv?.paused) return { action: 'stop', reason: 'paused' };

  if (settings.handoff.enabled && matchesTriggerPhrase(message, settings.handoff.triggerPhrases)) {
    await performHandoff(businessId, conversationId, settings, { customerLabel: input.customerLabel });
    return {
      action: 'reply',
      response: settings.handoff.message.trim() || DEFAULT_HANDOFF_MESSAGE,
      reason: 'handoff',
    };
  }

  const hours = settings.behavior.businessHours;
  if (hours && isOutsideBusinessHours(hours, now)) {
    const today = localDate(hours.timezone, now);
    const notified = conv?.after_hours_notified_on
      ? (conv.after_hours_notified_on instanceof Date
          ? conv.after_hours_notified_on.toISOString().slice(0, 10)
          : String(conv.after_hours_notified_on).slice(0, 10))
      : null;
    if (notified !== today) {
      await query(
        `UPDATE whatsapp_conversations SET after_hours_notified_on = $3::date WHERE id = $1 AND business_id = $2`,
        [conversationId, businessId, today],
      ).catch(() => undefined);
      return {
        action: 'reply',
        response: settings.afterHoursMessage.trim() || hours.afterHoursMessage?.trim() || DEFAULT_AFTER_HOURS_MESSAGE,
        reason: 'after_hours',
      };
    }
  }

  const isNew = conv ? Number(conv.incoming) <= 1 && Number(conv.outgoing) === 0 : false;
  const greeting = settings.greetingMessage.trim();
  return isNew && greeting ? { action: 'continue', greeting } : { action: 'continue' };
}