/**
 * Connect has its own WhatsApp agent seats (never Billing users), and role permissions gate WhatsApp APIs.
 */
jest.mock('@/lib/db', () => ({ queryOne: jest.fn(), queryRows: jest.fn(), query: jest.fn() }));
jest.mock('@/lib/permissions', () => ({ checkUserPermission: jest.fn() }));
jest.mock('@/lib/subscription', () => ({
  hasWhatsAppBotAddon: jest.fn(),
  hasWhatsAppSendMessageAddon: jest.fn(),
}));
jest.mock('@/lib/business-modules', () => ({ getBusinessPlatformContext: jest.fn() }));
jest.mock('@/lib/subscription/module-subscriptions', () => ({
  getEntitlementPlanIdForModuleSub: jest.fn(),
  getOperationalModuleSubscriptions: jest.fn(),
}));

import * as db from '@/lib/db';
import { checkUserPermission } from '@/lib/permissions';
import { seatSourceSubs } from '@/lib/subscription/resolve-limit';
import type { ModuleSubscriptionRow } from '@/lib/subscription/module-subscriptions';
import { connectSeatsLabel } from '@/lib/subscription/billing-labels';
import {
  assertNotConnectAgentWrite,
  assertWhatsAppInboxPermission,
  assertWhatsAppManagePermission,
  inboxActionForMethod,
} from '@/lib/security/whatsapp-api-gates';
import { getLimitOwnerModule } from '@/lib/subscription/module-entitlements';
import {
  connectSeatViolations,
  ensureWhatsAppAgentRole,
  isSeatType,
  seatLimitMessage,
  seatLimitType,
  WHATSAPP_AGENT_PERMISSIONS,
} from '@/lib/users/connect-seats';
import { isRbacModuleVisibleForPlatform } from '@/lib/rbac-permission-catalog';
import { resolvePermissionModuleKeys } from '@/lib/capability-normalizer';

const sub = (module_key: string, plan_id: string) =>
  ({ module_key, plan_id, business_id: 'b1', status: 'active' }) as unknown as ModuleSubscriptionRow;

describe('seatSourceSubs', () => {
  const billingFree = sub('billing', 'free');
  const connect = sub('connect', 'connect');
  const hr = sub('hr', 'hr_free');

  it('ignores Connect seats for users when Billing is active', () => {
    expect(seatSourceSubs('users', [billingFree, connect])).toEqual([billingFree]);
  });

  it('keeps HR alongside Billing for users', () => {
    expect(seatSourceSubs('users', [billingFree, connect, hr])).toEqual([billingFree, hr]);
  });

  it('never counts Connect toward Billing users, even without Billing', () => {
    expect(seatSourceSubs('users', [connect])).toEqual([]);
    expect(seatSourceSubs('users', [connect, hr])).toEqual([hr]);
  });

  it('leaves other account-wide limits on the highest plan', () => {
    expect(seatSourceSubs('whatsapp', [billingFree, connect])).toEqual([billingFree, connect]);
  });
});

describe('connectSeatsLabel', () => {
  it('describes Connect seats as its own WhatsApp agent pool', () => {
    expect(connectSeatsLabel(5)).toBe('Up to 5 WhatsApp agents');
    expect(connectSeatsLabel(1)).toBe('1 WhatsApp agent');
    expect(connectSeatsLabel(-1)).toBe('Unlimited WhatsApp agents');
    expect(connectSeatsLabel(null)).toBe('WhatsApp agents not included');
  });
});

describe('Connect agent seats', () => {
  it('maps each seat to its own limit pool', () => {
    expect(seatLimitType('billing')).toBe('users');
    expect(seatLimitType('connect')).toBe('connect_agents');
    expect(isSeatType('connect')).toBe(true);
    expect(isSeatType('admin')).toBe(false);
  });

  it('owns connect_agents under the Connect module', () => {
    expect(getLimitOwnerModule('connect_agents')).toBe('connect');
  });

  it('explains which pool is full', () => {
    expect(seatLimitMessage('connect', { current: 5, limit: 5 })).toMatch(/all 5 WhatsApp agent seats/);
    expect(seatLimitMessage('billing', { current: 1, limit: 1 })).toMatch(/all 1 user seat on your plan/);
    expect(seatLimitMessage('billing', { current: 1, limit: 0 })).toMatch(/no Billing user seats/);
  });

  it('accepts the default WhatsApp Agent role', () => {
    expect(connectSeatViolations(Object.entries(WHATSAPP_AGENT_PERMISSIONS))).toEqual([]);
  });

  it('flags anything beyond chats and view-only records', () => {
    expect(
      connectSeatViolations([
        ['invoices', { can_view: true, can_add: true }],
        ['purchases', { can_view: true }],
        ['customers', { can_view: true }],
        ['whatsapp', { can_view: true }],
      ]),
    ).toEqual(['invoices_create', 'purchases_read', 'whatsapp_read']);
  });

  it('clamps an existing WhatsApp Agent role that was widened', async () => {
    const calls: Array<[string, unknown[] | undefined]> = [];
    const q = {
      query: jest.fn(async (text: string, params?: unknown[]) => {
        calls.push([text, params]);
        if (text.includes('FROM user_roles')) return { rows: [{ id: 'r1', is_active: true }] };
        if (text.includes('FROM role_permissions')) {
          return {
            rows: [
              { module_key: 'invoices', can_view: true, can_add: true, can_modify: false, can_delete: false, can_share: false },
              { module_key: 'customers', can_view: true, can_add: false, can_modify: false, can_delete: false, can_share: false },
            ],
          };
        }
        return { rows: [] };
      }),
    };
    await expect(ensureWhatsAppAgentRole(q, 'b1')).resolves.toBe('r1');
    const updates = calls.filter(([t]) => t.includes('UPDATE role_permissions'));
    expect(updates).toHaveLength(1);
    expect(updates[0][1]).toEqual(['r1', 'invoices', true, false, false, false, false]);
  });
});

