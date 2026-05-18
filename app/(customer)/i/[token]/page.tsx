import { PublicBillView } from '@/components/customer-surface/PublicBillView';

export const metadata = {
  title: 'View bill',
  robots: { index: false, follow: false },
};

export default function PublicInvoicePage({
  params,
  searchParams,
}: {
  params: { token: string };
  searchParams: { from?: string };
}) {
  const viewSource = searchParams.from === 'portal' ? 'portal' : 'public_link';
  return <PublicBillView token={params.token} viewSource={viewSource} />;
}
