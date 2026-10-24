import WaShopClient from '@/components/wa-shop/WaShopClient';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Shop on WhatsApp',
  robots: { index: false, follow: false },
};

/** Public cart page linked from a shop's WhatsApp chat; the token identifies the shop and chat. */
export default function WaShopPage({ params }: { params: { token: string } }) {
  return <WaShopClient token={params.token} />;
}