describe('WhatsApp Chats permission', () => {
  const queryOne = db.queryOne as jest.Mock;
  const checkPerm = checkUserPermission as jest.Mock;
  const ctx = (method: string) =>
    ({ request: new Request('http://localhost/api/whatsapp/conversations', { method }), userId: 'u1' }) as never;

  beforeEach(() => {
    queryOne.mockReset();
    checkPerm.mockReset();
  });

  it('maps HTTP methods to role actions', () => {
    expect(inboxActionForMethod('GET')).toBe('read');
    expect(inboxActionForMethod('POST')).toBe('create');
    expect(inboxActionForMethod('PATCH')).toBe('update');
    expect(inboxActionForMethod('PUT')).toBe('update');
    expect(inboxActionForMethod('DELETE')).toBe('delete');
  });

  it('lets the primary admin through without a role lookup', async () => {
    queryOne.mockResolvedValue({ is_primary_admin: true });
    await expect(assertWhatsAppInboxPermission(ctx('GET'))).resolves.toBeNull();
    expect(checkPerm).not.toHaveBeenCalled();
  });

  it('allows staff whose role grants the action', async () => {
    queryOne.mockResolvedValue({ is_primary_admin: false });
    checkPerm.mockResolvedValue(true);
    await expect(assertWhatsAppInboxPermission(ctx('POST'))).resolves.toBeNull();
    expect(checkPerm).toHaveBeenCalledWith('u1', 'whatsapp_inbox', 'create');
  });

  it('returns 403 when the role lacks the permission', async () => {
    queryOne.mockResolvedValue({ is_primary_admin: false });
    checkPerm.mockResolvedValue(false);
    const res = await assertWhatsAppInboxPermission(ctx('GET'));
    expect(res?.status).toBe(403);
    await expect(res?.json()).resolves.toMatchObject({ code: 'PERMISSION_DENIED', module: 'whatsapp_inbox', action: 'read' });
  });

  it('uses an explicit action override for exports', async () => {
    queryOne.mockResolvedValue({ is_primary_admin: false });
    checkPerm.mockResolvedValue(true);
    await assertWhatsAppInboxPermission(ctx('POST'), 'export');
    expect(checkPerm).toHaveBeenCalledWith('u1', 'whatsapp_inbox', 'export');
  });

  it('gates setup and campaigns on the "whatsapp" module', async () => {
    queryOne.mockResolvedValue({ is_primary_admin: false });
    checkPerm.mockResolvedValue(false);
    const res = await assertWhatsAppManagePermission(ctx('DELETE'));
    expect(checkPerm).toHaveBeenCalledWith('u1', 'whatsapp', 'delete');
    await expect(res?.json()).resolves.toMatchObject({ code: 'PERMISSION_DENIED', module: 'whatsapp' });
  });

  it('blocks Connect agents from QR, disconnect and reminder writes but not reads', async () => {
    queryOne.mockResolvedValue({ seat_type: 'connect' });
    expect((await assertNotConnectAgentWrite(ctx('POST')))?.status).toBe(403);
    await expect(assertNotConnectAgentWrite(ctx('GET'))).resolves.toBeNull();
    queryOne.mockResolvedValue({ seat_type: 'billing' });
    await expect(assertNotConnectAgentWrite(ctx('POST'))).resolves.toBeNull();
  });

  it('shows in the roles editor only for Connect accounts and resolves on the client', () => {
    expect(isRbacModuleVisibleForPlatform('whatsapp_inbox', ['billing', 'connect'])).toBe(true);
    expect(isRbacModuleVisibleForPlatform('whatsapp_inbox', ['billing'])).toBe(false);
    expect(resolvePermissionModuleKeys('whatsapp_inbox')).toContain('whatsapp_inbox');
  });
});
