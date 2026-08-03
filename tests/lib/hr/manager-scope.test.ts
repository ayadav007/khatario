import { buildOrgChartTree, type OrgChartEmployee } from '@/lib/hr/org-chart';
import {
  parseHrApprovalSettings,
  DEFAULT_HR_APPROVAL_SETTINGS,
} from '@/lib/hr/hr-approval-settings';

describe('parseHrApprovalSettings', () => {
  it('returns defaults for invalid input', () => {
    expect(parseHrApprovalSettings(null)).toEqual(DEFAULT_HR_APPROVAL_SETTINGS);
  });

  it('parses manager modes', () => {
    expect(
      parseHrApprovalSettings({
        leave_mode: 'manager_direct_reports',
        expense_mode: 'manager_only',
        allow_hr_override: false,
      })
    ).toEqual({
      leave_mode: 'manager_direct_reports',
      expense_mode: 'manager_only',
      allow_hr_override: false,
    });
  });
});

describe('buildOrgChartTree', () => {
  const employees: OrgChartEmployee[] = [
    {
      id: 'ceo',
      employee_code: 'E001',
      name: 'CEO',
      designation: 'CEO',
      department: 'Exec',
      reporting_manager_id: null,
      is_active: true,
    },
    {
      id: 'mgr',
      employee_code: 'E002',
      name: 'Manager',
      designation: 'Mgr',
      department: 'Sales',
      reporting_manager_id: 'ceo',
      is_active: true,
    },
    {
      id: 'rep',
      employee_code: 'E003',
      name: 'Rep',
      designation: null,
      department: 'Sales',
      reporting_manager_id: 'mgr',
      is_active: true,
    },
  ];

  it('builds nested tree from reporting_manager_id', () => {
    const tree = buildOrgChartTree(employees);
    expect(tree.roots).toHaveLength(1);
    expect(tree.roots[0].id).toBe('ceo');
    expect(tree.roots[0].children[0].id).toBe('mgr');
    expect(tree.roots[0].children[0].children[0].id).toBe('rep');
    expect(tree.cycleIds).toHaveLength(0);
  });

  it('detects cycles', () => {
    const cyclic: OrgChartEmployee[] = [
      { ...employees[0], reporting_manager_id: 'mgr' },
      { ...employees[1], reporting_manager_id: 'ceo' },
    ];
    const tree = buildOrgChartTree(cyclic);
    expect(tree.cycleIds.length).toBeGreaterThan(0);
  });
});
