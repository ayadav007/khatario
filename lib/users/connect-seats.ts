/**
 * Two seat pools: Billing/HR users count against those plans' max_users, Connect agents against
 * the Connect plan's max_users. A Connect agent only answers WhatsApp chats and looks up customers,
 * items, invoices and orders; the role they hold may never grant more than that, so a cheap agent
 * seat cannot stand in for a Billing user.
 */

export type SeatType = 'billing' | 'connect';

export function isSeatType(value: unknown): value is SeatType {
  return value === 'billing' || value === 'connect';
}

export function seatLimitType(seat: SeatType): 'users' | 'connect_agents' {
  return seat === 'connect' ? 'connect_agents' : 'users';
}

export function seatLimitMessage(
  seat: SeatType,
  check: { current: number; limit: number; message?: string },
): string {
  if (check.limit <= 0) {
    return seat === 'connect'
      ? check.message || 'Your Connect plan does not include WhatsApp agents.'
      : 'Your plan has no Billing user seats. Add WhatsApp agents from Settings → WhatsApp → Agents instead, or add Billing.';
  }
  return seat === 'connect'
    ? `You've used all ${check.limit} WhatsApp agent seat${check.limit === 1 ? '' : 's'} on Connect (${check.current}/${check.limit}). Deactivate an agent or upgrade Connect.`
    : `You've used all ${check.limit} user seat${check.limit === 1 ? '' : 's'} on your plan (${check.current}/${check.limit}). Upgrade your plan, or add WhatsApp-only staff as Connect agents.`;
}

export const WHATSAPP_AGENT_ROLE_KEY = 'whatsapp_agent';
export const WHATSAPP_AGENT_ROLE_NAME = 'WhatsApp Agent';
export const CONNECT_AGENT_HOME_PATH = '/whatsapp/conversations';
export const CONNECT_SEAT_PAUSED_MESSAGE =
  "Your WhatsApp agent login is paused because this business's Connect plan is not active. Ask the owner to renew Connect.";

/** Whether this session user is a WhatsApp/Connect agent seat. */
export function isConnectAgentSeat(user: { seat_type?: string | null } | null | undefined): boolean {
  return user?.seat_type === 'connect';
}

/**
 * Agents always land in Conversations — never the billing or Connect owner dashboard.
 * Use when hydrating cached platformSession or choosing a client-side redirect target.
 */
export function resolveHomePathForUser(
  platform: { defaultHomePath?: string | null } | null | undefined,
  user: { seat_type?: string | null } | null | undefined,
): string {
  if (isConnectAgentSeat(user)) return CONNECT_AGENT_HOME_PATH;
  return platform?.defaultHomePath || '/dashboard';
}

/** Force Connect-agent home onto a platform session object (cache / offline). */
export function withConnectAgentHomePath<T extends { defaultHomePath: string }>(
  platform: T,
  user: { seat_type?: string | null } | null | undefined,
): T {
  if (!isConnectAgentSeat(user)) return platform;
  if (platform.defaultHomePath === CONNECT_AGENT_HOME_PATH) return platform;
  return { ...platform, defaultHomePath: CONNECT_AGENT_HOME_PATH };
}

export type SeatPermissionFlags = {
  can_view: boolean;
  can_add: boolean;
  can_modify: boolean;
  can_delete: boolean;
  can_share: boolean;
};

const FLAG_ACTIONS: Array<[keyof SeatPermissionFlags, string]> = [
  ['can_view', 'read'],
  ['can_add', 'create'],
  ['can_modify', 'update'],
  ['can_delete', 'delete'],
  ['can_share', 'export'],
];

const flags = (on: Partial<SeatPermissionFlags>): SeatPermissionFlags => ({
  can_view: false,
  can_add: false,
  can_modify: false,
  can_delete: false,
  can_share: false,
  ...on,
});

const VIEW_ONLY = flags({ can_view: true });

/** The WhatsApp Agent role: reply, label and note chats; view customers, items, invoices and orders. */
export const WHATSAPP_AGENT_PERMISSIONS: Record<string, SeatPermissionFlags> = {
  whatsapp_inbox: flags({ can_view: true, can_add: true, can_modify: true }),
  customers: VIEW_ONLY,
  items: VIEW_ONLY,
  invoices: VIEW_ONLY,
  sales_orders: VIEW_ONLY,
};

/** The most any role held by a Connect agent may grant. */
export const CONNECT_SEAT_MAX_PERMISSIONS: Record<string, SeatPermissionFlags> = {
  whatsapp_inbox: flags({ can_view: true, can_add: true, can_modify: true, can_delete: true, can_share: true }),
  whatsapp_inbox_supervise: VIEW_ONLY,
  customers: VIEW_ONLY,
  items: VIEW_ONLY,
  invoices: VIEW_ONLY,
  sales_orders: VIEW_ONLY,
};

