import { allocateByWeight, costShare, planAcquisitionCosts } from '@/lib/purchases/acquisition-cost';

describe('purchase acquisition cost', () => {
  const goods = { taxable: 10000, tax: 1800, cess: 0, quantity: 10, stock: true, capital: false };

  it('gives the last positive line the paise remainder', () => {
    expect(allocateByWeight(100, [100, 100, 100])).toEqual([33.33, 33.33, 33.34]);
    expect(costShare(11000, 3, [1, 1, 1])).toEqual([3666.67, 3666.67, 3666.66]);
  });

  it('keeps eligible GST out of inventory cost and allocates freight by taxable value', () => {
    const plan = planAcquisitionCosts({
      lines: [goods, { ...goods, taxable: 5000, tax: 250, quantity: 1 }],
      charges: [{ purpose: 'Freight', amount: 1000, classification: 'incidental_to_goods', tax_rate: 18, hsn_sac: '9965' }],
      itcEligible: true,
      capitalize: true,
      intraState: true,
      billDate: '2026-10-09',
    });
    expect(plan.charges[0].cgst).toBe(90);
    expect(plan.charges[0].sgst).toBe(90);
    expect(plan.lineCosts).toEqual([10666.67, 5333.33]);
    expect(plan.capitalized).toBe(true);
  });

  it('includes blocked GST in the acquisition cost', () => {
    const plan = planAcquisitionCosts({
      lines: [goods],
      charges: [{ amount: 1000, classification: 'incidental_to_goods', tax_rate: 18 }],
      itcEligible: false,
      capitalize: true,
      intraState: true,
      billDate: '2026-10-09',
    });
    expect(plan.lineCosts[0]).toBe(12980);
  });

  it('does not allocate an independent service or a periodic bill', () => {
    const independent = planAcquisitionCosts({
      lines: [goods],
      charges: [{ amount: 500, classification: 'independent_service', tax_rate: 18 }],
      itcEligible: true,
      capitalize: true,
      intraState: true,
      billDate: '2026-10-09',
    });
    expect(independent.lineCosts).toEqual([10000]);
    expect(independent.capitalized).toBe(false);

    const periodic = planAcquisitionCosts({
      lines: [goods],
      charges: [{ amount: 1000, classification: 'incidental_to_goods', tax_rate: 18 }],
      itcEligible: true,
      capitalize: false,
      intraState: true,
      billDate: '2026-10-09',
    });
    expect(periodic.lineCosts).toEqual([null]);
    expect(periodic.capitalized).toBe(false);
  });

  it('rejects an unclassified charge and a line eligibility that disagrees with the bill', () => {
    expect(() =>
      planAcquisitionCosts({
        lines: [goods],
        charges: [{ amount: 1000, tax_rate: 18 }],
        itcEligible: true,
        capitalize: true,
        intraState: true,
        billDate: '2026-10-09',
      })
    ).toThrow(/classified/);
    expect(() =>
      planAcquisitionCosts({
        lines: [goods],
        charges: [{ amount: 1000, classification: 'incidental_to_goods', tax_rate: 18, itc_eligible: false }],
        itcEligible: true,
        capitalize: true,
        intraState: true,
        billDate: '2026-10-09',
      })
    ).toThrow(/ITC eligibility/);
  });
});
