jest.mock('@/lib/db', () => ({ getPool: () => ({}), queryOne: jest.fn(), queryRows: jest.fn() }));

import { classifyItcType } from '@/lib/gst/gstr9';

describe('classifyItcType (GSTR-9 Table 6B-6D split)', () => {
  it('honours an explicit itc_type', () => {
    expect(classifyItcType({ itc_type: 'capital_goods', line_item_type: 'goods' })).toBe('capital_goods');
  });

  it('treats service lines as input services', () => {
    expect(classifyItcType({ line_item_type: 'service' })).toBe('input_services');
    expect(classifyItcType({ item_type: 'service' })).toBe('input_services');
    expect(classifyItcType({ hsn_sac: '998314' })).toBe('input_services');
  });

  it('defaults goods to inputs', () => {
    expect(classifyItcType({ line_item_type: 'goods', hsn_sac: '9403' })).toBe('inputs');
    expect(classifyItcType({})).toBe('inputs');
  });
});
