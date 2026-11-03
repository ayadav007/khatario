import { storeInfoView, todayHoursLabel } from '@/lib/store/engine/store-info-map';
import type { StoreHours } from '@/lib/store/store-hours';

const day = { open: '07:00', close: '22:00' };
const HOURS: StoreHours = { mon: day, tue: day, wed: day, thu: day, fri: day, sat: null, sun: day };

const base = {
  storeName: 'Sharma Kirana',
  heading: '',
  phone: '9845012345',
  address: '12 MG Road, Bengaluru 560034',
  hours: HOURS,
  whatsapp: 'https://wa.me/919845012345',
  showHours: true,
  showAddress: true,
  showButtons: true,
};

describe('storeInfoView', () => {
  it('builds call, WhatsApp and directions links', () => {
    const v = storeInfoView(base)!;
    expect(v.heading).toBe('Sharma Kirana');
    expect(v.callHref).toBe('tel:+919845012345');
    expect(v.whatsappHref).toBe('https://wa.me/919845012345');
    expect(v.directionsHref).toBe(
      'https://www.google.com/maps/search/?api=1&query=12%20MG%20Road%2C%20Bengaluru%20560034',
    );
    expect(v.address).toBe('12 MG Road, Bengaluru 560034');
    expect(v.hours).toBe(HOURS);
  });

  it('uses the typed heading over the store name', () => {
    expect(storeInfoView({ ...base, heading: '  Visit us ' })!.heading).toBe('Visit us');
  });

  it('only gives a WhatsApp link when the number reads', () => {
    expect(storeInfoView({ ...base, whatsapp: 'https://instagram.com/x' })!.whatsappHref).toBeNull();
    expect(storeInfoView({ ...base, whatsapp: '' })!.whatsappHref).toBeNull();
  });

  it('reads common phone formats', () => {
    expect(storeInfoView({ ...base, phone: '+91 98450 12345' })!.callHref).toBe('tel:+919845012345');
    expect(storeInfoView({ ...base, phone: '919845012345' })!.callHref).toBe('tel:+919845012345');
    expect(storeInfoView({ ...base, phone: '080 2345 6789' })!.callHref).toBe('tel:08023456789');
    expect(storeInfoView({ ...base, phone: 'call us' })!.callHref).toBeNull();
  });

  it('hides parts with no data and returns null when all are missing', () => {
    const noPhone = storeInfoView({ ...base, phone: null, whatsapp: '', hours: null })!;
    expect(noPhone).toEqual({
      heading: 'Sharma Kirana',
      hours: null,
      address: '12 MG Road, Bengaluru 560034',
      callHref: null,
      whatsappHref: null,
      directionsHref: expect.stringContaining('google.com/maps'),
    });
    const noAddress = storeInfoView({ ...base, address: '  ', hours: null })!;
    expect(noAddress.address).toBeNull();
    expect(noAddress.directionsHref).toBeNull();
    expect(noAddress.callHref).toBe('tel:+919845012345');
    expect(storeInfoView({ ...base, phone: null, whatsapp: '', address: null, hours: null })).toBeNull();
  });

  it('hides a part its setting turns off, and is null when that leaves nothing', () => {
    const v = storeInfoView({ ...base, showHours: false, showAddress: false, showButtons: false });
    expect(v).toBeNull();
    const noButtons = storeInfoView({ ...base, showButtons: false })!;
    expect(noButtons.callHref).toBeNull();
    expect(noButtons.whatsappHref).toBeNull();
    expect(noButtons.directionsHref).toBeNull();
    expect(noButtons.address).not.toBeNull();
    expect(storeInfoView({ ...base, showHours: false })!.hours).toBeNull();
    expect(storeInfoView({ ...base, showAddress: false })!.address).toBeNull();
  });
});

describe('todayHoursLabel', () => {
  it('reads today in India time, not the clock zone', () => {
    // 2026-11-03 is a Tuesday. 20:00 UTC on Tuesday is already 01:30 Wednesday in India.
    expect(todayHoursLabel(HOURS, new Date('2026-11-03T05:00:00Z'))).toBe('Open today 7 AM – 10 PM');
    expect(todayHoursLabel(HOURS, new Date('2026-11-03T20:00:00Z'))).toBe('Open today 7 AM – 10 PM');
    // 19:00 UTC Friday is 00:30 Saturday in India, the closed day.
    expect(todayHoursLabel(HOURS, new Date('2026-11-06T19:00:00Z'))).toBe('Closed today');
    // 02:00 UTC Saturday is 07:30 Saturday in India: closed all day.
    expect(todayHoursLabel(HOURS, new Date('2026-11-07T02:00:00Z'))).toBe('Closed today');
  });
});
