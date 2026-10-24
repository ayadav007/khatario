import {
  allowedPlSections,
  effectivePlSection,
  isAllowedPlSection,
  isPlSection,
  plSectionFromGroup,
  sectionAmount,
  SYSTEM_PL_SECTIONS,
} from '@/lib/accounting/pl-sections';

describe('pl-sections', () => {
  it('places system accounts as Zoho does', () => {
    expect(SYSTEM_PL_SECTIONS['4102']).toBe('operating_expense');
    expect(SYSTEM_PL_SECTIONS['4201']).toBe('operating_income');
    expect(SYSTEM_PL_SECTIONS['4202']).toBe('operating_income');
    expect(SYSTEM_PL_SECTIONS['5204']).toBe('operating_expense');
    expect(SYSTEM_PL_SECTIONS['5207']).toBe('operating_expense');
    expect(SYSTEM_PL_SECTIONS['5210']).toBe('other_expense');
    expect(SYSTEM_PL_SECTIONS['5211']).toBe('other_expense');
    expect(SYSTEM_PL_SECTIONS['5299']).toBe('operating_income');
    expect(SYSTEM_PL_SECTIONS['4103']).toBe('elimination');
    expect(SYSTEM_PL_SECTIONS['5103']).toBe('elimination');
  });

  it('defaults custom accounts from their group', () => {
    expect(plSectionFromGroup('income', '4100')).toBe('operating_income');
    expect(plSectionFromGroup('income', '4000')).toBe('operating_income');
    expect(plSectionFromGroup('income', '4200')).toBe('other_income');
    expect(plSectionFromGroup('expense', '5100')).toBe('cost_of_goods_sold');
    expect(plSectionFromGroup('expense', '5200')).toBe('operating_expense');
    expect(plSectionFromGroup('expense', '5000')).toBe('operating_expense');
    expect(plSectionFromGroup('expense', '6000')).toBe('elimination');
    expect(plSectionFromGroup('income', 'X', 'elimination')).toBe('elimination');
    expect(plSectionFromGroup('asset', '1000')).toBeNull();
  });

  it('uses stored section, then system code, then group', () => {
    const base = { account_type: 'expense', group_code: '5200' };
    expect(effectivePlSection({ ...base, account_code: '5210', is_system: true })).toBe('other_expense');
    expect(effectivePlSection({ ...base, account_code: '5210', is_system: true, pl_section: 'operating_expense' })).toBe('operating_expense');
    // A custom account that happens to reuse a system code follows its group.
    expect(effectivePlSection({ ...base, account_code: '5210', is_system: false })).toBe('operating_expense');
    expect(effectivePlSection({ ...base, account_code: '5999', is_system: false, pl_section: 'bogus' })).toBe('operating_expense');
    expect(effectivePlSection({ account_type: 'asset', account_code: '1101' })).toBeNull();
  });

  it('allows contra placements but not cross-type non-operating ones', () => {
    expect(isAllowedPlSection('income', 'operating_expense')).toBe(true);
    expect(isAllowedPlSection('expense', 'operating_income')).toBe(true);
    expect(isAllowedPlSection('income', 'other_expense')).toBe(false);
    expect(isAllowedPlSection('expense', 'other_income')).toBe(false);
    expect(isAllowedPlSection('asset', 'operating_income')).toBe(false);
    expect(allowedPlSections('capital')).toEqual([]);
    expect(isPlSection('tax_expense')).toBe(false);
  });

  it('signs amounts by section, and elimination by type', () => {
    expect(sectionAmount('operating_income', 'income', 0, 100)).toBe(100);
    expect(sectionAmount('operating_income', 'expense', 0, 100)).toBe(100);
    expect(sectionAmount('operating_expense', 'income', 0, 100)).toBe(-100);
    expect(sectionAmount('other_expense', 'expense', 100, 0)).toBe(100);
    expect(sectionAmount('elimination', 'income', 0, 100)).toBe(100);
    expect(sectionAmount('elimination', 'expense', 100, 0)).toBe(100);
  });
});
