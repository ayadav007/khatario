import { BLANK_COMPANY_FACTS } from '@/lib/marketing/company-facts';
import { getContactDetails } from '@/lib/marketing/contact-details';

const support = { email: 'help@khatario.com', whatsappUrl: null, hours: 'Mon–Sat · 9:00–18:00 IST' };

describe('getContactDetails', () => {
  it('shows only email when nothing else is set, and no office block', () => {
    const d = getContactDetails(BLANK_COMPANY_FACTS, support);
    expect(d.channels).toEqual([{ kind: 'email', label: 'Email', value: 'help@khatario.com', href: 'mailto:help@khatario.com' }]);
    expect(d.office).toBeNull();
    expect(d.grievance).toEqual({ officerName: null, email: 'help@khatario.com' });
  });

  it('adds WhatsApp and phone when set', () => {
    const d = getContactDetails({ ...BLANK_COMPANY_FACTS, phone: '+91 98123 45678' }, { ...support, whatsappUrl: 'https://wa.me/919812345678' });
    expect(d.channels.map((c) => c.kind)).toEqual(['email', 'whatsapp', 'phone']);
    expect(d.channels[2]).toMatchObject({ value: '+91 98123 45678', href: 'tel:+919812345678' });
  });

  it('drops a WhatsApp link that is not https and a phone too short to dial', () => {
    const d = getContactDetails({ ...BLANK_COMPANY_FACTS, phone: '123' }, { ...support, whatsappUrl: 'javascript:alert(1)' });
    expect(d.channels.map((c) => c.kind)).toEqual(['email']);
  });

  it('shows the office block when any one office fact is set', () => {
    const d = getContactDetails({ ...BLANK_COMPANY_FACTS, gstin: '23ABCDE1234F1Z5' }, support);
    expect(d.office).toEqual({ legalName: null, addressLines: [], gstin: '23ABCDE1234F1Z5' });
  });

  it('prefers the grievance email and survives no email at all', () => {
    expect(
      getContactDetails({ ...BLANK_COMPANY_FACTS, grievanceEmail: 'grievance@khatario.com', grievanceOfficerName: 'Asha Verma' }, support).grievance,
    ).toEqual({ officerName: 'Asha Verma', email: 'grievance@khatario.com' });
    const none = getContactDetails(BLANK_COMPANY_FACTS, { ...support, email: null });
    expect(none.channels).toEqual([]);
    expect(none.grievance.email).toBeNull();
  });
});
