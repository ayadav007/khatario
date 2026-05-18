import type { Metadata } from 'next';
import { MarketingSiteHeader } from '@/components/marketing/MarketingSiteHeader';
import { LandingFooter } from '@/components/marketing/landing/LandingFooter';
import {
  AccountingAudienceSection,
  AccountingFeaturesSection,
  AccountingProblemSection,
  AccountingSolutionCta,
  AccountingSolutionHero,
  AccountingWhatIsSection,
  AccountingWhyHardSection,
} from '@/components/marketing/solution/accounting';

const title = 'Simple Accounting Software for Small Businesses | Khatario';

export const metadata: Metadata = {
  title,
  description:
    'Easy accounting app for Indian SMEs: automatic entries from invoices, purchases & expenses, GST (GSTR-1, GSTR-3B, GSTR-2B), credit tracking, bank reconciliation, P&L & balance sheet, WhatsApp reminders. Start free.',
  keywords: [
    'accounting software for small business',
    'GST accounting',
    'easy accounting app',
    'simple bookkeeping software',
    'small business accounting India',
  ],
  openGraph: {
    title,
    description:
      'Khatario turns invoices, purchases, and expenses into proper books — without accounting jargon. GST support, reports, bank match, WhatsApp reminders.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title,
    description:
      'Automatic accounting from everyday work. GST-ready, easy reports, WhatsApp reminders. Start free.',
  },
  alternates: {
    canonical: '/solution/accounting',
  },
};

export default function AccountingSolutionPage() {
  return (
    <div className="min-h-screen bg-white">
      <MarketingSiteHeader />
      <main>
        <AccountingSolutionHero />
        <AccountingProblemSection />
        <AccountingWhatIsSection />
        <AccountingWhyHardSection />
        <AccountingFeaturesSection />
        <AccountingAudienceSection />
        <AccountingSolutionCta />
      </main>
      <LandingFooter />
    </div>
  );
}
