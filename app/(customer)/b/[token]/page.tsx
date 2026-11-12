import { PublicBillsView } from '@/components/customer-surface/PublicBillsView';

export const metadata = {
  title: 'Your bills',
  robots: { index: false, follow: false },
};

export default function PublicBillsPage({ params }: { params: { token: string } }) {
  return <PublicBillsView token={params.token} />;
}
