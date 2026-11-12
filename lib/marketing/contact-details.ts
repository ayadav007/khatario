import { addressLines, fact, telHref, type CompanyFacts } from '@/lib/marketing/company-facts';

export type SupportConfig = { email: string | null; whatsappUrl: string | null; hours: string };
export type ContactChannel = { kind: 'email' | 'whatsapp' | 'phone'; label: string; value: string; href: string };
export type ContactDetails = {
  channels: ContactChannel[];
  hours: string;
  office: { legalName: string | null; addressLines: string[]; gstin: string | null } | null;
  grievance: { officerName: string | null; email: string | null };
};

function httpsUrl(raw: string | null): string | null {
  const value = (raw ?? '').trim();
  if (!value) return null;
  try {
    return new URL(value).protocol === 'https:' ? value : null;
  } catch {
    return null;
  }
}

export function getContactDetails(facts: CompanyFacts, support: SupportConfig): ContactDetails {
  const channels: ContactChannel[] = [];

  const email = (support.email ?? '').trim();
  if (email) channels.push({ kind: 'email', label: 'Email', value: email, href: `mailto:${email}` });

  const whatsapp = httpsUrl(support.whatsappUrl);
  if (whatsapp) channels.push({ kind: 'whatsapp', label: 'WhatsApp', value: 'Chat on WhatsApp', href: whatsapp });

  const phone = fact('phone', facts);
  const tel = phone ? telHref(phone) : null;
  if (phone && tel) channels.push({ kind: 'phone', label: 'Phone', value: phone, href: tel });

  const legalName = fact('legalName', facts);
  const lines = addressLines(facts);
  const gstin = fact('gstin', facts);
  const office = legalName || lines.length > 0 || gstin ? { legalName, addressLines: lines, gstin } : null;

  return {
    channels,
    hours: support.hours,
    office,
    grievance: {
      officerName: fact('grievanceOfficerName', facts),
      email: fact('grievanceEmail', facts) ?? (email || null),
    },
  };
}
