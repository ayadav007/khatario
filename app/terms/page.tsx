import type { Metadata } from 'next';
import { MarketingPageShell } from '@/components/marketing/MarketingPageShell';
import { LegalDocument } from '@/components/marketing/LegalDocument';
import { defaultLegalContext } from '@/lib/marketing/legal/types';
import { termsOfService } from '@/lib/marketing/legal/terms';

const TITLE = 'Terms of Service | Khatario';
const DESCRIPTION =
  'The terms for using Khatario: your account, plans and payments, acceptable use, your data and our responsibilities.';

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: '/terms' },
  openGraph: { title: TITLE, description: DESCRIPTION, type: 'website', siteName: 'Khatario', images: ['/opengraph-image'] },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
};

export default function TermsPage() {
  return (
    <MarketingPageShell title="Terms of service">
      <LegalDocument document={termsOfService(defaultLegalContext())} />
    </MarketingPageShell>
  );
}
