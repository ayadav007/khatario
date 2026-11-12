import { getPublicSupportConfig } from '@/lib/marketing-public-config';
import { KHATARIO_COMPANY_FACTS, addressLines, fact, socialLinks, telHref, type CompanyFacts } from '@/lib/marketing/company-facts';

/**
 * Profile and listing URLs for Khatario (G2, Capterra, Crunchbase, LinkedIn, YouTube, Play Store…).
 * Google uses them to tie the brand to one company. Add each one here once it is live; empty is fine.
 */
export const KHATARIO_PROFILE_URLS: string[] = [];

export const KHATARIO_BRAND_DESCRIPTION =
  'Khatario is a GST billing app for Indian shops and small businesses: GST bills on WhatsApp, stock, udhaar, accounting, GST reports and an online store, on phone and computer.';

/** The one Organization node shared by the home page and /about, so both describe the same entity. */
export function khatarioOrganizationJsonLd(site: string, facts: CompanyFacts = KHATARIO_COMPANY_FACTS): Record<string, unknown> {
  const email = getPublicSupportConfig().email;
  const legalName = fact('legalName', facts);
  const phone = fact('phone', facts);
  const tel = phone ? telHref(phone) : null;
  const lines = addressLines(facts);
  const sameAs = Array.from(new Set([...KHATARIO_PROFILE_URLS, ...socialLinks(facts).map((l) => l.url)]));
  return {
    '@type': 'Organization',
    '@id': `${site}/#organization`,
    name: 'Khatario',
    alternateName: ['Khatario Billing App', 'Khatario App'],
    url: site,
    logo: `${site}/icon.png`,
    description: KHATARIO_BRAND_DESCRIPTION,
    ...(legalName ? { legalName } : {}),
    areaServed: 'IN',
    ...(tel ? { telephone: tel.replace(/^tel:/, '') } : {}),
    ...(lines.length > 0 ? { address: { '@type': 'PostalAddress', streetAddress: lines.join(', '), addressCountry: 'IN' } } : {}),
    ...(email ? { email, contactPoint: { '@type': 'ContactPoint', contactType: 'customer support', email, areaServed: 'IN' } } : {}),
    ...(sameAs.length > 0 ? { sameAs } : {}),
  };
}
