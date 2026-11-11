import type { Metadata } from 'next';
import { MagloMarketingPreview } from '@/components/marketing/preview/MagloMarketingPreview';

export const metadata: Metadata = {
  title: { absolute: 'Khatario — Maglo-style marketing preview' },
  description: 'Internal design preview. Not indexed.',
  robots: { index: false, follow: false },
};

export default function MagloMarketingPreviewPage() {
  return <MagloMarketingPreview />;
}
