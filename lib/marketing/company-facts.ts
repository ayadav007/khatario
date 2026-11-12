export type SocialNetwork = 'instagram' | 'youtube' | 'facebook' | 'linkedin' | 'x';

export type CompanyFacts = {
  legalName: string;
  registeredAddress: string;
  phone: string;
  gstin: string;
  grievanceOfficerName: string;
  grievanceEmail: string;
  jurisdictionCity: string;
  social: Record<SocialNetwork, string>;
};

export type CompanyFactName = Exclude<keyof CompanyFacts, 'social'>;
export type SocialLink = { network: SocialNetwork; url: string };

export const BLANK_COMPANY_FACTS: CompanyFacts = {
  legalName: '',
  registeredAddress: '',
  phone: '',
  gstin: '',
  grievanceOfficerName: '',
  grievanceEmail: '',
  jurisdictionCity: '',
  social: { instagram: '', youtube: '', facebook: '', linkedin: '', x: '' },
};

/**
 * The company facts shown on the public pages (contact, privacy, terms, refund, footer).
 * Owner: fill each field below. A blank field is hidden everywhere, so leave it '' until you have the real value.
 * - legalName: registered company name, e.g. "Khatario Technologies Pvt Ltd"
 * - registeredAddress: full registered office address; put each line on a new line (\n)
 * - phone: public support phone, with country code, e.g. "+91 98123 45678"
 * - gstin: the company's 15-character GSTIN
 * - grievanceOfficerName: name of the grievance officer
 * - grievanceEmail: email where complaints go to the grievance officer
 * - jurisdictionCity: city whose courts apply in the terms, e.g. "Indore"
 * - social: full https:// profile links for each network (anything not https is ignored)
 */
export const KHATARIO_COMPANY_FACTS: CompanyFacts = {
  ...BLANK_COMPANY_FACTS,
  social: { ...BLANK_COMPANY_FACTS.social },
};

export function fact(name: CompanyFactName, facts: CompanyFacts = KHATARIO_COMPANY_FACTS): string | null {
  const value = (facts[name] ?? '').trim();
  return value === '' ? null : value;
}

export function companyName(facts: CompanyFacts = KHATARIO_COMPANY_FACTS): string {
  return fact('legalName', facts) ?? 'Khatario';
}

export function addressLines(facts: CompanyFacts = KHATARIO_COMPANY_FACTS): string[] {
  return (facts.registeredAddress ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

export function telHref(phone: string): string | null {
  const trimmed = (phone ?? '').trim();
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < 8) return null;
  return `tel:${trimmed.startsWith('+') ? '+' : ''}${digits}`;
}

const SOCIAL_ORDER: SocialNetwork[] = ['instagram', 'youtube', 'facebook', 'linkedin', 'x'];

export function socialLinks(facts: CompanyFacts = KHATARIO_COMPANY_FACTS): SocialLink[] {
  const links: SocialLink[] = [];
  for (const network of SOCIAL_ORDER) {
    const raw = (facts.social?.[network] ?? '').trim();
    if (!raw) continue;
    try {
      if (new URL(raw).protocol === 'https:') links.push({ network, url: raw });
    } catch {
      // not a valid URL: skip
    }
  }
  return links;
}
