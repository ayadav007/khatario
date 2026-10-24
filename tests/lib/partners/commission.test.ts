import { computeCommissionAmount } from '@/lib/partners/commission';
import { normalizeReferralCode, buildPartnerSignupUrl } from '@/lib/partners/codes';

describe('partner referral codes', () => {
  it('normalizes ?ref= values', () => {
    expect(normalizeReferralCode(' rajesh ')).toBe('RAJESH');
    expect(normalizeReferralCode('raj-esh_01')).toBe('RAJ-ESH_01');
    expect(normalizeReferralCode('a')).toBeNull();
    expect(normalizeReferralCode('')).toBeNull();
  });

  it('builds signup URLs with ?ref=', () => {
    expect(buildPartnerSignupUrl('https://khatario.com', 'RAJESH')).toBe(
      'https://khatario.com/signup?ref=RAJESH',
    );
  });
});

describe('computeCommissionAmount', () => {
  it('computes percentage of sale', () => {
    expect(
      computeCommissionAmount({
        saleAmount: 1000,
        commissionType: 'percentage',
        commissionValue: 20,
      }),
    ).toBe(200);
  });

  it('computes fixed commission capped by sale', () => {
    expect(
      computeCommissionAmount({
        saleAmount: 500,
        commissionType: 'fixed',
        commissionValue: 800,
      }),
    ).toBe(500);
    expect(
      computeCommissionAmount({
        saleAmount: 2000,
        commissionType: 'fixed',
        commissionValue: 500,
      }),
    ).toBe(500);
  });

  it('returns zero for empty sale', () => {
    expect(
      computeCommissionAmount({
        saleAmount: 0,
        commissionType: 'percentage',
        commissionValue: 25,
      }),
    ).toBe(0);
  });
});
