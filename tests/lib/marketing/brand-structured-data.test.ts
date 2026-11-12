import { khatarioOrganizationJsonLd } from '@/lib/marketing/brand-structured-data';
import { BLANK_COMPANY_FACTS, type CompanyFacts } from '@/lib/marketing/company-facts';

const site = 'https://khatario.com';
const filled: CompanyFacts = {
  ...BLANK_COMPANY_FACTS,
  legalName: '  Khatario Tech Pvt Ltd ', registeredAddress: '12 MG Road\n\n  Indore 452001 \nMadhya Pradesh',
  phone: '+91 98123-45678',
  social: { instagram: 'https://instagram.com/khatario', youtube: 'http://youtube.com/@k', facebook: 'javascript:alert(1)', linkedin: '   ', x: 'https://x.com/khatario' },
};

describe('khatarioOrganizationJsonLd', () => {
  it('omits legal name, phone, address and sameAs when facts are blank', () => {
    const org = khatarioOrganizationJsonLd(site, BLANK_COMPANY_FACTS);
    for (const key of ['legalName', 'telephone', 'address', 'sameAs']) expect(org).not.toHaveProperty(key);
    expect(org['@id']).toBe('https://khatario.com/#organization');
  });
  it('adds them when facts are set', () => {
    const org = khatarioOrganizationJsonLd(site, filled);
    expect(org.legalName).toBe('Khatario Tech Pvt Ltd');
    expect(org.telephone).toBe('+919812345678');
    expect(org.address).toEqual({ '@type': 'PostalAddress', streetAddress: '12 MG Road, Indore 452001, Madhya Pradesh', addressCountry: 'IN' });
    expect(org.sameAs).toEqual(['https://instagram.com/khatario', 'https://x.com/khatario']);
  });
});
