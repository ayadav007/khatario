import { decideEmployeeLoginAssignment, roleVisibleForEmployeeAssignment } from '@/lib/hr/employee-login-assignment';

describe('employee login assignment', () => {
  it('keeps a person on attendance when no role is chosen', () => {
    expect(
      decideEmployeeLoginAssignment({
        roleId: null,
        roleKey: null,
        password: null,
        actorIsOwner: false,
        seatsAllowed: false,
        alreadyConsumesSeat: false,
      }),
    ).toEqual({ ok: true, mode: 'attendance' });
  });

  it('refuses a sign-in role when no user seats remain', () => {
    const decision = decideEmployeeLoginAssignment({
      roleId: 'role-sales',
      roleKey: 'sales',
      password: 'secret12',
      actorIsOwner: true,
      seatsAllowed: false,
      alreadyConsumesSeat: false,
    });
    expect(decision).toMatchObject({ ok: false, code: 'USER_SEAT_LIMIT' });
  });

  it('requires a password and blocks admin for a non-owner', () => {
    expect(
      decideEmployeeLoginAssignment({
        roleId: 'role-sales',
        roleKey: 'sales',
        password: '',
        actorIsOwner: true,
        seatsAllowed: true,
        alreadyConsumesSeat: false,
      }),
    ).toMatchObject({ ok: false, code: 'PASSWORD_REQUIRED' });

    expect(
      decideEmployeeLoginAssignment({
        roleId: 'role-admin',
        roleKey: 'admin',
        password: 'secret12',
        actorIsOwner: false,
        seatsAllowed: true,
        alreadyConsumesSeat: false,
      }),
    ).toMatchObject({ ok: false, code: 'ADMIN_ROLE_FORBIDDEN' });
  });

  it('allows a sign-in role when a seat and password are present', () => {
    expect(
      decideEmployeeLoginAssignment({
        roleId: 'role-sales',
        roleKey: 'sales',
        password: 'secret12',
        actorIsOwner: false,
        seatsAllowed: true,
        alreadyConsumesSeat: false,
      }),
    ).toEqual({ ok: true, mode: 'login', roleId: 'role-sales' });
  });

  it('hides admin and WhatsApp agent roles from a non-owner', () => {
    expect(roleVisibleForEmployeeAssignment('sales', false)).toBe(true);
    expect(roleVisibleForEmployeeAssignment('admin', false)).toBe(false);
    expect(roleVisibleForEmployeeAssignment('primary_admin', true)).toBe(true);
    expect(roleVisibleForEmployeeAssignment('whatsapp_agent', true)).toBe(false);
  });
});
