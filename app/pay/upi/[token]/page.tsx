import { loadUpiPayment, upiAppLinks } from '@/lib/payments/upi-pay-link';
import UpiPayActions from './UpiPayActions';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Pay by UPI',
  robots: { index: false, follow: false },
};

const inr = (n: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(n);

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center px-4 py-10 bg-gray-50">
      <div className="max-w-sm w-full rounded-2xl border border-gray-200 bg-white p-6 shadow-sm text-center">{children}</div>
    </div>
  );
}

/** Public page linked from WhatsApp: opens the customer's UPI app to pay the shop's own UPI ID. */
export default async function UpiPayPage({ params }: { params: { token: string } }) {
  const payment = await loadUpiPayment(params.token).catch(() => null);

  if (!payment) {
    return (
      <Shell>
        <h1 className="text-lg font-semibold text-gray-900 mb-2">Link not valid</h1>
        <p className="text-sm text-gray-600">This payment link is invalid or the order was cancelled. Please ask the shop for a new link on WhatsApp.</p>
      </Shell>
    );
  }

  if (payment.paid) {
    return (
      <Shell>
        <h1 className="text-lg font-semibold text-gray-900 mb-2">Already paid</h1>
        <p className="text-sm text-gray-600">
          Order {payment.orderNumber} with {payment.shopName} is fully paid. You can return to WhatsApp.
        </p>
      </Shell>
    );
  }

  if (!payment.upi) {
    return (
      <Shell>
        <h1 className="text-lg font-semibold text-gray-900 mb-2">UPI not available</h1>
        <p className="text-sm text-gray-600">{payment.shopName} has not set up a UPI ID. Please ask the shop how to pay on WhatsApp.</p>
      </Shell>
    );
  }

  return (
    <Shell>
      <p className="text-xs uppercase tracking-wide text-gray-500">Paying</p>
      <h1 className="text-lg font-semibold text-gray-900">{payment.shopName}</h1>
      <p className="mt-3 text-3xl font-bold text-gray-900">{inr(payment.amount)}</p>
      <p className="mt-1 text-xs text-gray-500">Order {payment.orderNumber}</p>
      <UpiPayActions links={upiAppLinks(payment.upi)} vpa={payment.upi.vpa} />
      <p className="mt-6 text-xs text-gray-500">
        After paying, send the payment screenshot to {payment.shopName} on WhatsApp so they can confirm your order.
      </p>
    </Shell>
  );
}
