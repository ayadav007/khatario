import { chooseMainLoginUser } from '@/lib/auth/login-account';

describe('chooseMainLoginUser', () => {
  const owner = { id: 'owner', is_primary_admin: true };
  const employee = { id: 'employee', is_primary_admin: false };
  const otherJob = { id: 'other', is_primary_admin: false };

  it('opens the only account whose password matched', () => {
    expect(chooseMainLoginUser([employee])).toEqual({ user: employee });
  });

  it('opens the owner when that password also matches an employee account', () => {
    expect(chooseMainLoginUser([employee, owner])).toEqual({ user: owner });
  });

  it('does not guess between two businesses this phone registered', () => {
    expect(chooseMainLoginUser([owner, { id: 'owner-2', is_primary_admin: true }])).toEqual({
      ambiguous: true,
    });
  });

  it('does not guess between two employee accounts with the same password', () => {
    expect(chooseMainLoginUser([employee, otherJob])).toEqual({ ambiguous: true });
  });

  it('returns null when nothing matched', () => {
    expect(chooseMainLoginUser([])).toBeNull();
  });
});
