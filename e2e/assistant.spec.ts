import { test, expect, type Page } from '@playwright/test';

/**
 * Khatario AI assistant: public widget on /book-demo (logged out) and API ownership rules.
 * Works without GROQ/GEMINI keys (answers fall back to quoting the guide) once `npm run kb:reindex` has run.
 */

// First hit on a route compiles it under `next dev`, which can exceed the default request timeout.
const COLD = { timeout: 90_000 };

async function openWidget(page: Page) {
  await page.goto('/book-demo');
  const launcher = page.getByTestId('assistant-launcher');
  await expect(launcher).toBeVisible({ timeout: 30_000 });
  await launcher.click();
  await expect(page.getByTestId('assistant-panel')).toBeVisible();
}

async function ask(page: Page, text: string) {
  const input = page.getByTestId('assistant-input');
  await input.fill(text);
  const send = page.getByTestId('assistant-panel').getByRole('button', { name: 'Send' });
  await expect(send).toBeEnabled();
  await send.click();
}

test.describe('Assistant - public widget', () => {
  test('status endpoint is enabled and sets the visitor cookie', async ({ page }) => {
    test.setTimeout(120_000);
    const res = await page.request.get('/api/public/assistant/chat?channel=web', COLD);
    expect(res.ok()).toBeTruthy();
    expect(await res.json()).toMatchObject({ enabled: true, channel: 'web' });
    expect(res.headers()['set-cookie'] ?? '').toMatch(/kh_av=[0-9a-f]{32}/);
  });

  test('answers a pricing question with a cited source', async ({ page }) => {
    await openWidget(page);
    await ask(page, 'What plans do you have and how much do they cost?');
    const panel = page.getByTestId('assistant-panel');
    await expect(panel.locator('sup').first()).toBeVisible({ timeout: 30_000 });
    await expect(panel.getByRole('button', { name: /helpful/i }).first()).toBeVisible();
  });

  test('Hinglish demo request shows the booking card', async ({ page }) => {
    await openWidget(page);
    await ask(page, 'demo book karna hai');
    const panel = page.getByTestId('assistant-panel');
    await expect(panel.getByText('Book a free demo')).toBeVisible({ timeout: 30_000 });
    await expect(panel.getByLabel('Demo date')).toBeVisible();
    await expect(panel.getByPlaceholder('WhatsApp number (10 digits)')).toBeVisible();
  });
});

test.describe('Assistant - API isolation', () => {
  test('a conversation is readable only by the visitor who started it', async ({ browser }) => {
    const owner = await browser.newContext();
    const ownerPage = await owner.newPage();
    test.setTimeout(240_000);
    await ownerPage.request.get('/api/public/assistant/chat?channel=web', COLD);
    const chat = await ownerPage.request.post('/api/public/assistant/chat?channel=web', {
      data: { message: 'Does Khatario work offline?' },
      ...COLD,
    });
    expect(chat.ok()).toBeTruthy();
    const meta = (await chat.text())
      .split('\n')
      .filter((line) => line.startsWith('data: '))
      .map((line) => JSON.parse(line.slice('data: '.length)))
      .find((e) => e?.type === 'meta');
    expect(meta?.conversationId).toMatch(/^[0-9a-f-]{36}$/);

    const mine = await ownerPage.request.get(`/api/public/assistant/conversation/${meta.conversationId}`, COLD);
    expect(mine.status()).toBe(200);

    const stranger = await browser.newContext();
    const strangerPage = await stranger.newPage();
    await strangerPage.request.get('/api/public/assistant/chat?channel=web');
    const theirs = await strangerPage.request.get(`/api/public/assistant/conversation/${meta.conversationId}`);
    expect(theirs.status()).toBe(404);

    await owner.close();
    await stranger.close();
  });

  test('in-app assistant API requires a logged-in session', async ({ request }) => {
    test.setTimeout(120_000);
    const res = await request.post('/api/assistant/chat', {
      data: { message: 'hi' },
      headers: { 'x-authenticated-user-id': '11111111-1111-1111-1111-111111111111' },
      ...COLD,
    });
    expect([401, 403]).toContain(res.status());
  });
});
