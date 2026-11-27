/**
 * One check before any automatic WhatsApp message (bot rules, flows, AI and shop replies, scheduled
 * reminders): the business must be on a usable plan that includes that kind of automation, and the
 * plan's daily WhatsApp cap must not be used up. Campaigns use the same two calls
 * (lib/campaign-processor.ts). A person typing in the inbox is not automation and does not come here.
 *
 * Nothing is deleted when a send is skipped: the caller leaves its queue, schedule or conversation as
 * it is, so the automation resumes by itself when the plan allows.
 */
import { checkLimit, hasFeature, hasWhatsAppBotAddon } from '@/lib/subscription';
import { FeatureKeys } from '@/lib/featureKeys';

export type AutomationKind =
  /** Bot rules, flows, AI and shop replies, owner-facing WhatsApp reminders: the Connect plan. */
  | 'connect_automation'
  /** Scheduled payment reminders: the `whatsapp_auto_reminders` plan feature. */
  | 'auto_reminders';

export type AutomationSkipReason = 'plan_does_not_include_feature' | 'daily_whatsapp_limit_reached' | 'plan_check_failed';

export type AutomationDecision =
  | { allowed: true }
  | { allowed: false; reason: AutomationSkipReason; message: string };

const MESSAGES: Record<AutomationSkipReason, string> = {
  plan_does_not_include_feature: 'The current plan does not include this WhatsApp automation (or the plan has lapsed).',
  daily_whatsapp_limit_reached: 'The daily WhatsApp message limit of the plan has been reached.',
  plan_check_failed: 'The plan could not be checked, so the automatic message was not sent.',
};

function deny(reason: AutomationSkipReason): AutomationDecision {
  return { allowed: false, reason, message: MESSAGES[reason] };
}

export async function checkAutomationAllowed(businessId: string, kind: AutomationKind): Promise<AutomationDecision> {
  try {
    // skipCache: a lapse must stop automation now, not after the 5-minute entitlement cache.
    const featureOk =
      kind === 'connect_automation'
        ? await hasWhatsAppBotAddon(businessId, true)
        : await hasFeature(businessId, FeatureKeys.WHATSAPP_AUTO_REMINDERS);
    if (!featureOk) return deny('plan_does_not_include_feature');
    const cap = await checkLimit(businessId, 'whatsapp');
    if (!cap.allowed) return deny('daily_whatsapp_limit_reached');
    return { allowed: true };
  } catch (err) {
    console.error('[automation-guard] plan check failed:', err instanceof Error ? err.message : err);
    // Fail closed: an automatic message that cannot be shown to be allowed is not sent.
    return deny('plan_check_failed');
  }
}

/**
 * Notes on the conversation's routing log (the status record the inbound pipeline already keeps) that an
 * automatic reply was skipped and why. Never throws.
 */
export async function recordSkippedAutomation(input: {
  businessId: string;
  conversationId?: string | null;
  messageId?: string | null;
  reason: AutomationSkipReason;
}): Promise<void> {
  const { logRouting } = await import('@/lib/whatsapp/flows/log');
  await logRouting({
    businessId: input.businessId,
    conversationId: input.conversationId ?? null,
    messageId: input.messageId ?? null,
    handler: 'fallback',
    reason: `automation_skipped:${input.reason}`,
  });
}
