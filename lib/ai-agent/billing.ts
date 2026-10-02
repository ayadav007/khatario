import { query, queryOne } from '@/lib/db';
import { dailyLimit, repliesThisMonth, repliesToday } from '@/lib/whatsapp/customer-bot';
import {
  KHATARIO_AI_MONTHLY_QUOTA,
  KHATARIO_AI_PRICE_MONTHLY,
  KHATARIO_AI_TRIAL_REPLIES,
} from './billing-constants';
import { getBusinessAssistantSettings, loadProviderRow } from './settings';
import type { AgentUsage } from './types';

export async function hasKhatarioAiAddon(businessId: string): Promise<boolean> {
  const row = await queryOne<{ n: string }>(
    `SELECT COUNT(*) AS n FROM whatsapp_addons
      WHERE business_id = $1 AND addon_type = 'khatario_ai' AND status = 'active'
        AND (start_date IS NULL OR start_date <= CURRENT_DATE)
        AND (end_date IS NULL OR end_date >= CURRENT_DATE)`,
    [businessId],
  ).catch(() => null);
  return Number(row?.n ?? 0) > 0;
}

export function platformAiConfigured(): boolean {
  return !!(process.env.GROQ_API_KEY?.trim() || process.env.GEMINI_API_KEY?.trim());
}

export async function trialRepliesUsed(businessId: string): Promise<number> {
  const s = await getBusinessAssistantSettings(businessId);
  const n = Number(s.khatarioAiTrialUsed);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export async function trialRemaining(businessId: string): Promise<number> {
  return Math.max(0, KHATARIO_AI_TRIAL_REPLIES - (await trialRepliesUsed(businessId)));
}

/** Atomically count one trial reply on Khatario's key. */
export async function recordTrialReply(businessId: string): Promise<void> {
  await query(
    `INSERT INTO assistant_settings (scope, settings, updated_at)
     VALUES ($1, '{"khatarioAiTrialUsed": 1}'::jsonb, NOW())
     ON CONFLICT (scope) DO UPDATE SET
       settings = jsonb_set(
         assistant_settings.settings,
         '{khatarioAiTrialUsed}',
         to_jsonb(COALESCE((assistant_settings.settings->>'khatarioAiTrialUsed')::int, 0) + 1)
       ),
       updated_at = NOW()`,
    [`business:${businessId}`],
  ).catch((err) => console.warn('[ai-agent] trial counter failed:', err instanceof Error ? err.message : err));
}

export type KhatarioAccess =
  | { ok: true; via: 'addon' | 'trial' }
  | { ok: false; reason: 'not_configured' | 'quota_exhausted' | 'trial_exhausted' | 'live_needs_addon' };

/**
 * Whether this reply may run on Khatario's key. The trial covers Test mode and the test chat
 * only; Live mode needs the add-on, which has a monthly reply quota.
 */
export async function khatarioAccess(
  businessId: string,
  context: { live: boolean },
): Promise<KhatarioAccess> {
  if (!platformAiConfigured()) return { ok: false, reason: 'not_configured' };
  if (await hasKhatarioAiAddon(businessId)) {
    const used = await repliesThisMonth(businessId);
    return used < KHATARIO_AI_MONTHLY_QUOTA ? { ok: true, via: 'addon' } : { ok: false, reason: 'quota_exhausted' };
  }
  if (context.live) return { ok: false, reason: 'live_needs_addon' };
  return (await trialRemaining(businessId)) > 0 ? { ok: true, via: 'trial' } : { ok: false, reason: 'trial_exhausted' };
}

/** Configured for the editor's status: add-on active, or trial replies left. */
export async function khatarioAvailable(businessId: string): Promise<boolean> {
  if (!platformAiConfigured()) return false;
  if (await hasKhatarioAiAddon(businessId)) return true;
  return (await trialRemaining(businessId)) > 0;
}

export async function loadUsage(businessId: string): Promise<AgentUsage> {
  const [today, month, limit, row, active, remaining] = await Promise.all([
    repliesToday(businessId),
    repliesThisMonth(businessId),
    dailyLimit(businessId),
    loadProviderRow(businessId),
    hasKhatarioAiAddon(businessId),
    trialRemaining(businessId),
  ]);
  return {
    repliesToday: today,
    dailyLimit: limit,
    repliesThisMonth: month,
    keySource: row?.key_source === 'khatario' ? 'khatario' : 'own',
    khatarioAi: {
      active,
      monthlyQuota: KHATARIO_AI_MONTHLY_QUOTA,
      trialRemaining: remaining,
      trialTotal: KHATARIO_AI_TRIAL_REPLIES,
      price: KHATARIO_AI_PRICE_MONTHLY,
    },
  };
}

/** Tell the owner once per month that Khatario AI replies ran out. */
export async function notifyQuotaExhaustedOnce(businessId: string): Promise<void> {
  const month = new Date().toISOString().slice(0, 7);
  const s = await getBusinessAssistantSettings(businessId);
  if (s.khatarioAiQuotaNotified === month) return;
  await query(
    `INSERT INTO assistant_settings (scope, settings, updated_at)
     VALUES ($1, jsonb_build_object('khatarioAiQuotaNotified', $2::text), NOW())
     ON CONFLICT (scope) DO UPDATE SET
       settings = assistant_settings.settings || jsonb_build_object('khatarioAiQuotaNotified', $2::text),
       updated_at = NOW()`,
    [`business:${businessId}`, month],
  ).catch(() => undefined);
  await query(
    `INSERT INTO notifications (business_id, type, title, message, reference_type, created_at)
     VALUES ($1, 'general', $2, $3, 'ai_agent', CURRENT_TIMESTAMP)`,
    [
      businessId,
      'Khatario AI replies used up',
      `Your AI agent has used all ${KHATARIO_AI_MONTHLY_QUOTA} Khatario AI replies this month. Customers now get your fallback message. Switch to your own API key in Settings → AI Agent, or wait for next month.`,
    ],
  ).catch((err) => console.error('[ai-agent] quota notification failed', err));
}
