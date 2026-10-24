import { validateEnquiry, ENQUIRY_HONEYPOT_FIELD } from '@/lib/store/enquiry';
import { DEFAULT_CONTACT_FORM } from '@/lib/store/store-theme';

const form = { ...DEFAULT_CONTACT_FORM, enabled: true };
const good = { name: 'Asha', phone: '98765 43210', email: '', message: 'Do you deliver to Pune?' };

describe('validateEnquiry', () => {
  it('accepts a normal message and normalises the phone', () => {
    const r = validateEnquiry({ ...good, phone: '+91 98765 43210', source_path: '/contact' }, form);
    expect(r).toEqual({
      ok: true,
      value: { name: 'Asha', phone: '9876543210', email: null, topic: null, message: 'Do you deliver to Pune?', source_path: '/contact' },
    });
  });

  it('flags the honeypot as spam', () => {
    const r = validateEnquiry({ ...good, [ENQUIRY_HONEYPOT_FIELD]: 'http://spam' }, form);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.spam).toBe(true);
  });

  it('enforces required and valid fields', () => {
    expect(validateEnquiry({ ...good, phone: '' }, form)).toMatchObject({ ok: false, error: 'Phone number is required' });
    expect(validateEnquiry({ ...good, phone: '12345' }, form)).toMatchObject({ ok: false });
    expect(validateEnquiry({ ...good, email: 'nope' }, form)).toMatchObject({ ok: false, error: 'Enter a valid email' });
    expect(validateEnquiry({ ...good, message: 'hi' }, form)).toMatchObject({ ok: false });
    expect(validateEnquiry({ ...good, name: '' }, form)).toMatchObject({ ok: false, error: 'Name is required' });
  });

  it('ignores fields the merchant switched off', () => {
    const r = validateEnquiry(
      { ...good, phone: 'junk', email: 'a@b.co' },
      { ...form, phone: 'off', email: 'required' },
    );
    expect(r).toMatchObject({ ok: true, value: { phone: null, email: 'a@b.co' } });
  });

  it('requires one of the configured topics when the dropdown is on', () => {
    const withTopics = { ...form, topics: ['Bulk order', 'Order status'] };
    expect(validateEnquiry(good, withTopics)).toMatchObject({ ok: false, error: 'Please choose a topic' });
    expect(validateEnquiry({ ...good, topic: 'Hack' }, withTopics)).toMatchObject({ ok: false });
    expect(validateEnquiry({ ...good, topic: 'Bulk order' }, withTopics)).toMatchObject({ ok: true, value: { topic: 'Bulk order' } });
    expect(validateEnquiry({ ...good, topic: 'Bulk order' }, form)).toMatchObject({ ok: true, value: { topic: null } });
  });

  it('rejects link-stuffed messages', () => {
    const msg = 'http://a http://b http://c http://d';
    expect(validateEnquiry({ ...good, message: msg }, form)).toMatchObject({ ok: false, spam: true });
  });

  it('drops non-relative source paths', () => {
    const r = validateEnquiry({ ...good, source_path: 'https://evil.test' }, form);
    expect(r.ok && r.value.source_path).toBeNull();
  });
});
