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

/**
 * What an automatic sender needs from the plan.
 * - `connect`: the Connect plan grants the bot feature (`integration_whatsapp_bot`).
 * - `feature`: a plan feature id of the catalogue (`subscription_plan_features`), checked with `hasFeature`.
 * - With neither, the sender has no plan feature of its own and only needs a usable subscription.
 * - `cap`: count against the plan's daily WhatsApp cap (default true). Every message the business sends
 *   from its own WhatsApp counts, including messages to its own owner or staff: the catalogue describes
 *   the cap as "maximum WhatsApp messages that can be sent per day", not messages to customers.
 */
export type AutomationSpec = { connect?: boolean; feature?: string; cap?: boolean };

export const AUTOMATION = {
  /**
   * Replies to a customer's own message (bot rules, flows, AI and shop replies): the Connect plan, and no daily cap.
   * A reply to someone who just wrote does not count toward the cap and is not refused by it, otherwise a busy bot
   * would stop every invoice and reminder for the day.
   */
  bot_reply: { connect: true, cap: false },
  /** Proactive Connect sends (the WhatsApp copy of a todo reminder): the Connect plan and the daily cap. */
  connect_automation: { connect: true },
  /** Scheduled payment reminders (gate they always had). */
  auto_reminders: { feature: FeatureKeys.WHATSAPP_AUTO_REMINDERS },
  /** Credit alerts (gate they always had). */
  credit_alerts: { feature: FeatureKeys.WHATSAPP_CREDIT_ALERTS },
  /**
   * Senders that never had a plan feature (their own settings toggle is their gate): payment-received messages,
   * store buyer and merchant notices, abandoned-cart reminders, order updates, parcel and dispatch alerts, returns,
   * khata statements, owner updates and the evening summary. They get a usable subscription and the daily cap.
   */
  no_feature: {},
  /** The owner assistant's answer to the owner's own message: a reply, so a usable subscription and no cap. */
  owner_reply: { cap: false },
  /** Supplier Hub notices go from Khatario's own number: a usable subscription, no cap of the business's. */
  supplier_hub: { cap: false },
} as const satisfies Record<string, AutomationSpec>;

export type AutomationKind = keyof typeof AUTOMATION;

/** Tenant WhatsApp event key to the automation it belongs to: none of them had a plan feature before. */
export function automationForEvent(_eventKey: string): AutomationKind {
  return 'no_feature';
}

export type AutomationSkipReason =
  | 'plan_not_usable'
  | 'plan_does_not_include_feature'
  | 'daily_whatsapp_limit_reached'
  | 'plan_check_failed';

export type AutomationDecision =
  | { allowed: true }
  | { allowed: false; reason: AutomationSkipReason; message: string };

const MESSAGES: Record<AutomationSkipReason, string> = {
  plan_not_usable: 'The subscription is not usable right now (lapsed or suspended).',
  plan_does_not_include_feature: 'The current plan does not include this WhatsApp automation (or the plan has lapsed).',
  daily_whatsapp_limit_reached: 'The daily WhatsApp message limit of the plan has been reached.',
  plan_check_failed: 'The plan could not be checked, so the automatic message was not sent.',
};

function deny(reason: AutomationSkipReason): AutomationDecision {
  return { allowed: false, reason, message: MESSAGES[reason] };
}

export async function checkAutomationAllowed(
  businessId: string,
  kind: AutomationKind | AutomationSpec,
): Promise<AutomationDecision> {
  const spec: AutomationSpec = typeof kind === 'string' ? AUTOMATION[kind] : kind;
  try {
    if (spec.connect) {
      // skipCache: a lapse must stop automation now, not after the 5-minute entitlement cache.
      if (!(await hasWhatsAppBotAddon(businessId, true))) return deny('plan_does_not_include_feature');
    } else if (spec.feature) {
      if (!(await hasFeature(businessId, spec.feature))) return deny('plan_does_not_include_feature');
    } else {
      // No plan feature of its own: the subscription must still be usable (not lapsed past grace, not suspended).
      const { assertOperationalSubscription } = await import('@/lib/security/require-operational-subscription');
      if (!(await assertOperationalSubscription(businessId)).ok) return deny('plan_not_usable');
    }
    if (spec.cap !== false) {
      const cap = await checkLimit(businessId, 'whatsapp');
      if (!cap.allowed) return deny('daily_whatsapp_limit_reached');
    }
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
