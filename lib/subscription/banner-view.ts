/**
 * The words of the subscription banner. Pure. In the grace days the banner says the plan ended (never
 * "Trial ends"); dates and day counts come from the server's current-subscription answer.
 */
import { formatPlanDate } from '@/lib/subscription/renewal-view';

export type BannerKind = 'trial_ending' | 'trial_expired' | 'grace_expiring' | 'grace_expired' | 'cancelled';

export type BannerInput = {
  kind: BannerKind;
  /** Trial days left, or grace days left. */
  daysRemaining: number;
  /** The paid plan's last day (server `ends_on`) and the last day of the grace days (`grace_ends_on`). */
  endsOn?: string | null;
  graceEndsOn?: string | null;
  /** Already formatted, for a cancelled plan. */
  cancelDate?: string;
};

const days = (n: number) => `${n} day${n === 1 ? '' : 's'}`;

/** The one-line text of the full banner. */
export function bannerMessage(input: BannerInput): string {
  const { kind, daysRemaining } = input;
  switch (kind) {
    case 'trial_ending':
      return daysRemaining === 0
        ? 'Today is the last day of your trial. Upgrade to keep full access.'
        : `Your trial ends in ${days(daysRemaining)}. Upgrade to keep full access.`;
    case 'trial_expired':
      return 'Your trial has expired. You are on the Free plan — upgrade anytime to restore full access.';
    case 'grace_expiring': {
      const ended = input.endsOn ? `Your plan ended on ${formatPlanDate(input.endsOn)}.` : 'Your plan has ended.';
      const until = input.graceEndsOn
        ? ` You can keep using it until ${formatPlanDate(input.graceEndsOn)}.`
        : daysRemaining > 0
          ? ` You can keep using it for ${days(daysRemaining)} more.`
          : '';
      return `${ended}${until} Renew to continue; after that your account moves to the Free plan.`;
    }
    case 'grace_expired':
      return 'Your account has been restricted to the free plan. Upgrade to restore full access.';
    case 'cancelled':
      return `Your subscription will end on ${input.cancelDate ?? 'the end of this period'}. You have full access until then.`;
  }
}

/** The short text of the compact banner (shown on pages other than the dashboard). */
export function bannerCompactMessage(input: Pick<BannerInput, 'kind' | 'daysRemaining'>): string {
  switch (input.kind) {
    case 'grace_expiring':
      return input.daysRemaining > 0
        ? `Plan ended — renew within ${input.daysRemaining}d to keep access`
        : 'Plan ended — renew to keep access';
    case 'trial_expired':
      return 'Trial ended — you are on the Free plan';
    case 'grace_expired':
      return 'Plan ended — you are on the Free plan';
    case 'cancelled':
      return 'Plan cancelled — access ends soon';
    case 'trial_ending':
      return `Trial ends in ${input.daysRemaining}d — upgrade to keep access`;
  }
}

/** The button text. Grace is about renewing the plan, not choosing a new one. */
export function bannerCta(kind: BannerKind): string {
  switch (kind) {
    case 'trial_ending':
    case 'trial_expired':
      return 'Choose a plan';
    case 'grace_expiring':
      return 'Renew now';
    case 'grace_expired':
      return 'Upgrade';
    case 'cancelled':
      return 'Reactivate';
  }
}
