import { SupplierOrderView } from './SupplierOrderView';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Order for you',
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
};

/** Public page for a supplier who got an order link from a Khatario business (no login). */
export default function SupplierOrderPage({ params }: { params: { token: string } }) {
  return <SupplierOrderView token={params.token} />;
}
