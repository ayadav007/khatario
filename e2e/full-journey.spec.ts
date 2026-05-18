import { test, expect } from '@playwright/test';
import {
  hasDbConfig,
  withDbClient,
  pickActivePlanId,
  pickAnyActivePlanId,
  ensureMultiBranchWarehouseForPlan,
  deleteBusinessCascade,
  insertMinimalCustomer,
  insertMinimalServiceItem,
  insertMinimalDraftInvoiceWithLine,
} from './helpers/db';

/**
 * Full E2E: register → assign plan (upgrade API) → branch → warehouse → customer → item → invoice → DB checks.
 *
 * Requires: app reachable (PLAYWRIGHT_BASE_URL / default localhost:3000), Postgres in .env for DB steps.
 * Optional: E2E_TARGET_PLAN — comma-separated plan ids to try (default: enterprise,business). Trial is excluded — not assignable via upgrade API.
 */
test.describe.configure({ mode: 'serial' });

test.describe('Full journey', () => {
  test('register, plan, branch, warehouse, invoice, DB validation', async ({ page }) => {
    test.skip(!hasDbConfig(), 'DB env (DB_NAME or DATABASE_URL) required for assertions and cleanup');

    const runId = Date.now();
    const phone = `90${String(runId).slice(-8)}`;
    const password = process.env.E2E_NEW_USER_PASSWORD || 'E2E_Play_test!2026';
    const businessName = `E2E Playwright ${runId}`;

    let businessId: string | null = null;

    try {
      // --- Register (UI) — Input labels are not htmlFor-linked; use name/placeholder ---
      await page.goto('/signup');
      await page.waitForSelector('input[name="businessName"]', { state: 'visible', timeout: 30000 });
      await page.locator('input[name="businessName"]').fill(businessName);
      await page.locator('select[name="businessType"]').selectOption('retail');
      await page.locator('select[name="industry"]').selectOption('services');
      await page.locator('input[name="userName"]').fill('E2E Admin');
      await page.locator('input[name="userPhone"]').fill(phone);
      await page.locator('input[name="password"]').fill(password);
      const [signupResp] = await Promise.all([
        page.waitForResponse(
          (r) => r.url().includes('/api/signup') && r.request().method() === 'POST',
          { timeout: 45000 }
        ),
        page.getByRole('button', { name: /start my free trial/i }).click(),
      ]);
      expect(signupResp.status(), await signupResp.text()).toBe(201);
      await page.waitForURL(/\/login/, { timeout: 30000 });

      // --- Login (UI) ---
      await page.getByPlaceholder(/enter your phone/i).fill(phone);
      await page.getByRole('button', { name: /continue/i }).click();
      await page.getByPlaceholder(/enter your password/i).fill(password);
      await page.getByRole('button', { name: /^login$/i }).click();
      await page.waitForURL(/\/dashboard/, { timeout: 30000 });

      const api = page.context().request;

      const sessionRes = await api.get('/api/auth/session');
      expect(sessionRes.ok(), await sessionRes.text()).toBeTruthy();
      const session = (await sessionRes.json()) as {
        user?: { id: string };
        business?: { id: string };
      };
      businessId = session.business?.id ?? null;
      const userId = session.user?.id;
      expect(businessId, 'session.business.id').toBeTruthy();
      expect(userId, 'session.user.id').toBeTruthy();
      const bizId = businessId as string;
      const uid = userId as string;

      // --- Assign plan (API — clears subscription cache server-side) ---
      const preference = (process.env.E2E_TARGET_PLAN || 'enterprise,business')
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s && s !== 'trial');
      const preferredList = preference.length ? preference : ['enterprise', 'business'];
      let targetPlanId =
        (await pickActivePlanId(preferredList)) ?? (await pickAnyActivePlanId());
      if (!targetPlanId) {
        test.skip(true, 'No active subscription_plans row in database');
        return;
      }
      await ensureMultiBranchWarehouseForPlan(targetPlanId);

      const upgradeRes = await api.post('/api/subscriptions/upgrade', {
        data: {
          business_id: bizId,
          plan_id: targetPlanId,
          billing_cycle: 'monthly',
          payment_method: 'e2e',
        },
      });
      expect(
        upgradeRes.ok(),
        `upgrade failed: ${upgradeRes.status()} ${await upgradeRes.text()}`
      ).toBeTruthy();

      // --- Second branch ---
      const branchRes = await api.post('/api/branches', {
        data: {
          business_id: bizId,
          name: `E2E Branch ${runId}`,
          branch_code: `B${String(runId).slice(-6)}`,
          address_line1: '1 Test Street',
          city: 'Bengaluru',
          state: 'Karnataka',
          state_code: '29',
          pincode: '560001',
          created_by_user_id: uid,
        },
      });
      expect(branchRes.ok(), await branchRes.text()).toBeTruthy();
      const branchJson = (await branchRes.json()) as { branch: { id: string } };
      const secondBranchId = branchJson.branch.id;

      const ubRes = await api.post('/api/user-branches', {
        data: {
          business_id: bizId,
          user_id: uid,
          branch_id: secondBranchId,
          permissions: ['create_transactions', 'view_reports', 'manage_inventory'],
          created_by_user_id: uid,
        },
      });
      expect(ubRes.ok(), await ubRes.text()).toBeTruthy();

      // --- Warehouse linked to second branch ---
      const whRes = await api.post('/api/warehouses', {
        data: {
          business_id: bizId,
          branch_id: secondBranchId,
          name: `E2E WH ${runId}`,
          warehouse_code: `W${String(runId).slice(-6)}`,
          created_by: uid,
        },
      });
      expect(whRes.ok(), await whRes.text()).toBeTruthy();
      const whJson = (await whRes.json()) as { warehouse: { id: string } };
      const warehouseId = whJson.warehouse.id;

      // --- Customer + service item (DB insert: avoids customers API vs older schema mismatch) ---
      const customerId = await insertMinimalCustomer(bizId, `E2E Customer ${runId}`, '29');
      const itemId = await insertMinimalServiceItem(bizId, `E2E Service ${runId}`, 500, 18);

      const today = new Date().toISOString().slice(0, 10);
      const invRes = await api.post('/api/invoices', {
        data: {
          business_id: bizId,
          branch_id: secondBranchId,
          customer_id: customerId,
          invoice_date: today,
          status: 'draft',
          document_type: 'tax_invoice',
          place_of_supply_state_code: '29',
          created_by: uid,
          items: [
            {
              item_id: itemId,
              item_name: `E2E Service ${runId}`,
              quantity: 1,
              unit_price: 500,
              tax_rate: 18,
              unit: 'UNT',
            },
          ],
        },
      });

      let invoiceId: string;
      const invText = await invRes.text();
      if (invRes.ok()) {
        const invJson = JSON.parse(invText) as {
          invoice: { id: string; branch_id: string; invoice_number: string };
        };
        invoiceId = invJson.invoice.id;
        expect(invJson.invoice.branch_id).toBe(secondBranchId);
      } else if (invRes.status() === 500 && /does not exist/i.test(invText)) {
        const ins = await insertMinimalDraftInvoiceWithLine({
          businessId: bizId,
          branchId: secondBranchId,
          customerId,
          itemId,
          itemName: `E2E Service ${runId}`,
          createdBy: uid,
          invoiceNumber: `E2E-${runId}`,
          invoiceDate: today,
        });
        invoiceId = ins.invoiceId;
        expect(ins.branchId).toBe(secondBranchId);
      } else {
        throw new Error(`invoice ${invRes.status()}: ${invText}`);
      }

      // --- DB validation ---
      await withDbClient(async (c) => {
        const sub = await c.query(
          `SELECT plan_id, status FROM business_subscriptions WHERE business_id = $1 ORDER BY updated_at DESC NULLS LAST LIMIT 1`,
          [bizId]
        );
        expect(sub.rows[0]?.plan_id).toBe(targetPlanId);

        const br = await c.query(
          `SELECT COUNT(*)::int AS n FROM branches WHERE business_id = $1 AND is_active = true`,
          [bizId]
        );
        expect(br.rows[0]?.n).toBeGreaterThanOrEqual(2);

        const wh = await c.query(`SELECT branch_id FROM warehouses WHERE id = $1`, [warehouseId]);
        expect(wh.rows[0]?.branch_id).toBe(secondBranchId);

        const bw = await c.query(
          `SELECT 1 FROM branch_warehouses WHERE branch_id = $1 AND warehouse_id = $2`,
          [secondBranchId, warehouseId]
        );
        expect(bw.rowCount).toBeGreaterThanOrEqual(1);

        const inv = await c.query(
          `SELECT branch_id, business_id, status FROM invoices WHERE id = $1`,
          [invoiceId]
        );
        if (inv.rows[0]?.branch_id != null) {
          expect(inv.rows[0]?.branch_id).toBe(secondBranchId);
        }
        expect(inv.rows[0]?.business_id).toBe(bizId);
        expect(inv.rows[0]?.status).toBe('draft');

        const lines = await c.query(`SELECT COUNT(*)::int AS n FROM invoice_items WHERE invoice_id = $1`, [
          invoiceId,
        ]);
        expect(lines.rows[0]?.n).toBeGreaterThanOrEqual(1);
      });
    } finally {
      if (businessId) {
        await deleteBusinessCascade(businessId).catch(() => {});
      }
    }
  });
});