/** `module_action` entries a role grants beyond what a Connect agent may hold. */
export function connectSeatViolations(
  perms: Iterable<[string, Partial<SeatPermissionFlags>]>,
): string[] {
  const out: string[] = [];
  for (const [moduleKey, granted] of perms) {
    const max = CONNECT_SEAT_MAX_PERMISSIONS[moduleKey];
    for (const [flag, action] of FLAG_ACTIONS) {
      if (granted[flag] === true && !max?.[flag]) out.push(`${moduleKey}_${action}`);
    }
  }
  return out.sort();
}

type Queryable = { query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }> };

export type ConnectSeatRoleCheck =
  | { ok: true }
  | { ok: false; reason: 'ROLE_NOT_FOUND' | 'PRIMARY_ADMIN_ROLE' | 'EXCEEDS_CONNECT_SEAT'; violations: string[] };

/** Whether an active role in this business may be held by a Connect agent. */
export async function checkRoleForConnectSeat(
  q: Queryable,
  roleId: string,
  businessId: string,
): Promise<ConnectSeatRoleCheck> {
  const role = (
    await q.query(
      `SELECT id, role_key FROM user_roles WHERE id = $1 AND business_id = $2 AND COALESCE(is_active, true) = true`,
      [roleId, businessId],
    )
  ).rows[0] as { id: string; role_key: string } | undefined;
  if (!role) return { ok: false, reason: 'ROLE_NOT_FOUND', violations: [] };
  if (role.role_key === 'primary_admin') return { ok: false, reason: 'PRIMARY_ADMIN_ROLE', violations: [] };

  const rows = (
    await q.query(
      `SELECT module_key, can_view, can_add, can_modify, can_delete, can_share
         FROM role_permissions WHERE role_id = $1`,
      [roleId],
    )
  ).rows as Array<{ module_key: string } & SeatPermissionFlags>;
  const violations = connectSeatViolations(rows.map((r) => [r.module_key, r]));
  return violations.length ? { ok: false, reason: 'EXCEEDS_CONNECT_SEAT', violations } : { ok: true };
}

export function connectSeatRoleMessage(check: Exclude<ConnectSeatRoleCheck, { ok: true }>): string {
  if (check.reason === 'ROLE_NOT_FOUND') return 'Invalid role for this business';
  if (check.reason === 'PRIMARY_ADMIN_ROLE') return 'A WhatsApp agent cannot be the primary admin';
  return 'WhatsApp agents can only answer chats and view customers, items, invoices and orders. Pick the WhatsApp Agent role or a role within those limits.';
}

/** The owner may have widened the role while no agent held it; strip anything a Connect seat may not hold. */
async function clampRoleToConnectSeat(q: Queryable, roleId: string): Promise<void> {
  const rows = (
    await q.query(
      `SELECT module_key, can_view, can_add, can_modify, can_delete, can_share
         FROM role_permissions WHERE role_id = $1`,
      [roleId],
    )
  ).rows as Array<{ module_key: string } & SeatPermissionFlags>;
  for (const row of rows) {
    if (!connectSeatViolations([[row.module_key, row]]).length) continue;
    const max = CONNECT_SEAT_MAX_PERMISSIONS[row.module_key];
    await q.query(
      `UPDATE role_permissions
          SET can_view = $3, can_add = $4, can_modify = $5, can_delete = $6, can_share = $7
        WHERE role_id = $1 AND module_key = $2`,
      [
        roleId,
        row.module_key,
        row.can_view === true && !!max?.can_view,
        row.can_add === true && !!max?.can_add,
        row.can_modify === true && !!max?.can_modify,
        row.can_delete === true && !!max?.can_delete,
        row.can_share === true && !!max?.can_share,
      ],
    );
  }
}

/** The business's WhatsApp Agent role, created (or reactivated) on first use. */
export async function ensureWhatsAppAgentRole(q: Queryable, businessId: string): Promise<string> {
  const existing = (
    await q.query(`SELECT id, is_active FROM user_roles WHERE business_id = $1 AND role_key = $2 LIMIT 1`, [
      businessId,
      WHATSAPP_AGENT_ROLE_KEY,
    ])
  ).rows[0] as { id: string; is_active: boolean | null } | undefined;
  if (existing) {
    if (existing.is_active === false) {
      await q.query(`UPDATE user_roles SET is_active = true WHERE id = $1`, [existing.id]);
    }
    await clampRoleToConnectSeat(q, existing.id);
    return existing.id;
  }

  const role = (
    await q.query(
      `INSERT INTO user_roles (business_id, role_name, role_key, description, is_system_role, is_active)
       VALUES ($1, $2, $3, $4, true, true)
       RETURNING id`,
      [
        businessId,
        WHATSAPP_AGENT_ROLE_NAME,
        WHATSAPP_AGENT_ROLE_KEY,
        'Answers WhatsApp chats; views customers, items, invoices and orders',
      ],
    )
  ).rows[0] as { id: string };

  for (const [moduleKey, f] of Object.entries(WHATSAPP_AGENT_PERMISSIONS)) {
    await q.query(
      `INSERT INTO role_permissions (role_id, module_key, can_view, can_add, can_modify, can_delete, can_share)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (role_id, module_key) DO NOTHING`,
      [role.id, moduleKey, f.can_view, f.can_add, f.can_modify, f.can_delete, f.can_share],
    );
  }
  return role.id;
}
