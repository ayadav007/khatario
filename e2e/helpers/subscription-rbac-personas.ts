import bcrypt from 'bcryptjs';
import type { APIRequestContext } from '@playwright/test';
import { withDbClient, deleteBusinessCascade } from './db';

export type RbacPersonaKind = 'owner' | 'admin' | 'employee' | 'readonly';

export type RbacPersona = {
  kind: RbacPersonaKind;
  userId: string;
  phone: string;
  password: string;
  businessId: string;
  label: string;
};

const PASSWORD = process.env.E2E_RBAC_PASSWORD || 'E2E_Rbac!2026';

function phoneFor(runId: number, kind: RbacPersonaKind): string {
  const suffix: Record<RbacPersonaKind, string> = {
    owner: '1',
    admin: '2',
    employee: '3',
    readonly: '4',
  };
  return `77${String(runId).slice(-8)}${suffix[kind]}`;
}

async function hashPassword(raw: string): Promise<string> {
  return bcrypt.hash(raw, 10);
}

export async function provisionRbacBusiness(
  request: APIRequestContext,
  baseUrl: string,
): Promise<{ owner: RbacPersona; personas: RbacPersona[]; cleanup: () => Promise<void> }> {
  const runId = Date.now();
  const ownerPhone = phoneFor(runId, 'owner');
  const label = `E2E RBAC ${runId}`;

  const signup = await request.post(`${baseUrl}/api/signup`, {
    data: {
      businessName: label,
      businessType: 'retail',
      industry: 'services',
      userName: 'Owner User',
      userPhone: ownerPhone,
      password: PASSWORD,
      productLine: 'billing',
    },
  });
  const signupBody = await signup.json().catch(() => ({}));
  if (!signup.ok()) {
    throw new Error(`RBAC signup failed: ${signup.status()} ${JSON.stringify(signupBody)}`);
  }

  const businessId = signupBody.businessId as string;
  const ownerUserId = signupBody.userId as string;

  const personas: RbacPersona[] = [
    {
      kind: 'owner',
      userId: ownerUserId,
      phone: ownerPhone,
      password: PASSWORD,
      businessId,
      label,
    },
  ];

  await withDbClient(async (c) => {
    const roles = await c.query<{ id: string; role_key: string }>(
      `SELECT id, role_key FROM user_roles WHERE business_id = $1`,
      [businessId],
    );
    const roleByKey = new Map(roles.rows.map((r) => [r.role_key, r.id]));
    const primaryAdminRoleId = roleByKey.get('primary_admin');
    const salesRoleId = roleByKey.get('sales');
    if (!primaryAdminRoleId || !salesRoleId) {
      throw new Error('Missing default roles for RBAC business');
    }

    const readonlyRole = await c.query<{ id: string }>(
      `INSERT INTO user_roles (business_id, role_name, role_key, description, is_system_role)
       VALUES ($1, 'Read Only', 'readonly_e2e', 'E2E read-only', false)
       RETURNING id`,
      [businessId],
    );
    const readonlyRoleId = readonlyRole.rows[0]?.id;
    if (!readonlyRoleId) throw new Error('Failed to create readonly role');

    await c.query(
      `INSERT INTO role_permissions (role_id, module_key, can_view, can_add, can_modify, can_delete, can_share)
       VALUES ($1, 'dashboard', true, false, false, false, false)`,
      [readonlyRoleId],
    );

    const pwHash = await hashPassword(PASSWORD);

    const extra: Array<{ kind: RbacPersonaKind; phone: string; name: string; roleId: string; isPrimary: boolean }> = [
      { kind: 'admin', phone: phoneFor(runId, 'admin'), name: 'Tenant Admin', roleId: primaryAdminRoleId, isPrimary: false },
      { kind: 'employee', phone: phoneFor(runId, 'employee'), name: 'Sales Employee', roleId: salesRoleId, isPrimary: false },
      { kind: 'readonly', phone: phoneFor(runId, 'readonly'), name: 'Read Only User', roleId: readonlyRoleId, isPrimary: false },
    ];

    for (const row of extra) {
      const ins = await c.query<{ id: string }>(
        `INSERT INTO users (business_id, name, phone, password_hash, role_id, is_primary_admin, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, true)
         RETURNING id`,
        [businessId, row.name, row.phone, pwHash, row.roleId, row.isPrimary],
      );
      const userId = ins.rows[0]?.id;
      if (!userId) throw new Error(`Failed to create ${row.kind} user`);
      personas.push({
        kind: row.kind,
        userId,
        phone: row.phone,
        password: PASSWORD,
        businessId,
        label,
      });
    }
  });

  return {
    owner: personas[0],
    personas,
    cleanup: async () => {
      await deleteBusinessCascade(businessId).catch(() => {});
    },
  };
}

export async function loginPersonaApi(
  api: APIRequestContext,
  baseUrl: string,
  persona: RbacPersona,
): Promise<void> {
  const res = await api.post(`${baseUrl}/api/auth/login`, {
    data: { phone: persona.phone, password: persona.password },
  });
  if (!res.ok()) {
    throw new Error(`Login ${persona.kind} failed: ${await res.text()}`);
  }
}
