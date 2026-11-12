import type { Metadata } from 'next';
import { MarketingPageShell } from '@/components/marketing/MarketingPageShell';
import { LegalDocument } from '@/components/marketing/LegalDocument';
import { defaultLegalContext } from '@/lib/marketing/legal/types';
import { refundPolicy } from '@/lib/marketing/legal/refund';

const TITLE = 'Refund and Cancellation Policy | Khatario';
const DESCRIPTION =
  'Full refund within 7 days of your first payment on Khatario. How to cancel a plan, what is not refunded and how long a refund takes.';

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: '/refund-policy' },
  openGraph: { title: TITLE, description: DESCRIPTION, type: 'website', siteName: 'Khatario', images: ['/opengraph-image'] },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
};

export default function RefundPolicyPage() {
  return (
    <MarketingPageShell title="Refund and cancellation policy">
      <LegalDocument document={refundPolicy(defaultLegalContext())} />
    </MarketingPageShell>
  );
}
