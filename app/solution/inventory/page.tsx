import type { Metadata } from 'next';
import { MarketingSiteHeader } from '@/components/marketing/MarketingSiteHeader';
import { LandingFooter } from '@/components/marketing/landing/LandingFooter';
import {
  InventoryAudienceSection,
  InventoryFeaturesSection,
  InventoryProblemSection,
  InventorySolutionCta,
  InventorySolutionHero,
  InventoryWhatIsSection,
  InventoryWhyHardSection,
} from '@/components/marketing/solution/inventory';

const title = 'Inventory Management Software for Small Business | Khatario';

export const metadata: Metadata = {
  title,
  description:
    'Stock tracking app for Indian retail & wholesale: live stock with every sale and purchase, branches & warehouses, batch/expiry/serial, FIFO–LIFO–average costing, transfers & adjustments, reports (summary, valuation, movement, low stock, expired), barcodes. Start free.',
  keywords: [
    'inventory management software',
    'stock tracking app',
    'retail inventory system',
    'small business stock software',
    'multi branch inventory India',
  ],
  openGraph: {
    title,
    description:
      'Inventory that updates with every bill and purchase. Branches, warehouses, batches, costing, reports, and barcodes — built for busy shops.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title,
    description:
      'Real-time stock with sales and purchases. Branches, warehouses, batches, costing, reports. Start free.',
  },
  alternates: {
    canonical: '/solution/inventory',
  },
};

export default function InventorySolutionPage() {
  return (
    <div className="min-h-screen bg-white">
      <MarketingSiteHeader />
      <main>
        <InventorySolutionHero />
        <InventoryProblemSection />
        <InventoryWhatIsSection />
        <InventoryWhyHardSection />
        <InventoryFeaturesSection />
        <InventoryAudienceSection />
        <InventorySolutionCta />
      </main>
      <LandingFooter />
    </div>
  );
}
