import { parseAddBusinessInput } from '@/lib/businesses/create-business-input';

describe('parseAddBusinessInput', () => {
  it('accepts a name, type, and industry', () => {
    const parsed = parseAddBusinessInput({
      businessName: 'Sharma Traders',
      businessType: 'wholesaler',
      industry: 'textiles',
    });
    expect(parsed).toEqual({
      ok: true,
      value: {
        businessName: 'Sharma Traders',
        businessType: 'wholesaler',
        industry: 'textiles',
        businessModel: null,
      },
    });
  });

  it('rejects a client-supplied user or business id', () => {
    expect(parseAddBusinessInput({ businessName: 'A', businessType: 'retail', industry: 'other', user_id: 'x' }).ok).toBe(
      false,
    );
    expect(parseAddBusinessInput({ businessName: 'A', businessType: 'retail', industry: 'other', business_id: 'x' }).ok).toBe(
      false,
    );
  });

  it('rejects an unknown industry', () => {
    const parsed = parseAddBusinessInput({
      businessName: 'Shop',
      businessType: 'retail',
      industry: 'restaurant',
    });
    expect(parsed.ok).toBe(false);
  });
});
