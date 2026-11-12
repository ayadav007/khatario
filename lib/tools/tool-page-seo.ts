import type { Metadata } from 'next';
import { Banknote, BarChart, Calculator, CreditCard, FileImage, FileText, Hash, Percent, RefreshCw, Search, Tag, TrendingUp, UserCheck, Wand2, type LucideIcon } from 'lucide-react';
import type { FreeTool } from '@/lib/tools/catalogue';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function plain(text: string): string {
  return text.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '$1');
}

function pageMetadata(path: string, title: string, description: string): Metadata {
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: path },
    openGraph: { title, description, type: 'website', siteName: 'Khatario', images: ['/opengraph-image'] },
    twitter: { card: 'summary_large_image', title, description },
  };
}

export function toolPageMetadata(tool: FreeTool): Metadata {
  return pageMetadata(`/free-tools/${tool.slug}`, tool.metaTitle, tool.metaDescription);
}

export const HUB_TITLE = 'Free Business Tools for Indian Shops | Khatario';
export const HUB_DESCRIPTION =
  'Free GST calculator, invoice maker, GSTIN and PAN checker, HSN finder, EMI and margin calculators. No sign-up needed.';

export function hubMetadata(): Metadata {
  return pageMetadata('/free-tools', HUB_TITLE, HUB_DESCRIPTION);
}

export function toolPageJsonLd(tool: FreeTool, site: string): Record<string, unknown> {
  const url = `${site}/free-tools/${tool.slug}`;
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'SoftwareApplication',
        '@id': `${url}#app`,
        name: tool.title,
        description: tool.metaDescription,
        url,
        applicationCategory: 'BusinessApplication',
        operatingSystem: 'Any',
        inLanguage: 'en-IN',
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'INR' },
        publisher: { '@id': `${site}/#organization` },
      },
      {
        '@type': 'FAQPage',
        '@id': `${url}#faq`,
        mainEntity: tool.faqs.map((f) => ({
          '@type': 'Question',
          name: f.question,
          acceptedAnswer: { '@type': 'Answer', text: plain(f.answer) },
        })),
      },
      {
        '@type': 'BreadcrumbList',
        '@id': `${url}#breadcrumb`,
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Free tools', item: `${site}/free-tools` },
          { '@type': 'ListItem', position: 2, name: tool.title, item: url },
        ],
      },
    ],
  };
}

export function hubJsonLd(tools: FreeTool[], site: string): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    '@id': `${site}/free-tools#webpage`,
    url: `${site}/free-tools`,
    name: HUB_TITLE,
    description: HUB_DESCRIPTION,
    inLanguage: 'en-IN',
    mainEntity: {
      '@type': 'ItemList',
      itemListElement: tools.map((t, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: t.title,
        url: `${site}/free-tools/${t.slug}`,
      })),
    },
  };
}

/** '2026-11' -> 'Rates as of November 2026. Check the latest notification before filing.' */
export function ratesAsOfLine(checkedOn: string): string {
  const [year, month] = checkedOn.split('-');
  const name = MONTHS[Number(month) - 1];
  const when = name ? `${name} ${year}` : checkedOn;
  return `Rates as of ${when}. Check the latest notification before filing.`;
}

const ICONS: Record<string, LucideIcon> = {
  Banknote, BarChart, Calculator, CreditCard, FileImage, FileText, Hash, Percent, RefreshCw, Search, Tag, TrendingUp, UserCheck, Wand2,
};

/** Icon for a catalogue `icon` name; falls back to a calculator. */
export function toolIcon(name: string): LucideIcon {
  return ICONS[name] ?? Calculator;
}
