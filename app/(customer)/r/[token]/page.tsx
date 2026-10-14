import type { Metadata } from 'next';
import { RiderDropView } from './RiderDropView';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Delivery',
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
};

export default function RiderPage({ params }: { params: { token: string } }) {
  return <RiderDropView token={params.token} />;
}
