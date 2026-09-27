import type { Metadata } from 'next';
import { LandingPage } from '@/components/marketing/landing/LandingPage';
import { getPublishedMarketingDocument } from '@/lib/marketing-builder/pages-repo';
import { isSafeImageSrc } from '@/lib/marketing-builder/safe-url';

export const revalidate = 300;

const TITLE = 'Khatario — GST Billing, Stock & WhatsApp Invoices for Indian Shops';
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
  const ogImage = typeof props.ogImage === 'string' && isSafeImageSrc(props.ogImage) ? props.ogImage : null;
  const images = ogImage ? [{ url: ogImage }] : undefined;

  return {
    title: { absolute: title },
    description,
    openGraph: { title, description, type: 'website', siteName: 'Khatario', ...(images ? { images } : {}) },
    twitter: { card: 'summary_large_image', title, description, ...(images ? { images: images.map((i) => i.url) } : {}) },
  };
}

export default async function Page() {
  const document = await getPublishedMarketingDocument('home');
  return <LandingPage document={document} />;
}
