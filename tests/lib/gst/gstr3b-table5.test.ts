import { aggregateTable5, classifyInwardLineForTable5, isNonGstHsn } from '@/lib/gst/gstr3b-table5';

const line = (over: Partial<Parameters<typeof aggregateTable5>[0][number]> = {}) => ({
  taxableValue: 1000,
  taxAmount: 0,
  hsn: '0713',
  isReverseCharge: false,
  isImport: false,
  supplierStateCode: '29',
  recipientStateCode: '29',
  ...over,
});

describe('GSTR-3B Table 5 classification — Run 11 L11', () => {
  it('petroleum and alcohol are non-GST by HSN', () => {
    expect(isNonGstHsn('27101930')).toBe(true);
    expect(isNonGstHsn('2208 30 11')).toBe(true);
    expect(isNonGstHsn('27101990')).toBe(false);
    expect(isNonGstHsn('')).toBe(false);
  });

  it('zero-tax line from composition / unregistered / exempt supply → row 1', () => {
    expect(classifyInwardLineForTable5(line())).toBe('composition_exempt_nil');
  });

  it('taxed line, RCM line and import line are not Table 5', () => {
    expect(classifyInwardLineForTable5(line({ taxAmount: 180 }))).toBeNull();
    expect(classifyInwardLineForTable5(line({ isReverseCharge: true }))).toBeNull();
    expect(classifyInwardLineForTable5(line({ isImport: true }))).toBeNull();
  });

  it('splits inter-state and intra-state by supplier vs recipient state', () => {
    const t = aggregateTable5([
      line(),
      line({ supplierStateCode: '27', taxableValue: 500 }),
      line({ hsn: '27101930', taxableValue: 2000 }),
      line({ hsn: '2204', supplierStateCode: '33', taxableValue: 300 }),
      line({ taxAmount: 90 }),
    ]);
    expect(t.composition_exempt_nil).toEqual({ intra_state: 1000, inter_state: 500 });
    expect(t.non_gst).toEqual({ intra_state: 2000, inter_state: 300 });
  });
});
