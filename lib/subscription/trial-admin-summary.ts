/**
 * Admin-facing trial timeline derived from business_subscriptions + subscription_events.
 */

import { queryOne, queryRows } from '@/lib/db';
import { parseLocalDateOnly, startOfLocalToday } from '@/lib/subscription/date-only';
import { TRIAL_EXTENSION_DAYS } from '@/lib/subscription/trial-extension';
import { TRIAL_PLAN_ID } from '@/lib/subscription/trial-plan';

/** Must match {@link TRIAL_DAYS} in lifecycle.ts */
export const TRIAL_SIGNUP_DAYS = 30;

export interface SubscriptionEventRow {
  id: string;
  event_type: string;
  from_plan_id: string | null;
  to_plan_id: string | null;
  details: Record<string, unknown>;
  created_at: string;
}

export interface TrialAdminSummary {
  plan_id: string | null;
  status: string | null;
  start_date: string | null;
  current_trial_end_date: string | null;
  /** start_date + {@link TRIAL_SIGNUP_DAYS} (best estimate of first trial expiry). */
  estimated_original_trial_end_date: string | null;
  trial_extension_granted: boolean;
  trial_extension_declined_at: string | null;
  extension_days: number;
  extension_granted_at: string | null;
  extension_new_end_date: string | null;
  /** True when calendar trial end is before today. */
  is_trial_calendar_expired: boolean;
  /** Would the extend-or-free modal be offered on next login? */
  extension_offer_active: boolean;
  /** We do not log first modal display; this is inferred only. */
  extension_offer_note: string;
}

function addDaysToDateOnly(isoDate: string, days: number): string {
  const d = parseLocalDateOnly(isoDate);
  if (!d) return isoDate;
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseEventDetails(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return {};
}

export async function getTrialAdminSummary(businessId: string): Promise<TrialAdminSummary | null> {
  const sub = await queryOne<{
    plan_id: string | null;
    status: string | null;
    start_date: string | null;
    trial_end_date: string | null;
    trial_extension_granted: boolean;
    trial_extension_declined_at: string | null;
  }>(
    `SELECT plan_id, status, start_date::text, trial_end_date::text,
            trial_extension_granted, trial_extension_declined_at::text
     FROM business_subscriptions
     WHERE business_id = $1
     ORDER BY
       CASE WHEN status IN ('active', 'trial') THEN 0 ELSE 1 END,
       created_at DESC
     LIMIT 1`,
    [businessId],
  );

  if (!sub) return null;

  const events = await queryRows<{
    event_type: string;
    details: unknown;
    created_at: string;
  }>(
    `SELECT event_type, details, created_at::text
     FROM subscription_events
     WHERE business_id = $1
       AND event_type IN ('trial_extension_granted', 'trial_extension_declined')
     ORDER BY created_at ASC`,
    [businessId],
  );

  const extensionEvent = events.find((e) => e.event_type === 'trial_extension_granted');
  const extensionDetails = parseEventDetails(extensionEvent?.details);

  const startDate = sub.start_date;
  const estimatedOriginalEnd = startDate ? addDaysToDateOnly(startDate, TRIAL_SIGNUP_DAYS) : null;

  const trialEnd = parseLocalDateOnly(sub.trial_end_date);
  const isTrialCalendarExpired =
    sub.plan_id === TRIAL_PLAN_ID &&
    trialEnd != null &&
    trialEnd.getTime() < startOfLocalToday().getTime();

  const extensionOfferActive =
    sub.plan_id === TRIAL_PLAN_ID &&
    !sub.trial_extension_granted &&
    !sub.trial_extension_declined_at &&
    isTrialCalendarExpired;

  let extensionOfferNote =
    'Popup display time is not logged. After the original trial ends, the offer appears on login until the tenant extends or chooses Free.';
  if (sub.trial_extension_granted && extensionEvent) {
    extensionOfferNote = `Extension accepted on ${new Date(extensionEvent.created_at).toLocaleString('en-IN')}. Original trial likely ended on or before that date.`;
  } else if (sub.trial_extension_declined_at) {
    extensionOfferNote = `Tenant chose Free on ${new Date(sub.trial_extension_declined_at).toLocaleString('en-IN')}.`;
  } else if (!isTrialCalendarExpired && sub.plan_id === TRIAL_PLAN_ID) {
    extensionOfferNote = 'Trial is still active — extend popup will appear after the trial end date.';
  }

  return {
    plan_id: sub.plan_id,
    status: sub.status,
    start_date: startDate,
    current_trial_end_date: sub.trial_end_date,
    estimated_original_trial_end_date: estimatedOriginalEnd,
    trial_extension_granted: sub.trial_extension_granted,
    trial_extension_declined_at: sub.trial_extension_declined_at,
    extension_days: TRIAL_EXTENSION_DAYS,
    extension_granted_at: extensionEvent?.created_at ?? null,
    extension_new_end_date:
      typeof extensionDetails.trial_end_date === 'string'
        ? extensionDetails.trial_end_date
        : sub.trial_end_date,
    is_trial_calendar_expired: isTrialCalendarExpired,
    extension_offer_active: extensionOfferActive,
    extension_offer_note: extensionOfferNote,
  };
}

export async function getSubscriptionEventsForAdmin(
  businessId: string,
  limit = 50,
): Promise<SubscriptionEventRow[]> {
  const rows = await queryRows<{
    id: string;
    event_type: string;
    from_plan_id: string | null;
    to_plan_id: string | null;
    details: unknown;
    created_at: string;
  }>(
    `SELECT id, event_type, from_plan_id, to_plan_id, details, created_at::text
     FROM subscription_events
     WHERE business_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [businessId, limit],
  );

  return rows.map((row) => ({
    id: row.id,
    event_type: row.event_type,
    from_plan_id: row.from_plan_id,
    to_plan_id: row.to_plan_id,
    details: parseEventDetails(row.details),
    created_at: row.created_at,
  }));
}
