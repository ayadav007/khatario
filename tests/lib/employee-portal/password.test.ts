import { validateEmployeePortalPassword } from '@/lib/employee-portal/password';

describe('validateEmployeePortalPassword', () => {
  it('accepts strong enough passwords', () => {
    expect(validateEmployeePortalPassword('A3F2-B8C1').ok).toBe(true);
    expect(validateEmployeePortalPassword('MyPass123').ok).toBe(true);
  });

  it('rejects short passwords', () => {
    const result = validateEmployeePortalPassword('Ab1');
    expect(result.ok).toBe(false);
  });

  it('requires letters and numbers', () => {
    expect(validateEmployeePortalPassword('allletters').ok).toBe(false);
    expect(validateEmployeePortalPassword('12345678').ok).toBe(false);
  });
});
