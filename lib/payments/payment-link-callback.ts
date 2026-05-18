/**
 * Hosted checkout (e.g. Razorpay Payment Links) redirect after payment.
 * Razorpay requires a reachable HTTPS URL; whitelist the domain in Razorpay Dashboard.
 */

export function getPaymentLinkCallbackUrl(): string | undefined {
  const base =
    process.env.PUBLIC_PAYMENT_CALLBACK_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    '';
  if (!base) return undefined;

  const root = base.replace(/\/$/, '');

  if (
    /^https?:\/\/(localhost|127\.0\.0\.1)(\b|\/|:)/i.test(root) ||
    /^https?:\/\/\[::1\](\b|\/|:)/i.test(root)
  ) {
    return undefined;
  }

  return `${root}/pay/complete`;
}
