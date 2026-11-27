/**
 * What the Plan & billing screen says when the customer comes back from the payment page.
 * Pure functions: the return URL only says that a customer came back and carries the payment id. Whether the
 * payment worked, and for which plan, comes from `GET /api/subscriptions/checkout/status`. Nothing here
 * says a plan is active unless the server said `completed`.
 */
import { formatPlanDate } from '@/lib/subscription/renewal-view';

/** Ask the server this often, for at most this long, then say the payment is still being confirmed. */
export const PAYMENT_POLL_INTERVAL_MS = 3000;
export const PAYMENT_POLL_MAX_MS = 120_000;

export type PaymentReturn = {
  kind: 'subscription' | 'addon';
  /** What the URL claims. Used only to choose the first words; never to say the plan is active. */
  hint: 'success' | 'pending' | 'cancelled';
  /** The payment id, or null when the URL has none (an old link). */
  tx: string | null;
};

type ParamReader = { get(name: string): string | null };

/** The return the URL describes, or null when the page was not opened from a payment page. */
export function parsePaymentReturn(params: ParamReader): PaymentReturn | null {
  const read = (name: 'payment' | 'addon'): PaymentReturn | null => {
    const raw = params.get(name);
    if (raw !== 'success' && raw !== 'pending' && raw !== 'cancelled') return null;
    const tx = (params.get('tx') ?? '').trim();
    return { kind: name === 'addon' ? 'addon' : 'subscription', hint: raw, tx: tx || null };
  };
  return read('payment') ?? read('addon');
}

/** The query parameters to remove from the address bar once the return has been read. */
export const PAYMENT_RETURN_PARAMS = ['payment', 'addon', 'tx', 'plan', 'type'] as const;

export type ServerCheckoutStatus = {
  status: 'pending' | 'completed' | 'failed' | 'expired' | 'refunded';
  kind: 'subscription' | 'addon';
  plan_name: string | null;
  addon_label: string | null;
  shortened_days: number | null;
  period_end: string | null;
};

export type PaymentScreen = {
  /** `checking` shows a spinner; the others are final. */
  phase: 'checking' | 'done' | 'failed' | 'waiting';
  tone: 'neutral' | 'success' | 'warning' | 'danger';
  title: string;
  body: string;
};

/** Whether to ask again. `result` is the latest server answer, null when the call itself failed. */
export function nextPollStep(elapsedMs: number, result: ServerCheckoutStatus | null): 'stop' | 'timeout' | 'again' {
  if (result && result.status !== 'pending') return 'stop';
  return elapsedMs >= PAYMENT_POLL_MAX_MS ? 'timeout' : 'again';
}

const NOT_THROUGH =
  'This payment did not go through and your plan was not changed. If money left your account, your bank normally returns it within a few working days; write to support if it does not.';

/** The words for the current state. `status` is the latest server answer; `timedOut` is set after two minutes. */
export function paymentScreen(
  ret: Pick<PaymentReturn, 'kind' | 'hint' | 'tx'>,
  status: ServerCheckoutStatus | null,
  timedOut: boolean,
  /** The server did not know this payment id (it answered 404). */
  missing = false,
): PaymentScreen {
  const addon = ret.kind === 'addon';
  const what = addon ? 'add-on' : 'plan';

  // The customer pressed cancel (or the gateway reported a failure): nothing to wait for.
  if (ret.hint === 'cancelled' && (!status || status.status === 'pending' || status.status === 'failed' || status.status === 'expired')) {
    return {
      phase: 'failed',
      tone: 'warning',
      title: 'Payment was not completed',
      body: NOT_THROUGH,
    };
  }

  switch (status?.status) {
    case 'completed': {
      const name = addon ? status.addon_label : status.plan_name;
      const title = addon
        ? `${name ?? 'Your add-on'} is active`
        : name
          ? `${name} is active`
          : 'Your plan is active';
      const parts: string[] = [];
      if (!addon && status.period_end) parts.push(`Your plan runs until ${formatPlanDate(status.period_end)}.`);
      if (!addon && status.shortened_days) {
        parts.push(
          `The credit for your old plan was no longer available, so this payment bought ${status.shortened_days} day${
            status.shortened_days === 1 ? '' : 's'
          }.`,
        );
      }
      return {
        phase: 'done',
        tone: 'success',
        title,
        body: parts.length ? parts.join(' ') : 'Thank you. Your payment has been received.',
      };
    }
    case 'failed':
      return {
        phase: 'failed',
        tone: 'danger',
        title: 'Payment did not go through',
        body: NOT_THROUGH,
      };
    case 'expired':
      return {
        phase: 'failed',
        tone: 'warning',
        title: 'The payment link expired',
        body: NOT_THROUGH,
      };
    case 'refunded':
      return {
        phase: 'failed',
        tone: 'warning',
        title: 'This payment was refunded',
        body: `The money goes back to the account you paid from. ${addon ? 'The add-on' : 'Your plan'} follows what Plan & billing shows now.`,
      };
    default:
      break;
  }

  if (missing) {
    return {
      phase: 'waiting',
      tone: 'warning',
      title: 'We could not find this payment',
      body: `Check Billing History on this page. If you paid, your ${what} will switch on by itself and you do not need to pay again.`,
    };
  }

  if (timedOut || !ret.tx) {
    return {
      phase: 'waiting',
      tone: 'warning',
      title: 'Your payment is still being confirmed',
      body: `Your ${what} will switch on by itself as soon as the bank confirms. You do not need to pay again. You can leave this page.`,
    };
  }
  return {
    phase: 'checking',
    tone: 'neutral',
    title: 'Checking your payment',
    body: 'This takes a few seconds. Please keep this page open.',
  };
}
