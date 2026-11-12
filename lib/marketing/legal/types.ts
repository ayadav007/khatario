import { KHATARIO_COMPANY_FACTS, type CompanyFacts } from '@/lib/marketing/company-facts';
import { getPublicSupportConfig } from '@/lib/marketing-public-config';

export type LegalSection = { id: string; heading: string; paragraphs?: string[]; bullets?: string[] };
/** updatedOn is 'YYYY-MM-DD'. */
export type LegalDocumentData = { updatedOn: string; sections: LegalSection[] };
export type LegalContext = { facts: CompanyFacts; supportEmail: string };

export function defaultLegalContext(): LegalContext {
  return { facts: KHATARIO_COMPANY_FACTS, supportEmail: getPublicSupportConfig().email ?? 'help@khatario.com' };
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** '2026-11-12' -> '12 November 2026'. Built from the numbers, so the server time zone does not matter. */
export function formatLegalDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const month = MONTHS[Number(m[2]) - 1];
  if (!month) return iso;
  return `${Number(m[3])} ${month} ${m[1]}`;
}
