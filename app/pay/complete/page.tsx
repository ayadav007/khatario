import Link from 'next/link';

export const metadata = {
  title: 'Payment complete',
  robots: { index: false, follow: false },
};

/**
 * Razorpay Payment Link `callback_url` target. Customers land here without a Khatario session.
 */
export default function PayCompletePage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const statusRaw = searchParams.razorpay_payment_link_status;
  const status = Array.isArray(statusRaw) ? statusRaw[0] : statusRaw;
  const paid =
    status === 'paid' ||
    status === 'partially_paid' ||
    searchParams.razorpay_payment_id != null;

  return (
    <div className="min-h-[70vh] flex flex-col items-center justify-center px-4 py-12 bg-gray-50">
      <div className="max-w-md w-full rounded-xl border border-gray-200 bg-white p-8 shadow-sm text-center">
        <h1 className="text-xl font-semibold text-gray-900 mb-2">
          {paid ? 'Payment received' : 'Thanks — you can close this page'}
        </h1>
        <p className="text-sm text-gray-600 mb-6">
          {paid
            ? 'Your payment was submitted successfully. You can return to WhatsApp — the business will confirm your order shortly.'
            : 'If you completed a payment, your bank or UPI app may still be processing it. You can return to WhatsApp and wait for confirmation.'}
        </p>
        <p className="text-xs text-gray-500 mb-6">
          Having trouble? Contact the business you were paying — they can check payment status on their side.
        </p>
        <Link
          href="/"
          className="text-sm font-medium text-primary-600 hover:text-primary-700 underline-offset-2 hover:underline"
        >
          Go to Khatario home
        </Link>
      </div>
    </div>
  );
}
