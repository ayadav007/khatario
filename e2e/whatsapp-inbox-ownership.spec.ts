import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { withDbClient, deleteBusinessCascade } from './helpers/db';

/**
 * Shared WhatsApp inbox ownership with two people signed in at once: an agent intervenes on a
 * waiting chat, the owner (supervisor) watches it, the agent transfers it to the owner, the owner
 * resolves it. No WhatsApp session is needed; the chat is seeded straight into the database.
 *
 * Local only, against the disposable DB the server uses:
 *   E2E_INBOX=1 DB_NAME=kh_phase2_test PLAYWRIGHT_BASE_URL=http://localhost:3101 PLAYWRIGHT_SKIP_WEBSERVER=1 \
 *     npx playwright test e2e/whatsapp-inbox-ownership.spec.ts
 * The server must run with DB_NAME=kh_phase2_test and E2E_DISABLE_RATE_LIMIT=true.
 */

const BASE = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000';
const PASSWORD = 'E2E_Inbox!2026';
const COLD = { timeout: 90_000 };

test.describe('WhatsApp inbox ownership (two sessions)', () => {
  test.skip(process.env.E2E_INBOX !== '1', 'Set E2E_INBOX=1 to run');
  test.skip(!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?/.test(BASE), 'Runs only against a local server');

  const runId = Date.now();
  const ownerPhone = `87${String(runId).slice(-8)}`;
  const agentPhone = `86${String(runId).slice(-8)}`;
  let businessId = '';
  let ownerId = '';
  let agentId = '';
  let conversationId = '';

  test.beforeAll(async ({ request }) => {
    test.setTimeout(180_000);
    await withDbClient(async (c) => {
      const db = (await c.query<{ db: string }>('SELECT current_database() AS db')).rows[0].db;
      if (db !== 'kh_phase2_test') throw new Error(`Refusing to seed ${db}; set DB_NAME=kh_phase2_test`);
    });

    const res = await request.post(`${BASE}/api/signup`, {
      data: {
        businessName: `E2E Inbox ${runId}`,
        businessType: 'retail',
        industry: 'services',
        userName: 'E2E Owner',
        userPhone: ownerPhone,
        password: PASSWORD,
        productLine: 'connect',
      },
      ...COLD,
    });
    const body = await res.json().catch(() => ({}));
    expect(res.ok(), JSON.stringify(body)).toBeTruthy();
    businessId = body.businessId;

    const hash = await bcrypt.hash(PASSWORD, 10);
    await withDbClient(async (c) => {
      ownerId = (
        await c.query<{ id: string }>(`SELECT id FROM users WHERE business_id = $1 AND is_primary_admin = true LIMIT 1`, [businessId])
      ).rows[0].id;

      // Paid Connect so the premium inbox APIs are open.
      await c.query(
        `UPDATE business_module_subscriptions SET plan_id = 'connect', status = 'active', end_date = CURRENT_DATE + 30
          WHERE business_id = $1 AND module_key = 'connect'`,
        [businessId],
      );

      const roleId = randomUUID();
      await c.query(
        `INSERT INTO user_roles (id, business_id, role_name, role_key) VALUES ($1, $2, 'Chat agent', $3)`,
        [roleId, businessId, `chat_agent_${runId}`],
      );
      for (const mod of ['whatsapp', 'whatsapp_inbox']) {
        await c.query(
          `INSERT INTO role_permissions (role_id, module_key, can_view, can_add, can_modify, can_delete, can_share)
           VALUES ($1, $2, true, true, true, false, false)`,
          [roleId, mod],
        );
      }
      agentId = randomUUID();
      await c.query(
        `INSERT INTO users (id, business_id, name, phone, password_hash, role_id, is_primary_admin, is_active)
         VALUES ($1, $2, 'Asha Agent', $3, $4, $5, false, true)`,
        [agentId, businessId, agentPhone, hash, roleId],
      );
      await c.query(
        `INSERT INTO user_businesses (user_id, business_id, role_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [agentId, businessId, roleId],
      ).catch(() => undefined);

      conversationId = randomUUID();
      const customer = `91${String(runId).slice(-10)}`;
      await c.query(
        `INSERT INTO whatsapp_conversations (id, business_id, from_number, to_number, conversation_id, whatsapp_display_name,
                                             inbox_state, requested_at, conversation_status, last_message_at, last_message_text, unread_count)
         VALUES ($1, $2, $3, '919999999999', $3, 'E2E Customer', 'requesting', NOW(), 'pending', NOW(), 'Is anyone there?', 1)`,
        [conversationId, businessId, customer],
      );
      await c.query(
        `INSERT INTO whatsapp_conversation_messages (business_id, conversation_id, message_id, from_number, to_number,
                                                     direction, message_text, message_type, status, created_at)
         VALUES ($1, $2, $3, $4, '919999999999', 'incoming', 'Is anyone there?', 'text', 'received', NOW())`,
        [businessId, conversationId, `e2e-${runId}`, customer],
      );
    });
  });

  test.afterAll(async () => {
    if (process.env.E2E_INBOX_KEEP === '1') {
      console.log(`[inbox e2e] kept business ${businessId}; owner ${ownerPhone}, agent ${agentPhone}`);
      return;
    }
    if (businessId) await deleteBusinessCascade(businessId).catch(() => undefined);
  });

  async function signIn(browser: Browser, phone: string): Promise<{ ctx: BrowserContext; page: Page }> {
    const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 } });
    const login = await ctx.request.post('/api/auth/login', { data: { phone, password: PASSWORD }, ...COLD });
    expect(login.ok(), await login.text()).toBeTruthy();
    const page = await ctx.newPage();
    await page.goto('/whatsapp/conversations', COLD);
    const skipTour = page.getByRole('button', { name: /No thanks/i });
    await skipTour.click({ timeout: 30_000 }).catch(() => undefined);
    return { ctx, page };
  }

  async function openChat(page: Page) {
    const row = page.getByText('E2E Customer').first();
    await expect(row).toBeVisible(COLD);
    await row.click();
  }

  test('intervene, watch, transfer and resolve', async ({ browser }) => {
    test.setTimeout(300_000);
    const agent = await signIn(browser, agentPhone);
    const owner = await signIn(browser, ownerPhone);

    try {
      await openChat(agent.page);
      await expect(agent.page.getByText('The customer is waiting for a person')).toBeVisible(COLD);
      await expect(agent.page.getByRole('button', { name: 'Intervene', exact: true })).toBeVisible();
      await agent.page.getByRole('button', { name: 'Intervene', exact: true }).click();
      await expect(agent.page.getByText("You're handling this chat")).toBeVisible(COLD);
      await expect(agent.page.getByText('You intervened')).toBeVisible(COLD);

      await openChat(owner.page);
      await expect(owner.page.getByText('Asha Agent is handling this chat').first()).toBeVisible(COLD);
      await expect(owner.page.getByRole('button', { name: 'Take over', exact: true })).toBeVisible();
      await expect(owner.page.getByRole('button', { name: 'Intervene', exact: true })).toHaveCount(0);

      // A second claim on the same chat is refused with the owner's name.
      const second = await owner.ctx.request.post(`/api/whatsapp/conversations/${conversationId}/ownership`, {
        data: { action: 'intervene' },
      });
      expect(second.status()).toBe(409);
      expect((await second.json()).error).toContain('Asha Agent');

      await agent.page.getByRole('button', { name: /Transfer/ }).click();
      await agent.page.getByRole('button', { name: /E2E Owner/ }).click();

      await expect(agent.page.getByText('E2E Customer')).toHaveCount(0, COLD);
      await expect(owner.page.getByText("You're handling this chat")).toBeVisible(COLD);
      await expect(owner.page.getByText('Asha Agent transferred the chat to you')).toBeVisible(COLD);

      const note = await withDbClient((c) =>
        c.query(
          `SELECT 1 FROM notifications WHERE business_id = $1 AND user_id = $2 AND reference_type = 'whatsapp_conversation' AND reference_id = $3`,
          [businessId, ownerId, conversationId],
        ),
      );
      expect(note.rowCount).toBe(1);

      const hidden = await agent.ctx.request.get(`/api/whatsapp/conversations/${conversationId}/messages?limit=1`);
      expect(hidden.status()).toBe(404);

      await owner.page.getByRole('button', { name: 'Resolve', exact: true }).click();
      await expect(owner.page.getByText('The bot is handling this chat', { exact: true })).toBeVisible(COLD);
      await expect(owner.page.getByText('You resolved the chat')).toBeVisible(COLD);

      const state = await withDbClient((c) =>
        c.query<{ inbox_state: string; assigned_to: string | null }>(
          `SELECT inbox_state, assigned_to FROM whatsapp_conversations WHERE id = $1`,
          [conversationId],
        ),
      );
      expect(state.rows[0]).toEqual({ inbox_state: 'active', assigned_to: null });

      await expect(agent.page.getByText('E2E Customer').first()).toBeVisible(COLD);
    } finally {
      await agent.ctx.close();
      await owner.ctx.close();
    }
  });
});
