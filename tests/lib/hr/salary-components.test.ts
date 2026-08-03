import {
  linesToLegacyColumns,
  resolveLineAmount,
  buildPaymentComponentBreakdown,
  type SalaryComponentDefinition,
} from '@/lib/hr/salary-components';

describe('salary-components', () => {
  const catalog: SalaryComponentDefinition[] = [
    {
      id: 'b',
      business_id: 'biz',
      code: 'BASIC',
      name: 'Basic',
      component_type: 'earning',
      calculation_type: 'fixed',
      system_key: 'basic_salary',
      is_system: true,
      is_active: true,
      sort_order: 10,
    },
    {
      id: 'h',
      business_id: 'biz',
      code: 'HRA',
      name: 'HRA',
      component_type: 'earning',
      calculation_type: 'fixed',
      system_key: 'hra',
      is_system: true,
      is_active: true,
      sort_order: 20,
    },
    {
      id: 'f',
      business_id: 'biz',
      code: 'FUEL',
      name: 'Fuel allowance',
      component_type: 'earning',
      calculation_type: 'fixed',
      system_key: null,
      is_system: false,
      is_active: true,
      sort_order: 200,
    },
    {
      id: 'pf',
      business_id: 'biz',
      code: 'PF',
      name: 'PF',
      component_type: 'deduction',
      calculation_type: 'percent_basic',
      system_key: 'pf_percentage',
      is_system: true,
      is_active: true,
      sort_order: 110,
    },
  ];

  it('resolveLineAmount handles percent of basic', () => {
    expect(
      resolveLineAmount(
        { calculation_type: 'percent_basic', value: 12, component_type: 'deduction' },
        10000,
        15000,
      ),
    ).toBe(1200);
  });

  it('linesToLegacyColumns folds custom earnings into other_allowances', () => {
    const cols = linesToLegacyColumns(
      [
        { component_id: 'b', value: 20000 },
        { component_id: 'h', value: 8000 },
        { component_id: 'f', value: 1500 },
        { component_id: 'pf', value: 12 },
      ],
      catalog,
    );
    expect(cols.basic_salary).toBe(20000);
    expect(cols.hra).toBe(8000);
    expect(cols.other_allowances).toBe(1500);
    expect(cols.pf_percentage).toBe(12);
  });

  it('buildPaymentComponentBreakdown includes custom lines', () => {
    const out = buildPaymentComponentBreakdown({
      structureLines: [
        {
          component_id: 'b',
          code: 'BASIC',
          name: 'Basic',
          component_type: 'earning',
          calculation_type: 'fixed',
          system_key: 'basic_salary',
          value: 20000,
          amount: 20000,
        },
        {
          component_id: 'f',
          code: 'FUEL',
          name: 'Fuel allowance',
          component_type: 'earning',
          calculation_type: 'fixed',
          system_key: null,
          value: 1500,
          amount: 1500,
        },
        {
          component_id: 'pf',
          code: 'PF',
          name: 'PF',
          component_type: 'deduction',
          calculation_type: 'percent_basic',
          system_key: 'pf_percentage',
          value: 12,
          amount: 2400,
        },
      ],
      statutory: { provident_fund: 1800 },
    });
    expect(out.find((x) => x.code === 'FUEL')?.amount).toBe(1500);
    expect(out.find((x) => x.code === 'PF')?.amount).toBe(1800);
  });
});
