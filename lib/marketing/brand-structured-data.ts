import { getPublicSupportConfig } from '@/lib/marketing-public-config';

/**
 * Profile and listing URLs for Khatario (G2, Capterra, Crunchbase, LinkedIn, YouTube, Play Store…).
 * Google uses them to tie the brand to one company. Add each one here once it is live; empty is fine.
 */
export const KHATARIO_PROFILE_URLS: string[] = [];

export const KHATARIO_BRAND_DESCRIPTION =
  'Khatario is a GST billing app for Indian shops and small businesses: GST bills on WhatsApp, stock, udhaar, accounting, GST reports and an online store, on phone and computer.';

/** The one Organization node shared by the home page and /about, so both describe the same entity. */
export function khatarioOrganizationJsonLd(site: string) {
  const email = getPublicSupportConfig().email;
  return {
    '@type': 'Organization',
    '@id': `${site}/#organization`,
    name: 'Khatario',
    alternateName: ['Khatario Billing App', 'Khatario App'],
    url: site,
    logo: `${site}/icon.png`,
    description: KHATARIO_BRAND_DESCRIPTION,
    areaServed: 'IN',
    ...(email ? { email, contactPoint: { '@type': 'ContactPoint', contactType: 'customer support', email, areaServed: 'IN' } } : {}),
    ...(KHATARIO_PROFILE_URLS.length > 0 ? { sameAs: KHATARIO_PROFILE_URLS } : {}),
  };
}
