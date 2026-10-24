import { test as base, expect } from '@playwright/test';
import { test, loginAsTestUser } from './fixtures/auth';

/**
 * Shop WhatsApp AI agent settings (/settings/whatsapp/ai-agent): auth on the APIs, old routes redirect,
 * the editor or setup wizard renders, and owner FAQs round-trip through the knowledge API.
 * The logged-in tests need E2E_TEST_PHONE / E2E_TEST_PASSWORD for a shop with the WhatsApp add-on.
 */

const COLD = { timeout: 90_000 };
const hasCreds = !!(process.env.E2E_TEST_PHONE && process.env.E2E_TEST_PASSWORD);

base.describe('AI agent - unauthenticated', () => {
  base('agent APIs refuse anonymous callers', async ({ request }) => {
    base.setTimeout(180_000);
    for (const [method, url] of [
      ['GET', '/api/ai-agent'],
      ['GET', '/api/ai-agent/knowledge'],
      ['POST', '/api/ai-agent/test'],
      ['PUT', '/api/ai-agent/provider'],
    ] as const) {
      const res = await request.fetch(url, { method, data: method === 'GET' ? undefined : {}, ...COLD });
      expect([401, 403], `${method} ${url}`).toContain(res.status());
    }
  });
});

test.describe('AI agent - settings page', () => {
  test.skip(!hasCreds, 'Needs E2E_TEST_PHONE and E2E_TEST_PASSWORD');

  test('old AI settings URLs redirect to the new page', async ({ authenticatedPage: page }) => {
    test.setTimeout(180_000);
    for (const old of ['/settings/ai-config', '/settings/ai-assistant', '/settings/ai-agent']) {
      await page.goto(old, COLD);
      await expect(page).toHaveURL(/\/settings\/whatsapp\/ai-agent$/, COLD);
    }
  });

  test('shows the setup wizard or the editor with a test chat', async ({ authenticatedPage: page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/settings/whatsapp/ai-agent', COLD);
    await expect(page.getByRole('heading', { name: 'WhatsApp' }).first()).toBeVisible(COLD);
    await expect(page.getByRole('link', { name: 'AI agent' }).first()).toHaveAttribute('aria-current', 'page');

    const wizard = page.getByText('Set up your WhatsApp AI agent');
    const editor = page.locator('[data-agent-section="profile"]');
    await expect(wizard.or(editor)).toBeVisible(COLD);

    if (await editor.isVisible()) {
      await expect(page.getByText('Test your agent').first()).toBeVisible();
      await expect(page.getByRole('navigation', { name: 'AI agent sections' }).first()).toBeVisible();
      for (const id of ['profile', 'tone', 'knowledge', 'skills', 'handoff', 'advanced']) {
        await expect(page.locator(`[data-agent-section="${id}"]`)).toHaveCount(1);
      }
    } else {
      await expect(page.getByText('Tell us about your business')).toBeVisible();
    }
  });

  test('an owner FAQ can be added, read and removed', async ({ page }) => {
    test.setTimeout(180_000);
    await loginAsTestUser(page);
    const question = `E2E: do you deliver on Sundays? ${Date.now()}`;

    const created = await page.request.post('/api/ai-agent/knowledge', {
      data: { kind: 'faq', question, answer: 'Yes, from 10am to 2pm.' },
      ...COLD,
    });
    expect(created.status(), await created.text()).toBe(201);
    const { item } = await created.json();
    expect(item).toMatchObject({ kind: 'faq', question, status: 'active' });

    try {
      const list = await page.request.get('/api/ai-agent/knowledge', COLD);
      expect(list.ok()).toBeTruthy();
      const body = await list.json();
      expect(body.items.some((i: { id: string }) => i.id === item.id)).toBe(true);

      const bad = await page.request.get('/api/ai-agent/knowledge/not-a-uuid');
      expect(bad.status()).toBe(404);
    } finally {
      const del = await page.request.delete(`/api/ai-agent/knowledge/${item.id}`);
      expect(del.ok()).toBeTruthy();
    }
  });

  test('the agent snapshot never includes an API key', async ({ page }) => {
    test.setTimeout(180_000);
    await loginAsTestUser(page);
    const res = await page.request.get('/api/ai-agent', COLD);
    expect(res.ok()).toBeTruthy();
    const snap = await res.json();
    expect(snap.provider).not.toHaveProperty('apiKey');
    expect(JSON.stringify(snap)).not.toMatch(/api_key|apiKeyEncrypted|api_key_encrypted/);
    expect(Array.isArray(snap.checklist)).toBe(true);
  });
});
