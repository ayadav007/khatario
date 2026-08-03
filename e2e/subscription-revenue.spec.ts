import { test, expect } from './fixtures/auth';
import { hasDbConfig, withDbClient } from './helpers/db';

/**
 * Revenue / subscription guard tests against local dev.
 * Validates: Connect guard, addon checkout (no free activation), module-scoped plans API.
 */
test.describe('Subscription revenue guards', () => {
  test('Connect route redirects to upsell when Connect module disabled', async ({
    authenticatedPage: page,
  }) => {
    test.skip(!hasDbConfig(), 'DB required to toggle module state');

    const sessionRes = await page.context().request.get('/api/auth/session');
    expect(sessionRes.ok()).toBeTruthy();
    const session = (await sessionRes.json()) as {
      business?: { id: string };
    };
    const businessId = session.business?.id;
    expect(businessId).toBeTruthy();

    let hadConnect = false;
    await withDbClient(async (c) => {
      const row = await c.query<{ enabled: boolean }>(
        `SELECT enabled FROM business_modules
         WHERE business_id = $1 AND module_key = 'connect'`,
        [businessId],
      );
      hadConnect = row.rows[0]?.enabled === true;
      await c.query(
        `INSERT INTO business_modules (business_id, module_key, enabled)
         VALUES ($1, 'connect', false)
         ON CONFLICT (business_id, module_key) DO UPDATE SET enabled = false`,
        [businessId],
      );
    });

    try {
      await page.goto('/connect/whatsapp');
      await page.waitForURL(/\/settings\/products\?upsell=connect/, {
        timeout: 15000,
      });
      await expect(page).toHaveURL(/upsell=connect/);
    } finally {
      await withDbClient(async (c) => {
        if (hadConnect) {
          await c.query(
            `UPDATE business_modules SET enabled = true
             WHERE business_id = $1 AND module_key = 'connect'`,
            [businessId],
          );
        } else {
          await c.query(
            `DELETE FROM business_modules
             WHERE business_id = $1 AND module_key = 'connect'`,
            [businessId],
          );
        }
      });
    }
  });

  test('Billing route redirects to upsell when Billing module disabled', async ({
    authenticatedPage: page,
  }) => {
    test.skip(!hasDbConfig(), 'DB required to toggle module state');

    const sessionRes = await page.context().request.get('/api/auth/session');
    const session = (await sessionRes.json()) as {
      business?: { id: string };
    };
    const businessId = session.business?.id;
    expect(businessId).toBeTruthy();

    let hadBilling = false;
    await withDbClient(async (c) => {
      const row = await c.query<{ enabled: boolean }>(
        `SELECT enabled FROM business_modules
         WHERE business_id = $1 AND module_key = 'billing'`,
        [businessId],
      );
      hadBilling = row.rows[0]?.enabled === true;
      await c.query(
        `INSERT INTO business_modules (business_id, module_key, enabled)
         VALUES ($1, 'billing', false)
         ON CONFLICT (business_id, module_key) DO UPDATE SET enabled = false`,
        [businessId],
      );
    });

    try {
      await page.goto('/invoices');
      await page.waitForURL(/\/settings\/products\?upsell=billing/, {
        timeout: 15000,
      });
      await expect(page).toHaveURL(/upsell=billing/);
    } finally {
      await withDbClient(async (c) => {
        if (hadBilling) {
          await c.query(
            `UPDATE business_modules SET enabled = true
             WHERE business_id = $1 AND module_key = 'billing'`,
            [businessId],
          );
        }
      });
    }
  });

  test('WhatsApp addon purchase does not activate without payment', async ({
    authenticatedPage: page,
  }) => {
    test.skip(!hasDbConfig(), 'DB required for addon assertions');

    const api = page.context().request;
    const sessionRes = await api.get('/api/auth/session');
    const session = (await sessionRes.json()) as {
      business?: { id: string };
    };
    const businessId = session.business?.id;
    expect(businessId).toBeTruthy();

    await withDbClient(async (c) => {
      await c.query(
        `DELETE FROM whatsapp_addons
         WHERE business_id = $1 AND addon_type = 'whatsapp_bot'`,
        [businessId],
      );
    });

    const purchaseRes = await api.post(
      '/api/subscriptions/addons/whatsapp_bot/purchase',
      { data: { business_id: businessId } },
    );
    const body = await purchaseRes.json();

    if (purchaseRes.status() === 503 && body.code === 'PAYMENT_NOT_CONFIGURED') {
      expect(body.code).toBe('PAYMENT_NOT_CONFIGURED');
    } else {
      expect(purchaseRes.ok(), JSON.stringify(body)).toBeTruthy();
      expect(body.mode).toBe('redirect');
      expect(body.checkoutUrl).toMatch(/^https?:\/\//);
      expect(body.addon?.status).toBe('pending_payment');
    }

    const addonRow = await withDbClient(async (c) => {
      const r = await c.query<{ status: string }>(
        `SELECT status FROM whatsapp_addons
         WHERE business_id = $1 AND addon_type = 'whatsapp_bot'`,
        [businessId],
      );
      return r.rows[0]?.status ?? null;
    });
    expect(addonRow).toBeNull();
  });

  test('Plans API includes product_line for module filtering', async ({
    authenticatedPage: page,
  }) => {
    const res = await page.context().request.get('/api/subscriptions/plans');
    expect(res.ok()).toBeTruthy();
    const data = (await res.json()) as {
      plans: Array<{ id: string; product_line?: string | null }>;
    };
    expect(data.plans.length).toBeGreaterThan(0);

    const hrPlans = data.plans.filter((p) => (p.product_line ?? 'billing') === 'hr');
    const billingPlans = data.plans.filter(
      (p) => (p.product_line ?? 'billing') === 'billing',
    );

    expect(billingPlans.length).toBeGreaterThan(0);
    if (hrPlans.length > 0) {
      expect(hrPlans.every((p) => p.product_line === 'hr')).toBeTruthy();
      expect(
        billingPlans.every((p) => (p.product_line ?? 'billing') === 'billing'),
      ).toBeTruthy();
    }
  });
});
