import {
  BLANK_COMPANY_FACTS,
  KHATARIO_COMPANY_FACTS,
  addressLines,
  companyName,
  fact,
  socialLinks,
  telHref,
  type CompanyFacts,
} from '@/lib/marketing/company-facts';

const filled: CompanyFacts = {
  ...BLANK_COMPANY_FACTS,
  legalName: '  Khatario Tech Pvt Ltd ', registeredAddress: '12 MG Road\n\n  Indore 452001 \nMadhya Pradesh',
  phone: '+91 98123-45678',
  social: { instagram: 'https://instagram.com/khatario', youtube: 'http://youtube.com/@k', facebook: 'javascript:alert(1)', linkedin: '   ', x: 'https://x.com/khatario' },
};

describe('company facts', () => {
  it('returns null for blank and whitespace-only facts', () => {
    expect(fact('legalName', BLANK_COMPANY_FACTS)).toBeNull();
    expect(fact('gstin', { ...BLANK_COMPANY_FACTS, gstin: '   ' })).toBeNull();
    expect(fact('legalName', filled)).toBe('Khatario Tech Pvt Ltd');
  });
  it('falls back to the brand name', () => {
    expect(companyName(BLANK_COMPANY_FACTS)).toBe('Khatario');
    expect(companyName(filled)).toBe('Khatario Tech Pvt Ltd');
  });
  it('splits the address into clean lines', () => {
    expect(addressLines(filled)).toEqual(['12 MG Road', 'Indore 452001', 'Madhya Pradesh']);
    expect(addressLines(BLANK_COMPANY_FACTS)).toEqual([]);
  });
  it('builds a tel link from a formatted phone', () => {
    expect(telHref('+91 98123-45678')).toBe('tel:+919812345678');
    expect(telHref('098123 45678')).toBe('tel:09812345678');
    expect(telHref('')).toBeNull();
    expect(telHref('12345')).toBeNull();
  });
  it('keeps only https social links, in a fixed order', () => {
    expect(socialLinks(filled)).toEqual([
      { network: 'instagram', url: 'https://instagram.com/khatario' },
      { network: 'x', url: 'https://x.com/khatario' },
    ]);
    expect(socialLinks(BLANK_COMPANY_FACTS)).toEqual([]);
  });
  it('ships with every fact blank until the owner fills it', () => {
    expect(KHATARIO_COMPANY_FACTS).toEqual(BLANK_COMPANY_FACTS);
  });
});
