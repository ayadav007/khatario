import { resolveDepartmentHeadEmployeeId } from '@/lib/hr/department-head';
import type { OrgChartEmployee } from '@/lib/hr/org-chart';
import { parseHrExitSettings, validateExitApprovalChain } from '@/lib/hr/exit-settings';

describe('resolveDepartmentHeadEmployeeId', () => {
  const employees: OrgChartEmployee[] = [
    {
      id: 'head',
      employee_code: 'H1',
      name: 'Dept Head',
      designation: 'Director',
      department: 'Sales',
      reporting_manager_id: null,
      is_active: true,
    },
    {
      id: 'mgr',
      employee_code: 'M1',
      name: 'Manager',
      designation: 'Manager',
      department: 'Sales',
      reporting_manager_id: 'head',
      is_active: true,
    },
    {
      id: 'rep',
      employee_code: 'R1',
      name: 'Rep',
      designation: 'Executive',
      department: 'Sales',
      reporting_manager_id: 'mgr',
      is_active: true,
    },
    {
      id: 'eng',
      employee_code: 'E1',
      name: 'Engineer',
      designation: 'Dev',
      department: 'Engineering',
      reporting_manager_id: null,
      is_active: true,
    },
  ];

  it('picks highest person in department', () => {
    expect(resolveDepartmentHeadEmployeeId(employees, 'Sales')).toBe('head');
    expect(resolveDepartmentHeadEmployeeId(employees, 'Sales', 'head')).toBe('mgr');
  });

  it('returns null for unknown department', () => {
    expect(resolveDepartmentHeadEmployeeId(employees, 'HR')).toBeNull();
  });
});

describe('validateExitApprovalChain', () => {
  it('requires employee for specific_employee role', () => {
    const settings = parseHrExitSettings({
      exit_approval_chain: [{ level: 1, role_type: 'specific_employee' }],
    });
    expect(validateExitApprovalChain(settings)).toMatch(/select an employee/i);
  });

  it('accepts default chain', () => {
    expect(validateExitApprovalChain(parseHrExitSettings({}))).toBeNull();
  });
});
