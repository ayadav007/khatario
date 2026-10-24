import { expect, type APIRequestContext, type Page } from '@playwright/test';

/** Must match `CLASSIC_DESKTOP_FORM_KEY` in app/(app)/invoices/new/page.tsx */
export const CLASSIC_DESKTOP_FORM_KEY = 'invoiceClassicDesktop';

export type ComposerSession = {
  userId: string;
  businessId: string;
};

/** Force desktop viewport + new composer (not classic / mobile). */
export async function openNewDesktopComposer(
  page: Page,
  path = '/invoices/new'
): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript((key) => {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }, CLASSIC_DESKTOP_FORM_KEY);
  await page.goto(path);
  await expect(page.getByRole('button', { name: /classic form/i })).toBeVisible({
    timeout: 30000,
  });
  await expect(page.getByRole('button', { name: /generate draft|generate & send|^generate$/i }).first()).toBeVisible();
}

export async function getComposerSession(request: APIRequestContext): Promise<ComposerSession> {
  const res = await request.get('/api/auth/session');
  expect(res.ok(), await res.text()).toBeTruthy();
  const json = (await res.json()) as {
    user?: { id?: string };
    business?: { id?: string };
  };
  const userId = json.user?.id;
  const businessId = json.business?.id;
  expect(userId, 'session.user.id').toBeTruthy();
  expect(businessId, 'session.business.id').toBeTruthy();
  return { userId: userId as string, businessId: businessId as string };
}

export async function seedCustomer(
  request: APIRequestContext,
  session: ComposerSession,
  name: string,
  extras: Record<string, unknown> = {}
): Promise<{ id: string; name: string }> {
  const res = await request.post('/api/customers', {
    data: {
      name,
      created_by: session.userId,
      city: 'Bengaluru',
      state: 'Karnataka',
      state_code: '29',
      country: 'India',
      ...extras,
    },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  const json = (await res.json()) as { customer?: { id: string; name: string }; id?: string };
  const id = json.customer?.id ?? json.id;
  expect(id, 'customer id').toBeTruthy();
  return { id: id as string, name };
}

export async function seedServiceItem(
  request: APIRequestContext,
  session: ComposerSession,
  name: string,
  opts: { selling_price?: number; tax_rate?: number; barcode?: string; gst_included?: boolean } = {}
): Promise<{ id: string; name: string }> {
  const res = await request.post('/api/items', {
    data: {
      name,
      unit: 'UNT',
      item_type: 'service',
      selling_price: opts.selling_price ?? 100,
      tax_rate: opts.tax_rate ?? 18,
      hsn_sac: '998314',
      barcode: opts.barcode,
      gst_included: opts.gst_included ?? false,
      created_by: session.userId,
    },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  const json = (await res.json()) as { item?: { id: string; name: string }; id?: string };
  const id = json.item?.id ?? json.id;
  expect(id, 'item id').toBeTruthy();
  return { id: id as string, name };
}

export async function selectCustomerByName(page: Page, name: string): Promise<void> {
  const search = page.getByPlaceholder(/search customer by name or phone/i);
  if (await search.isVisible().catch(() => false)) {
    await search.fill(name);
  } else {
    await page.getByRole('button', { name: /^change$/i }).click();
    await page.getByPlaceholder(/search customer by name or phone/i).fill(name);
  }
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const option = page
    .locator('button, [role="option"], li')
    .filter({ hasText: new RegExp(escaped, 'i') })
    .first();
  await expect(option).toBeVisible({ timeout: 15000 });
  await option.click();
  await expect(page.getByRole('button', { name: /^change$/i })).toBeVisible({ timeout: 10000 });
}

export async function addItemViaPicker(page: Page, itemName: string, qty = 1): Promise<void> {
  await page.getByRole('button', { name: /add items/i }).first().click();
  const dialog = page.getByRole('dialog', { name: /add items/i });
  await expect(dialog).toBeVisible();
  const search = dialog.getByPlaceholder(/search by item name/i);
  await search.fill(itemName);
  await expect(dialog.getByText(itemName, { exact: false }).first()).toBeVisible({ timeout: 15000 });
  // Select active row via Enter (bumps qty), then commit with F7
  for (let i = 0; i < qty; i++) {
    await search.press('Enter');
  }
  const addToBill = dialog.getByRole('button', { name: /add .+ to bill|add to bill/i });
  if (await addToBill.isVisible().catch(() => false)) {
    await addToBill.click();
  } else {
    await page.keyboard.press('F7');
  }
  await expect(dialog).toBeHidden({ timeout: 15000 });
  await expect(page.getByText(itemName).first()).toBeVisible();
}

export async function fillNotes(page: Page, text: string): Promise<void> {
  const reveal = page.getByRole('button', { name: /add notes or terms printed on the invoice/i });
  if (await reveal.isVisible().catch(() => false)) {
    await reveal.click();
  }
  await page.locator('textarea').first().fill(text);
}
