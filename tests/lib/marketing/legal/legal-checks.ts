import { BLANK_COMPANY_FACTS } from '@/lib/marketing/company-facts';
import type { LegalContext, LegalDocumentData } from '@/lib/marketing/legal/types';

export function expectCleanLegalDocument(doc: LegalDocumentData) {
  expect(doc.updatedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  const ids = doc.sections.map((s) => s.id);
  expect(new Set(ids).size).toBe(ids.length);
  for (const s of doc.sections) {
    expect(s.id).toMatch(/^[a-z][a-z0-9-]*$/);
    expect(s.heading.trim().length).toBeGreaterThan(0);
    const lines = [...(s.paragraphs ?? []), ...(s.bullets ?? [])];
    expect(lines.length).toBeGreaterThan(0);
    for (const line of [s.heading, ...lines]) {
      expect(line).not.toMatch(/undefined|TODO|TBD|being prepared|\(\s*\)|\s{2,}|—/);
      expect(line).not.toMatch(/\bISO\b|SOC ?2|bank[- ]grade|military|100% secure|unhackable/i);
      expect(line.trim()).toBe(line);
    }
  }
}

// Shared by the refund, privacy and terms tests.
export const blank: LegalContext = { facts: BLANK_COMPANY_FACTS, supportEmail: 'help@khatario.com' };
export const filledAll: LegalContext = {
  supportEmail: 'help@khatario.com',
  facts: {
    legalName: 'Khatario Tech Pvt Ltd', registeredAddress: '12 MG Road\nIndore 452001', phone: '+91 98123 45678',
    gstin: '23ABCDE1234F1Z5', grievanceOfficerName: 'Asha Verma', grievanceEmail: 'grievance@khatario.com',
    jurisdictionCity: 'Indore',
    social: { instagram: 'https://instagram.com/khatario', youtube: '', facebook: '', linkedin: '', x: '' },
  },
};
