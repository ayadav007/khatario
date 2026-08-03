import { generateEmployeePortalTemporaryPassword } from '@/lib/employee-portal/invite-password';
import { validateEmployeePortalPassword } from '@/lib/employee-portal/password';

describe('employee portal invite', () => {
  it('generates a human-readable temporary password', () => {
    const password = generateEmployeePortalTemporaryPassword();
    expect(password).toMatch(/^[A-F0-9]{4}-[A-F0-9]{4}$/);
    expect(validateEmployeePortalPassword(password).ok).toBe(true);
  });

  it('always passes portal password policy', () => {
    for (let i = 0; i < 50; i++) {
      const password = generateEmployeePortalTemporaryPassword();
      expect(validateEmployeePortalPassword(password).ok).toBe(true);
    }
  });
});
