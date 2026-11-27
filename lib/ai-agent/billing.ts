import { query, queryOne } from '@/lib/db';
import {
  dailyLimit,
  repliesThisMonth,
  repliesToday,
  releaseCustomerBotReply,
  reserveCustomerBotReply,
} from '@/lib/whatsapp/customer-bot';
import {
  KHATARIO_AI_MONTHLY_QUOTA,
  KHATARIO_AI_PRICE_MONTHLY,
  KHATARIO_AI_TRIAL_REPLIES,
} from './billing-constants';
import { getBusinessAssistantSettings, loadProviderRow } from './settings';
import { hasWhatsAppBotAddon, resolvePlanLimitValue } from '@/lib/subscription';
import {
  getEntitlementPlanIdForModuleSub,
  getEntitlementTermsIdForModuleSub,
  getModuleSubscription,
} from '@/lib/subscription/module-subscriptions';
import type { AgentUsage } from './types';

async function hasKhatarioAiTopUp(businessId: string): Promise<boolean> {
  const row = await queryOne<{ n: string }>(
    `SELECT COUNT(*) AS n FROM whatsapp_addons
      WHERE business_id = $1 AND addon_type = 'khatario_ai' AND status = 'active'
        AND (start_date IS NULL OR start_date <= CURRENT_DATE)
        AND (end_date IS NULL OR end_date >= CURRENT_DATE)`,
    [businessId],
  ).catch(() => null);
  return Number(row?.n ?? 0) > 0;
}

/**
 * Monthly replies on Khatario's key: the Connect plan's `max_ai_replies_per_month` (editable in
 * Admin → Plans) plus the AI top-up quota when that add-on is active. -1 = unlimited.
 */
export async function khatarioMonthlyQuota(businessId: string): Promise<number> {
  const [connect, topUp] = await Promise.all([
    hasWhatsAppBotAddon(businessId),
    hasKhatarioAiTopUp(businessId),
  ]);
  let quota = 0;
  if (connect) {
    const sub = await getModuleSubscription(businessId, 'connect');
    const planLimit = sub
      ? await resolvePlanLimitValue(
          getEntitlementPlanIdForModuleSub(sub),
          'max_ai_replies_per_month',
          undefined,
          getEntitlementTermsIdForModuleSub(sub),
        )
      : null;
    if (planLimit === -1) return -1;
    quota += planLimit ?? 0;
  }
  if (topUp) quota += KHATARIO_AI_MONTHLY_QUOTA;
  return quota;
}

/** Khatario AI is paid for: Connect includes replies, or the AI top-up is active. */
export async function hasKhatarioAiAddon(businessId: string): Promise<boolean> {
  return (await khatarioMonthlyQuota(businessId)) !== 0;
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
  const quota = await khatarioMonthlyQuota(businessId);
  if (quota !== 0) {
    if (quota === -1) return { ok: true, via: 'addon' };
    // Fails closed: if this month's replies cannot be counted, the reply is held (not "quota used up", so no false notice).
    let used: number;
    try {
      used = await repliesThisMonthStrict(businessId);
    } catch (err) {
      console.error('[ai-agent] could not count this month\'s replies, holding the reply:', err);
      return { ok: false, reason: 'not_configured' };
    }
    return used < quota ? { ok: true, via: 'addon' } : { ok: false, reason: 'quota_exhausted' };
  }
  if (context.live) return { ok: false, reason: 'live_needs_addon' };
  return (await trialRemaining(businessId)) > 0 ? { ok: true, via: 'trial' } : { ok: false, reason: 'trial_exhausted' };
}

async function repliesThisMonthStrict(businessId: string): Promise<number> {
  const row = await queryOne<{ n: string }>(
    `SELECT COUNT(*) AS n FROM whatsapp_inbound_events
      WHERE business_id = $1 AND direction = 'out' AND handled_as = 'customer_bot'
        AND created_at >= date_trunc('month', NOW() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata'`,
    [businessId],
  );
  return Number(row?.n ?? 0);
}

/**
 * Atomically take one trial reply (Test mode and the test chat): the counter only moves while it is below the
 * trial size, in one statement, so two replies at the last trial slot cannot both be taken.
 */
