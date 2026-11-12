import type { Metadata } from 'next';
import { LandingPage } from '@/components/marketing/landing/LandingPage';
import { getPublishedMarketingDocument } from '@/lib/marketing-builder/pages-repo';
import { marketingRobots, resolveCanonical } from '@/lib/marketing-builder/seo';
import { isSafeImageSrc } from '@/lib/marketing-builder/safe-url';
import { publicSiteUrl } from '@/lib/blog/site';
import { loadPricingCatalog } from '@/lib/subscription/pricing-catalog';
import { khatarioOrganizationJsonLd } from '@/lib/marketing/brand-structured-data';

export const revalidate = 300;

const TITLE = 'Khatario Billing App: GST Bills, Stock & WhatsApp Invoices for Shops';
const DESCRIPTION =
  'Make GST-ready bills in under a minute, share them on WhatsApp, track who owes you, manage stock and file GSTR reports. Free to start, works on phone and computer.';

function rootText(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

export async function generateMetadata(): Promise<Metadata> {
  const doc = await getPublishedMarketingDocument('home');
  const props = (doc?.root?.props ?? {}) as Record<string, unknown>;
  const title = rootText(props.title, TITLE);
  const description = rootText(props.description, DESCRIPTION);
  const ogTitle = rootText(props.ogTitle, title);
  const ogDescription = rootText(props.ogDescription, description);
  const ogImage = typeof props.ogImage === 'string' && isSafeImageSrc(props.ogImage) ? props.ogImage : null;
  const images = ogImage ? [{ url: ogImage }] : undefined;
  const canonical = resolveCanonical(props.canonical);
  const hidden = marketingRobots(props.robots) === 'noindex';

  return {
    title: { absolute: title },
    description,
    alternates: { canonical: canonical ?? '/' },
    ...(hidden ? { robots: { index: false, follow: false } } : {}),
    openGraph: { title: ogTitle, description: ogDescription, type: 'website', siteName: 'Khatario', ...(images ? { images } : {}) },
    twitter: { card: 'summary_large_image', title: ogTitle, description: ogDescription, ...(images ? { images: images.map((i) => i.url) } : {}) },
  };
}

export default async function Page() {
  const [document, pricingCatalog] = await Promise.all([
    getPublishedMarketingDocument('home'),
    loadPricingCatalog().catch((error) => {
      console.error('Home page pricing failed to load:', error);
      return null;
    }),
  ]);
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(homeStructuredData()) }} />
      <LandingPage document={document} pricingCatalog={pricingCatalog} />
    </>
  );
}

/**
 * Organization, WebSite and SoftwareApplication so search engines can show the brand and app details.
 * `alternateName` tells Google that "Khatario" is a brand (it was auto-correcting the name to "khataro").
 */
function homeStructuredData() {
  const site = publicSiteUrl();
  return {
    '@context': 'https://schema.org',
    '@graph': [
      khatarioOrganizationJsonLd(site),
      {
        '@type': 'WebSite',
        '@id': `${site}/#website`,
        name: 'Khatario',
        alternateName: ['Khatario Billing App', 'khatario.com'],
        url: site,
        publisher: { '@id': `${site}/#organization` },
        inLanguage: 'en-IN',
      },
      {
        '@type': 'SoftwareApplication',
        name: 'Khatario',
        alternateName: 'Khatario Billing App',
        url: site,
        applicationCategory: 'BusinessApplication',
        operatingSystem: 'Web, Android',
        description: DESCRIPTION,
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'INR' },
        publisher: { '@id': `${site}/#organization` },
      },
    ],
  };
}
