import type { Metadata } from 'next';
import { MarketingPageShell } from '@/components/marketing/MarketingPageShell';
import { LegalDocument } from '@/components/marketing/LegalDocument';
import { defaultLegalContext } from '@/lib/marketing/legal/types';
import { privacyPolicy } from '@/lib/marketing/legal/privacy';

const TITLE = 'Privacy Policy | Khatario';
const DESCRIPTION =
  'What data Khatario collects from shops and their customers, why, who it is shared with and how to ask for it to be corrected or deleted.';

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: '/privacy' },
  openGraph: { title: TITLE, description: DESCRIPTION, type: 'website', siteName: 'Khatario', images: ['/opengraph-image'] },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
};

export default function PrivacyPage() {
  return (
    <MarketingPageShell title="Privacy policy">
      <LegalDocument document={privacyPolicy(defaultLegalContext())} />
    </MarketingPageShell>
  );
}
