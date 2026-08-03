import { calculateStatutory } from '@/lib/hr/statutory';
import { DEFAULT_HR_PAYROLL_SETTINGS } from '@/lib/hr/hr-payroll-settings';

describe('calculateStatutory', () => {
  it('caps PF wage at ceiling and computes EE/ER', () => {
    const result = calculateStatutory({
      settings: { ...DEFAULT_HR_PAYROLL_SETTINGS, pf_enabled: true, pf_wage_ceiling: 15000 },
      basic: 25000,
      gross: 40000,
    });
    expect(result.pf_wage).toBe(15000);
    expect(result.provident_fund).toBe(1800);
    expect(result.employer_provident_fund).toBe(1800);
  });

  it('skips ESI when gross above ceiling', () => {
    const result = calculateStatutory({
      settings: {
        ...DEFAULT_HR_PAYROLL_SETTINGS,
        esi_enabled: true,
        esi_wage_ceiling: 21000,
      },
      basic: 15000,
      gross: 25000,
    });
    expect(result.esi_employee).toBe(0);
    expect(result.breakdown.esi_source).toBe('above_ceiling');
  });

  it('applies MH PT slab', () => {
    const result = calculateStatutory({
      settings: {
        ...DEFAULT_HR_PAYROLL_SETTINGS,
        pf_enabled: false,
        pt_enabled: true,
        pt_state: 'MH',
      },
      basic: 20000,
      gross: 20000,
    });
    expect(result.professional_tax).toBe(200);
  });
});
