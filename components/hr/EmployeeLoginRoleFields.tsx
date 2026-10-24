'use client';

import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/Input';

type LoginRole = { id: string; role_key: string; role_name: string };

type LoginOptions = {
  canAssignLogin: boolean;
  seats: { current: number; limit: number };
  roles: LoginRole[];
};

export function EmployeeLoginRoleFields({
  roleId,
  password,
  onRoleId,
  onPassword,
  allowWhenSeatsFull,
}: {
  roleId: string;
  password: string;
  onRoleId: (roleId: string) => void;
  onPassword: (password: string) => void;
  /** Edit of someone who already signs in. They can change role without a free seat. */
  allowWhenSeatsFull?: boolean;
}) {
  const [options, setOptions] = useState<LoginOptions | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/employees/login-options')
      .then(async (res) => {
        if (!res.ok) return null;
        return (await res.json()) as LoginOptions;
      })
      .then((data) => {
        if (!cancelled) setOptions(data);
      })
      .catch(() => {
        if (!cancelled) setOptions(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!options) return null;

  const showRoles = options.canAssignLogin || Boolean(allowWhenSeatsFull && roleId);
  if (!showRoles) {
    const limitLabel =
      options.seats.limit === -1 ? '' : ` (${options.seats.current}/${options.seats.limit} logins in use)`;
    return (
      <p className="text-sm text-text-secondary md:col-span-2">
        This person is saved for attendance and salary only. A sign-in role needs a free user seat
        {limitLabel}.
      </p>
    );
  }

  return (
    <>
      <div className="md:col-span-2">
        <label className="mb-1 block text-sm font-medium text-text-secondary" htmlFor="employee-login-role">
          Sign-in role
        </label>
        <select
          id="employee-login-role"
          className="input w-full"
          value={roleId}
          onChange={(e) => onRoleId(e.target.value)}
        >
          <option value="">Attendance only</option>
          {options.roles.map((role) => (
            <option key={role.id} value={role.id}>
              {role.role_name}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-text-secondary">
          Attendance only does not use a login seat. A role lets them sign in with the permissions from Settings → Roles.
        </p>
      </div>
      {roleId ? (
        <Input
          label={allowWhenSeatsFull ? 'New password' : 'Password'}
          type="password"
          name="login_password"
          value={password}
          onChange={(e) => onPassword(e.target.value)}
          placeholder={allowWhenSeatsFull ? 'Leave blank to keep the current password' : 'At least 8 characters, with a letter and a number'}
          autoComplete="new-password"
        />
      ) : null}
    </>
  );
}