export async function reserveTrialReply(businessId: string): Promise<boolean> {
  try {
    const row = await queryOne<{ used: number }>(
      `INSERT INTO assistant_settings (scope, settings, updated_at)
       VALUES ($1, '{"khatarioAiTrialUsed": 1}'::jsonb, NOW())
       ON CONFLICT (scope) DO UPDATE SET
         settings = jsonb_set(
           assistant_settings.settings,
           '{khatarioAiTrialUsed}',
           to_jsonb(COALESCE((assistant_settings.settings->>'khatarioAiTrialUsed')::int, 0) + 1)
         ),
         updated_at = NOW()
       WHERE COALESCE((assistant_settings.settings->>'khatarioAiTrialUsed')::int, 0) < $2
       RETURNING (settings->>'khatarioAiTrialUsed')::int AS used`,
      [`business:${businessId}`, KHATARIO_AI_TRIAL_REPLIES],
    );
    return !!row;
  } catch (err) {
    console.error('[ai-agent] could not reserve a trial reply:', err instanceof Error ? err.message : err);
    return false;
  }
}

/** Gives a reserved trial reply back (no reply was produced). */
export async function releaseTrialReply(businessId: string): Promise<void> {
  await query(
    `UPDATE assistant_settings
        SET settings = jsonb_set(settings, '{khatarioAiTrialUsed}',
              to_jsonb(GREATEST(COALESCE((settings->>'khatarioAiTrialUsed')::int, 0) - 1, 0)))
      WHERE scope = $1`,
    [`business:${businessId}`],
  ).catch((err) => console.warn('[ai-agent] trial release failed:', err instanceof Error ? err.message : err));
}

export type KhatarioReservation =
  | { ok: true; via: 'addon' | 'trial'; release: () => Promise<void> }
  | { ok: false; reason: 'not_configured' | 'quota_exhausted' | 'trial_exhausted' | 'live_needs_addon' };

/**
 * Take one reply slot on Khatario's key, atomically (SUB-25), before generating the reply: an add-on reply takes
 * its place under the monthly quota and the daily cap (`reserveCustomerBotReply`, one lock per business); a trial
 * reply takes one trial slot (`reserveTrialReply`). Use it in place of `khatarioAccess` + the record call.
 * `release()` gives the slot back when no reply was produced.
 */
export async function reserveKhatarioReply(
  businessId: string,
  customerPhone: string,
  context: { live: boolean },
): Promise<KhatarioReservation> {
  const access = await khatarioAccess(businessId, context);
  if (!access.ok) return access;
  if (access.via === 'trial') {
    if (!(await reserveTrialReply(businessId))) return { ok: false, reason: 'trial_exhausted' };
    return { ok: true, via: 'trial', release: () => releaseTrialReply(businessId) };
  }
  const [quota, daily] = await Promise.all([khatarioMonthlyQuota(businessId), dailyLimit(businessId)]);
  const reserved = await reserveCustomerBotReply(businessId, customerPhone, { dailyLimit: daily, monthlyQuota: quota });
  if (!reserved.ok) return { ok: false, reason: reserved.reason === 'monthly_quota' ? 'quota_exhausted' : 'not_configured' };
  return { ok: true, via: 'addon', release: () => releaseCustomerBotReply(businessId, reserved.messageId) };
}

/** Configured for the editor's status: add-on active, or trial replies left. */
export async function khatarioAvailable(businessId: string): Promise<boolean> {
  if (!platformAiConfigured()) return false;
  if (await hasKhatarioAiAddon(businessId)) return true;
  return (await trialRemaining(businessId)) > 0;
}

export async function loadUsage(businessId: string): Promise<AgentUsage> {
  const [today, month, limit, row, quota, remaining] = await Promise.all([
    repliesToday(businessId),
    repliesThisMonth(businessId),
    dailyLimit(businessId),
    loadProviderRow(businessId),
    khatarioMonthlyQuota(businessId),
    trialRemaining(businessId),
  ]);
  return {
    repliesToday: today,
    dailyLimit: limit,
    repliesThisMonth: month,
    keySource: row?.key_source === 'khatario' ? 'khatario' : 'own',
    khatarioAi: {
      active: quota !== 0,
      monthlyQuota: quota,
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
      `Your AI agent has used all ${await khatarioMonthlyQuota(businessId)} Khatario AI replies this month. Customers now get your fallback message. Switch to your own API key in Settings → AI Agent, or wait for next month.`,
    ],
  ).catch((err) => console.error('[ai-agent] quota notification failed', err));
}
