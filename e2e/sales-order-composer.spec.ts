import { test, expect } from '@playwright/test';
import {
  CLASSIC_DESKTOP_FORM_KEY as INVOICE_CLASSIC_KEY,
  getComposerSession,
  seedCustomer,
  seedServiceItem,
} from './helpers/invoice-composer';

const SO_CLASSIC_KEY = 'salesOrderClassicDesktop';

async function openSalesOrderComposer(page: import('@playwright/test').Page, path = '/sales-orders/new') {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript((keys: string[]) => {
    for (const key of keys) {
      try {
        localStorage.removeItem(key);
      } catch {
        /* ignore */
      }
    }
  }, [SO_CLASSIC_KEY, INVOICE_CLASSIC_KEY]);
  await page.goto(path);
  await expect(page.getByTestId('sales-order-composer')).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole('button', { name: /classic form/i })).toBeVisible();
}

test.describe('Sales order desktop composer', () => {
  test('opens new composer on desktop', async ({ page }) => {
    await openSalesOrderComposer(page);
    await expect(page.getByRole('heading', { name: /new sales order/i })).toBeVisible();
    await expect(page.getByTestId('sales-order-confirm')).toBeVisible();
  });

  test('edit query loads order into composer', async ({ page, request }) => {
    const session = await getComposerSession(request);
    const customer = await seedCustomer(request, session, `SO Composer ${Date.now()}`);
    const item = await seedServiceItem(request, session, `SO Item ${Date.now()}`, {
      selling_price: 250,
      tax_rate: 18,
    });

    const createRes = await request.post('/api/sales-orders', {
      data: {
        business_id: session.businessId,
        created_by: session.userId,
        customer_id: customer.id,
        order_number: `SO-E2E-${Date.now().toString().slice(-6)}`,
        order_date: new Date().toISOString().slice(0, 10),
        status: 'draft',
        items: [
          {
            item_id: item.id,
            item_name: item.name,
            qty: 1,
            unit: 'UNT',
            unit_price: 250,
            tax_rate: 18,
            tax_amount: 45,
            taxable_value: 250,
            cgst_amount: 22.5,
            sgst_amount: 22.5,
            igst_amount: 0,
            line_total: 295,
          },
        ],
        subtotal: 250,
        tax_total: 45,
        grand_total: 295,
      },
    });
    expect(createRes.ok(), await createRes.text()).toBeTruthy();
    const created = (await createRes.json()) as { salesOrder?: { id: string; order_number: string } };
    const orderId = created.salesOrder?.id;
    expect(orderId).toBeTruthy();

    await openSalesOrderComposer(page, `/sales-orders/new?edit=${orderId}`);
    await expect(page.getByRole('heading', { name: /edit sales order/i })).toBeVisible();
    await expect(page.getByText(customer.name, { exact: false }).first()).toBeVisible({
      timeout: 15000,
    });
  });
});
