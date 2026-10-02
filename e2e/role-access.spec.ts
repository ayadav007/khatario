import fs from 'fs';
import path from 'path';
import { test, expect, type APIRequestContext, type Browser, type Page } from '@playwright/test';

/**
 * Role access on staging: the primary admin creates one user per preset role (Sales,
 * Accountant, Inventory Manager) and one user on a custom "invoices view only" role, then
 * each user is checked against the sidebar, the "New" quick links, page guards, and
 * /api/authorization/preview. Test users are deleted at the end.
 *
 * Requires a saved primary-admin Playwright storageState (never commit it):
 *   %TEMP%\khatario-qa\role-access-admin.json, or STAGING_ADMIN_STATE.
 *
 * Login is rate limited (5 per IP per 15 minutes), so personas log in once through the API
 * and everything runs in a single test.
 *
 * Run:
 *   PLAYWRIGHT_BASE_URL=https://staging.khatario.com PLAYWRIGHT_SKIP_WEBSERVER=1 \
 *     npx playwright test e2e/role-access.spec.ts --workers=1
 */

const ADMIN_STATE =
  process.env.STAGING_ADMIN_STATE ||
  path.join(process.env.TEMP || process.env.TMP || '/tmp', 'khatario-qa', 'role-access-admin.json');

const ROLE_PASSWORD = process.env.E2E_ROLE_PASSWORD || 'RoleCheck!2026';
const RUN_ID = process.env.ROLE_RUN_ID || String(Date.now()).slice(-7);

type PersonaKey = 'sales' | 'accountant' | 'inventory' | 'invoice_viewer';
type Action = 'read' | 'create' | 'update' | 'delete' | 'export';

type Expectation = {
  menuShow: string[];
  menuHide: string[];
  newLinksShow: string[];
  newLinksHide: string[];
  pages: { path: string; allowed: boolean }[];
  api: { resource: string; action: Action; allowed: boolean }[];
};

type Persona = {
  key: PersonaKey;
  name: string;
  phone: string;
  roleKey?: string;
  customRole?: { name: string; grants: string[] };
  expect: Expectation;
};

const personas: Persona[] = [
  {
    key: 'sales',
    name: `QA Sales ${RUN_ID}`,
    phone: `901${RUN_ID}`,
    roleKey: 'sales',
    expect: {
      menuShow: ['All Invoices', 'Customers'],
      menuHide: ['All Purchases', 'Suppliers', 'Overview', 'Settings'],
      newLinksShow: ['/invoices/new', '/customers/new'],
      newLinksHide: ['/purchases/new', '/items/new', '/suppliers/new'],
      pages: [
        { path: '/invoices', allowed: true },
        { path: '/purchases', allowed: false },
        { path: '/reports', allowed: false },
        { path: '/settings/users', allowed: false },
      ],
      api: [
        { resource: 'invoices', action: 'read', allowed: true },
        { resource: 'invoices', action: 'create', allowed: true },
        { resource: 'purchases', action: 'read', allowed: false },
        { resource: 'reports', action: 'read', allowed: false },
        { resource: 'settings', action: 'read', allowed: false },
        { resource: 'items', action: 'create', allowed: false },
      ],
    },
  },
  {
    key: 'accountant',
    name: `QA Accountant ${RUN_ID}`,
    phone: `902${RUN_ID}`,
    roleKey: 'accountant',
    expect: {
      menuShow: ['All Invoices', 'All Purchases', 'Overview'],
      menuHide: ['Settings'],
      newLinksShow: [],
      newLinksHide: ['/invoices/new', '/purchases/new', '/items/new'],
      pages: [
        { path: '/invoices', allowed: true },
        { path: '/invoices/new', allowed: false },
        { path: '/purchases', allowed: true },
        { path: '/settings/users', allowed: false },
      ],
      api: [
        { resource: 'invoices', action: 'read', allowed: true },
        { resource: 'invoices', action: 'create', allowed: false },
        { resource: 'purchases', action: 'read', allowed: true },
        { resource: 'purchases', action: 'create', allowed: false },
        { resource: 'reports', action: 'read', allowed: true },
        { resource: 'settings', action: 'create', allowed: false },
        { resource: 'items', action: 'delete', allowed: false },
      ],
    },
  },
  {
    key: 'inventory',
    name: `QA Inventory ${RUN_ID}`,
    phone: `903${RUN_ID}`,
    roleKey: 'inventory_manager',
    expect: {
      menuShow: ['All Purchases', 'Items'],
      menuHide: ['All Invoices', 'Customers', 'Settings'],
      newLinksShow: ['/purchases/new', '/items/new'],
      newLinksHide: ['/invoices/new', '/customers/new'],
      pages: [
        { path: '/purchases', allowed: true },
        { path: '/purchases/new', allowed: true },
        { path: '/items', allowed: true },
        { path: '/invoices', allowed: false },
        { path: '/customers', allowed: false },
      ],
      api: [
        { resource: 'purchases', action: 'read', allowed: true },
        { resource: 'purchases', action: 'create', allowed: true },
        { resource: 'items', action: 'create', allowed: true },
        { resource: 'items', action: 'update', allowed: true },
        { resource: 'items', action: 'delete', allowed: true },
        { resource: 'invoices', action: 'read', allowed: false },
        { resource: 'payments', action: 'read', allowed: false },
        { resource: 'settings', action: 'read', allowed: false },
      ],
    },
  },
  {
    key: 'invoice_viewer',
    name: `QA Invoice Viewer ${RUN_ID}`,
    phone: `904${RUN_ID}`,
    customRole: { name: `QA Invoice Viewer Role ${RUN_ID}`, grants: ['invoices_read'] },
    expect: {
      menuShow: ['All Invoices'],
      menuHide: [
        'All Purchases',
        'Suppliers',
        'Customers',
        'Items',
        'Credit Notes',
        'Debit Notes',
        'Warehouses',
        'Overview',
        'Settings',
      ],
      newLinksShow: [],
      newLinksHide: ['/invoices/new', '/purchases/new', '/credit-notes/new', '/customers/new'],
      pages: [
        { path: '/invoices', allowed: true },
        { path: '/invoices/new', allowed: false },
        { path: '/purchases', allowed: false },
        { path: '/items', allowed: false },
        { path: '/customers', allowed: false },
        { path: '/reports', allowed: false },
        { path: '/settings/users', allowed: false },
      ],
      api: [
        { resource: 'invoices', action: 'read', allowed: true },
        { resource: 'invoices', action: 'create', allowed: false },
        { resource: 'invoices', action: 'update', allowed: false },
        { resource: 'invoices', action: 'delete', allowed: false },
        { resource: 'invoices', action: 'export', allowed: false },
        { resource: 'purchases', action: 'read', allowed: false },
        { resource: 'customers', action: 'read', allowed: false },
        { resource: 'items', action: 'read', allowed: false },
        { resource: 'payments', action: 'read', allowed: false },
        { resource: 'reports', action: 'read', allowed: false },
        { resource: 'settings', action: 'read', allowed: false },
      ],
    },
  },
];

