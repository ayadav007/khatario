import { toIffJson } from '@/lib/export/json';
import { parseEwayBillDate, parseEwayBillNumber } from '@/lib/gst/eway';

describe('parseEwayBillNumber', () => {
  it('accepts 12 digits and allows a blank number', () => {
    expect(parseEwayBillNumber('391234567890')).toEqual({ number: '391234567890' });
    expect(parseEwayBillNumber('')).toEqual({ number: null });
    expect(parseEwayBillNumber('123').error).toMatch(/12 digits/);
  });
});

describe('parseEwayBillDate', () => {
  it('accepts an ISO date or blank', () => {
    expect(parseEwayBillDate('2026-10-11')).toEqual({ date: '2026-10-11' });
    expect(parseEwayBillDate('')).toEqual({ date: null });
    expect(parseEwayBillDate('11-10-2026').error).toMatch(/YYYY-MM-DD/);
  });
});

describe('toIffJson', () => {
  it('keeps registered invoices and notes and drops B2C sections', () => {
    const iff = JSON.parse(
      toIffJson(
        JSON.stringify({
          gstin: '29AAAAA0000A1Z5',
          fp: '102026',
          gt: 100,
          cur_gt: 100,
          b2b: [{ ctin: 'x' }],
          b2ba: [],
          b2cs: [{ pos: '29' }],
          cdnr: [{ ctin: 'y' }],
          hsn: { data: [] },
        }),
      ),
    );
    expect(iff.b2b).toHaveLength(1);
    expect(iff.cdnr).toHaveLength(1);
    expect(iff.b2cs).toBeUndefined();
    expect(iff.hsn).toBeUndefined();
    expect(iff.version).toBe('IFF-1.1');
  });
});
