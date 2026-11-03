import {
  closedNotice,
  openStatusLabel,
  sanitizeStoreHours,
  storeOpenState,
  type StoreHours,
} from '@/lib/store/store-hours';

const day = { open: '07:00', close: '22:00' };
/** 07:00–22:00 Monday to Saturday, Sunday closed. */
const HOURS: StoreHours = { mon: day, tue: day, wed: day, thu: day, fri: day, sat: day, sun: null };

// 2026-11-02 is a Monday; 2026-11-07 a Saturday. IST is UTC+5:30.
const MON = (hhmm: string) => new Date(`2026-11-02T${hhmm}:00Z`);
const SAT = (hhmm: string) => new Date(`2026-11-07T${hhmm}:00Z`);

describe('storeOpenState (India time whatever the server clock)', () => {
  it('is open on Monday at 07:30 IST (02:00 UTC)', () => {
    const s = storeOpenState(HOURS, MON('02:00'));
    expect(s).toEqual({ state: 'open', closesAt: '22:00' });
    expect(openStatusLabel(s)).toBe('Open · till 10 PM');
    expect(closedNotice(s)).toBeNull();
  });

  it('is closed before opening at 06:00 IST and opens today', () => {
    const s = storeOpenState(HOURS, MON('00:30'));
    expect(s).toEqual({ state: 'closed', opensAt: '07:00', opensOn: 'today' });
    expect(openStatusLabel(s)).toBe('Closed · opens 7 AM');
    expect(closedNotice(s)).toBe("We're closed now. Orders placed now are delivered after we open at 7 AM.");
  });

  it('is closed after closing on Monday at 23:00 IST and opens tomorrow', () => {
    const s = storeOpenState(HOURS, MON('17:30'));
    expect(s).toEqual({ state: 'closed', opensAt: '07:00', opensOn: 'tomorrow' });
    expect(openStatusLabel(s)).toBe('Closed · opens tomorrow 7 AM');
    expect(closedNotice(s)).toBe(
      "We're closed now. Orders placed now are delivered after we open tomorrow at 7 AM.",
    );
  });

  it('skips a closed Sunday: Saturday 23:00 IST opens Mon', () => {
    const s = storeOpenState(HOURS, SAT('17:30'));
    expect(s).toEqual({ state: 'closed', opensAt: '07:00', opensOn: 'mon' });
    expect(openStatusLabel(s)).toBe('Closed · opens Mon 7 AM');
    expect(closedNotice(s)).toBe("We're closed now. Orders placed now are delivered after we open on Mon at 7 AM.");
  });

  it('crosses the UTC date line: Sunday 20:00 UTC is Monday 01:30 IST, opening today', () => {
    expect(storeOpenState(HOURS, new Date('2026-11-01T20:00:00Z'))).toEqual({
      state: 'closed',
      opensAt: '07:00',
      opensOn: 'today',
    });
  });

  it('is open at the opening minute and closed at the closing minute', () => {
    expect(storeOpenState(HOURS, MON('01:30')).state).toBe('open'); // 07:00 IST
    expect(storeOpenState(HOURS, MON('16:30'))).toEqual({ state: 'closed', opensAt: '07:00', opensOn: 'tomorrow' }); // 22:00 IST
  });

  it('writes half-hour times with minutes', () => {
    const half = { open: '09:30', close: '21:30' };
    const h: StoreHours = { mon: half, tue: half, wed: half, thu: half, fri: half, sat: half, sun: half };
    expect(openStatusLabel(storeOpenState(h, MON('02:00')))).toBe('Closed · opens 9:30 AM'); // 07:30 IST
    expect(openStatusLabel(storeOpenState(h, MON('06:00')))).toBe('Open · till 9:30 PM'); // 11:30 IST
  });

  it('writes noon as 12 PM', () => {
    const h: StoreHours = { ...HOURS, mon: { open: '12:00', close: '18:00' } };
    expect(openStatusLabel(storeOpenState(h, MON('02:00')))).toBe('Closed · opens 12 PM');
  });

  it('is unknown with no hours or every day closed', () => {
    const allClosed: StoreHours = { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null };
    for (const h of [null, allClosed]) {
      const s = storeOpenState(h, MON('02:00'));
      expect(s).toEqual({ state: 'unknown' });
      expect(openStatusLabel(s)).toBeNull();
      expect(closedNotice(s)).toBeNull();
    }
  });
});

describe('sanitizeStoreHours', () => {
  it('keeps valid days and fills missing days as closed', () => {
    expect(sanitizeStoreHours({ mon: day, sat: { open: '09:30', close: '21:30' } })).toEqual({
      mon: day,
      tue: null,
      wed: null,
      thu: null,
      fri: null,
      sat: { open: '09:30', close: '21:30' },
      sun: null,
    });
  });

  it('closes a day whose close is not after its open', () => {
    const out = sanitizeStoreHours({ mon: day, tue: { open: '22:00', close: '07:00' }, wed: { open: '09:00', close: '09:00' } });
    expect(out?.tue).toBeNull();
    expect(out?.wed).toBeNull();
    expect(out?.mon).toEqual(day);
  });

  it('rejects times without a leading zero or past 23:59', () => {
    const out = sanitizeStoreHours({
      mon: { open: '7:00', close: '22:00' },
      tue: { open: '07:00', close: '25:00' },
      wed: { open: '07:00', close: '22:60' },
      thu: day,
    });
    expect(out).toMatchObject({ mon: null, tue: null, wed: null, thu: day });
  });

  it('drops unknown keys and extra fields', () => {
    const out = sanitizeStoreHours({ mon: { ...day, note: 'x' }, holiday: day, monday: day });
    expect(Object.keys(out ?? {}).sort()).toEqual(['fri', 'mon', 'sat', 'sun', 'thu', 'tue', 'wed']);
    expect(out?.mon).toEqual(day);
  });

  it('gives null for a non-object, null, an array or nothing valid', () => {
    expect(sanitizeStoreHours(null)).toBeNull();
    expect(sanitizeStoreHours(undefined)).toBeNull();
    expect(sanitizeStoreHours('07:00-22:00')).toBeNull();
    expect(sanitizeStoreHours(42)).toBeNull();
    expect(sanitizeStoreHours([day])).toBeNull();
    expect(sanitizeStoreHours({ mon: null, tue: { open: 'x', close: 'y' } })).toBeNull();
  });
});