const DENIED_TEXT = /access denied|is restricted/i;
const NAV_SECTIONS = ['Sales', 'Purchases', 'Inventory', 'Accounting', 'Reports', 'More'];

type AdminInfo = { userId: string; businessId: string };

async function json(res: Awaited<ReturnType<APIRequestContext['get']>>) {
  return res.json().catch(() => ({}));
}

async function adminInfo(api: APIRequestContext): Promise<AdminInfo> {
  const res = await api.get('/api/auth/session');
  expect(res.ok(), 'admin session expired; save a new storageState').toBeTruthy();
  const body = await json(res);
  return { userId: body.user?.id, businessId: body.business?.id ?? body.user?.business_id };
}

async function enableUserManagement(api: APIRequestContext, admin: AdminInfo) {
  const current = await json(await api.get(`/api/settings/user-management?business_id=${admin.businessId}`));
  if (current.settings?.user_management_enabled) return;
  const res = await api.patch('/api/settings/user-management', {
    data: { business_id: admin.businessId, user_management_enabled: true, updated_by_user_id: admin.userId },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
}

async function resolveRoleId(api: APIRequestContext, admin: AdminInfo, persona: Persona): Promise<string> {
  const roles = (await json(await api.get(`/api/settings/roles?business_id=${admin.businessId}&user_id=${admin.userId}`)))
    .roles as Array<{ id: string; role_key: string; role_name: string }>;
  if (persona.roleKey) {
    const role = roles.find((r) => r.role_key === persona.roleKey);
    expect(role, `role ${persona.roleKey} missing on business`).toBeTruthy();
    return role!.id;
  }
  const custom = persona.customRole!;
  const existing = roles.find((r) => r.role_name === custom.name);
  let roleId = existing?.id;
  if (!roleId) {
    // business_id / user_id are ignored by current code; older deployments still require them.
    const created = await api.post('/api/settings/roles', {
      data: {
        business_id: admin.businessId,
        user_id: admin.userId,
        role_name: custom.name,
        description: 'E2E custom role',
        permissions: [],
      },
    });
    expect(created.ok(), await created.text()).toBeTruthy();
    roleId = (await json(created)).role.id as string;
  }
  const saved = await api.post(`/api/roles/${roleId}/permissions`, {
    data: { permissions: custom.grants.map((permission_id) => ({ permission_id, granted: true })) },
  });
  expect(saved.ok(), await saved.text()).toBeTruthy();
  const granted = ((await json(await api.get(`/api/settings/roles/${roleId}/permissions`))).permissions as Array<{
    permission_id: string;
    granted: boolean;
  }>)
    .filter((p) => p.granted)
    .map((p) => p.permission_id);
  expect(granted.sort()).toEqual([...custom.grants].sort());
  return roleId;
}

async function createUser(api: APIRequestContext, admin: AdminInfo, persona: Persona, roleId: string): Promise<string> {
  const res = await api.post('/api/settings/users', {
    data: {
      business_id: admin.businessId,
      created_by_user_id: admin.userId,
      name: persona.name,
      phone: persona.phone,
      password: ROLE_PASSWORD,
      role_id: roleId,
    },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await json(res)).user.id as string;
}

async function loginPersona(browser: Browser, persona: Persona) {
  const context = await browser.newContext();
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await context.request.post('/api/auth/login', {
      data: { phone: persona.phone, password: ROLE_PASSWORD },
    });
    if (res.ok()) return context;
    const body = await json(res);
    if (res.status() !== 429) throw new Error(`login ${persona.key}: ${res.status()} ${JSON.stringify(body)}`);
    await new Promise((r) => setTimeout(r, Math.min(Number(body.retryAfterMs) || 60000, 240000) + 1000));
  }
  throw new Error(`login ${persona.key}: still rate limited`);
}

async function dismissTour(page: Page) {
  const close = page.getByRole('button', { name: /close welcome/i });
  if (await close.isVisible().catch(() => false)) await close.click();
}

/** Opens each collapsed top-level section once; never clicks an open section. */
async function expandNav(page: Page) {
  const nav = page.locator('nav').first();
  for (const label of NAV_SECTIONS) {
    const link = nav.locator('a').filter({ hasText: new RegExp(`^\\s*${label}\\s*$`) }).first();
    if (!(await link.count())) continue;
    const item = link.locator('xpath=ancestor::li[1]');
    if (await item.locator('ul').count()) continue;
    await link.click({ force: true });
    await expect(item.locator('ul').first()).toBeAttached({ timeout: 3000 }).catch(() => {});
  }
}

async function navSnapshot(page: Page): Promise<{ labels: string[]; hrefs: string[] }> {
  return page.locator('nav').first().evaluate((nav) => {
    const links = [...nav.querySelectorAll('a')];
    return {
      labels: links.map((a) => (a.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean),
      hrefs: links.map((a) => a.getAttribute('href') || '').filter(Boolean),
    };
  });
}

async function preview(api: APIRequestContext, resource: string, action: string) {
  const res = await api.get(
    `/api/authorization/preview?resource=${encodeURIComponent(resource)}&action=${encodeURIComponent(action)}`
  );
  const body = await json(res);
  return { allowed: body.allowed === true, code: body.code as string | undefined };
}

test.describe.configure({ mode: 'serial' });

test('role access matches role permissions for preset and custom roles', async ({ browser }) => {
  test.skip(!fs.existsSync(ADMIN_STATE), `Admin session missing at ${ADMIN_STATE}`);
  test.setTimeout(20 * 60 * 1000);

  const adminContext = await browser.newContext({ storageState: ADMIN_STATE });
  const adminApi = adminContext.request;
  const admin = await adminInfo(adminApi);
  const createdUserIds: string[] = [];

  try {
    await enableUserManagement(adminApi, admin);

    for (const persona of personas) {
      await test.step(persona.key, async () => {
        const roleId = await resolveRoleId(adminApi, admin, persona);
        createdUserIds.push(await createUser(adminApi, admin, persona, roleId));

        const context = await loginPersona(browser, persona);
        const page = await context.newPage();
        try {
          await page.goto('/dashboard');
          await dismissTour(page);
          await expect(page.locator('nav').first().getByRole('link', { name: 'Dashboard', exact: true })).toBeVisible({
            timeout: 30000,
          });
          await expandNav(page);
          const nav = await navSnapshot(page);
          const where = `${persona.key} nav: ${nav.labels.join(', ')}`;

          for (const label of persona.expect.menuShow) {
            expect.soft(nav.labels, `${where} — should show ${label}`).toContain(label);
          }
          for (const label of persona.expect.menuHide) {
            expect.soft(nav.labels, `${where} — should hide ${label}`).not.toContain(label);
          }
          for (const href of persona.expect.newLinksShow) {
            expect.soft(nav.hrefs, `${persona.key} — New link ${href} should show`).toContain(href);
          }
          for (const href of persona.expect.newLinksHide) {
            expect.soft(nav.hrefs, `${persona.key} — New link ${href} should be hidden`).not.toContain(href);
          }

          for (const entry of persona.expect.pages) {
            await page.goto(entry.path);
            const denied = page.getByText(DENIED_TEXT).first();
            if (entry.allowed) {
              await page.waitForTimeout(3000);
              expect.soft(await denied.isVisible().catch(() => false), `${persona.key} ${entry.path} should open`).toBe(false);
            } else {
              await expect.soft(denied, `${persona.key} ${entry.path} should be blocked`).toBeVisible({ timeout: 10000 });
            }
          }

          for (const check of persona.expect.api) {
            const result = await preview(context.request, check.resource, check.action);
            expect
              .soft(result.allowed, `${persona.key} api ${check.resource}.${check.action} (${result.code ?? 'ok'})`)
              .toBe(check.allowed);
          }
        } finally {
          await context.close();
        }
      });
    }
  } finally {
    for (const id of createdUserIds) {
      await adminApi.delete(`/api/settings/users/${id}?deleted_by_user_id=${admin.userId}`);
    }
    await adminContext.close();
  }
});
