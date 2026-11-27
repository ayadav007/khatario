/**
 * SUB-20 (rest): automatic WhatsApp senders check the plan and the daily cap before sending.
 * Disposable DB only:
 *   PHASE2_TEST_DATABASE_URL=postgresql://postgres:<pw>@127.0.0.1:5433/kh_phase2_test DB_SSL=false \
 *     npx jest tests/db/automation-plan-checks.db.test.ts --runInBand --forceExit
 *
 * Senders covered: keyword bot rule, published flow, shop-cart confirmation and Cloud reply delivery
 * (all through the inbound pipeline), scheduled payment reminders, and the WhatsApp copy of a todo
 * reminder. Every real network sender is stubbed.
 */
import { randomUUID } from 'crypto';

const enabled = !!process.env.PHASE2_TEST_DATABASE_URL;
if (enabled) process.env.DATABASE_URL = process.env.PHASE2_TEST_DATABASE_URL;

jest.mock('next/headers', () => ({
  headers: jest.fn(async () => ({ get: () => null })),
  cookies: jest.fn(async () => ({ get: () => undefined })),
}));
jest.mock('@/lib/jwt', () => ({
  clearSessionCookie: jest.fn(), setSessionCookies: jest.fn(),
  signAccessToken: jest.fn(async () => 't'), signRefreshToken: jest.fn(async () => 't'),
}));
jest.mock('@/lib/supplier-hub-visibility', () => ({ isSupplierHubVisible: jest.fn(async () => true) }));
jest.mock('@/lib/queue/redis', () => ({ getRedisConnection: () => null }));
jest.mock('@/lib/whatsapp', () => ({
  sendWhatsAppMessage: jest.fn(async () => 'wa-id'),
  getWhatsAppStatus: jest.fn(async () => ({ status: 'connected' })),
}));
jest.mock('@/lib/whatsapp/business-transport', () => ({
  ...jest.requireActual('@/lib/whatsapp/business-transport'),
  businessTransport: jest.fn(async () => 'baileys'),
  sendBusinessText: jest.fn(async () => ({ messageId: 'bt-1' })),
  sendBusinessTemplate: jest.fn(async () => ({ messageId: 'bt-2' })),
}));
// Tenant event sends fall through to the (mocked) QR sender; no Cloud API, push or outbound-state lookups.
jest.mock('@/lib/meta-whatsapp', () => ({
  ...jest.requireActual('@/lib/meta-whatsapp'),
  isMetaWaConfigured: jest.fn(async () => false),
}));
jest.mock('@/lib/push/customer-push', () => ({ enqueueCustomerPush: jest.fn(async () => ({ queued: false, reason: 'no_device' })) }));
jest.mock('@/lib/whatsapp/outbound-ready', () => ({ whatsAppOutboundReady: jest.fn(async () => ({ ready: true })) }));
jest.mock('@/lib/platform-whatsapp-send', () => ({
  ...jest.requireActual('@/lib/platform-whatsapp-send'),
  lookupTenantWhatsAppPhone: jest.fn(async () => '919800000001'),
  sendPlatformEventWhatsApp: jest.fn(async () => ({ sent: true, messageId: 'plat-1' })),
}));
jest.mock('@/lib/whatsapp-shop/order', () => ({
  placeShopOrder: jest.fn(async () => ({ ok: true })),
  sendShopOrderReply: jest.fn(async () => undefined),
}));
jest.mock('@/lib/reminder-message-processor', () => ({
  sendReminderMessage: jest.fn(async () => ({ success: true })),
}));
jest.mock('@/lib/email-reminder', () => ({ sendEmailReminder: jest.fn(async () => undefined) }));

import { query, queryOne, closePool } from '@/lib/db';
import { checkLimit, clearAddonCache, clearSubscriptionCache } from '@/lib/subscription';
import { clearModuleSubscriptionCache } from '@/lib/subscription/module-subscriptions';
import { processIncomingMessage } from '@/lib/whatsapp-crm';
import { processCloudIncoming } from '@/lib/whatsapp/cloud-incoming';
import { sendBusinessText } from '@/lib/whatsapp/business-transport';
import { placeShopOrder, sendShopOrderReply } from '@/lib/whatsapp-shop/order';
import { deliverPaymentReminder } from '@/lib/payment-reminder-delivery';
import { sendReminderMessage } from '@/lib/reminder-message-processor';
import { trySendWhatsAppForTodo } from '@/lib/services/todoReminderService';
import { sendWhatsAppMessage } from '@/lib/whatsapp';
import { checkAutomationAllowed } from '@/lib/whatsapp/automation-guard';
import { notifyBusinessEvent } from '@/lib/whatsapp/tenant-send';
import { checkAndSendCreditAlerts } from '@/lib/credit-alerts';
import { notifyInvoicePaymentReceived } from '@/lib/invoices/payment-received-notify';
import { sendKhataStatementMessage } from '@/lib/khata/notify';
import { flushHubWhatsApp } from '@/lib/supplier-hub-whatsapp';
import { sendOwnerSummary } from '@/lib/whatsapp/owner-summary';
import { processOwnerCommand } from '@/lib/whatsapp/owner-command';
import { sendCartReminder } from '@/lib/store/abandoned-carts';
import { sendPlatformEventWhatsApp } from '@/lib/platform-whatsapp-send';
import { POST as stuckParcelsPOST } from '@/app/api/cron/stuck-parcels/route';
import { NextRequest } from 'next/server';

const run = enabled ? describe : describe.skip;

run('automation plan checks (kh_phase2_test)', () => {
  jest.setTimeout(60000);
  const created: string[] = [];
  const phone = () => `9${Math.floor(Math.random() * 1e9).toString().padStart(9, '0')}`;
  let savedConnectPrice: string | null = null;

  async function setPlan(biz: string, moduleKey: string, planId: string, opts: { end?: string; grace?: string } = {}) {
    await query(
      `INSERT INTO business_module_subscriptions (business_id, module_key, plan_id, status, start_date, end_date, grace_period_end)
       VALUES ($1, $2, $3, 'active', CURRENT_DATE,
               CASE WHEN $4::text IS NULL THEN NULL ELSE (CURRENT_DATE + $4::interval)::date END,
               CASE WHEN $5::text IS NULL THEN NULL ELSE (CURRENT_DATE + $5::interval)::date END)
       ON CONFLICT (business_id, module_key) DO UPDATE SET plan_id = EXCLUDED.plan_id, status = 'active',
         start_date = CURRENT_DATE, trial_end_date = NULL, end_date = EXCLUDED.end_date,
         grace_period_end = EXCLUDED.grace_period_end, scheduled_plan_id = NULL, updated_at = CURRENT_TIMESTAMP`,
      [biz, moduleKey, planId, opts.end ?? null, opts.grace ?? null],
    );
    clearSubscriptionCache(biz);
    clearModuleSubscriptionCache(biz);
    clearAddonCache(biz);
  }

  async function newBusiness(billingPlan: string, connectPlan: string | null): Promise<string> {
    const biz = randomUUID();
    created.push(biz);
    await query(
      `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type, primary_module)
       VALUES ($1, $2, '27AAAPA1234A1Z5', '27', 'regular', 'billing')`,
      [biz, `Automation ${biz.slice(0, 6)}`],
    );
    await query(`INSERT INTO business_modules (business_id, module_key, enabled, source) VALUES ($1, 'billing', true, 'test')`, [biz]);
    await setPlan(biz, 'billing', billingPlan);
    if (connectPlan) {
      await query(`INSERT INTO business_modules (business_id, module_key, enabled, source) VALUES ($1, 'connect', true, 'test')`, [biz]);
      await setPlan(biz, 'connect', connectPlan);
    }
    return biz;
  }

  async function fillQuota(biz: string) {
    const check = await checkLimit(biz, 'whatsapp');
    for (let i = check.current; i < (check.limit as number); i++) {
      await query(`INSERT INTO whatsapp_messages (business_id, to_number, message_type, status) VALUES ($1, $2, 'text', 'sent')`, [biz, phone()]);
    }
    clearSubscriptionCache(biz);
  }

  async function addKeywordRule(biz: string) {
    await query(
      `INSERT INTO whatsapp_bot_rules (business_id, name, trigger_type, trigger_value, response_message, is_active, priority)
       VALUES ($1, 'hello rule', 'exact_match', 'hello', 'Hi from the bot', true, 10)`,
      [biz],
    );
  }

  async function addFlow(biz: string) {
    const definition = {
      nodes: [
        { id: 'start', type: 'start', position: { x: 0, y: 0 },
          data: { hardPhrases: ['flowtest'], hardRegex: [], regexCaseSensitive: false, firstMessage: false, softIntents: [] } },
        { id: 'm1', type: 'message', position: { x: 0, y: 100 },
          data: { header: '', body: 'Flow hello', footer: '', mediaType: 'none', mediaUrl: '', delaySeconds: 0 } },
        { id: 'end', type: 'end', position: { x: 0, y: 200 }, data: {} },
      ],
      edges: [{ id: 'e1', source: 'start', target: 'm1' }, { id: 'e2', source: 'm1', target: 'end' }],
      viewport: { x: 0, y: 0, zoom: 1 },
    };
    await query(
      `INSERT INTO whatsapp_flows (business_id, name, status, version, definition, published_definition, triggers)
       VALUES ($1, 'Test flow', 'published', 1, $2::jsonb, $2::jsonb, $3::jsonb)`,
      [biz, JSON.stringify(definition),
        JSON.stringify({ hardPhrases: ['flowtest'], hardRegex: [], regexCaseSensitive: false, firstMessage: false })],
    );
  }

  /** One inbound customer message through the real pipeline; returns the reply it would send. */
  async function inbound(biz: string, text: string, from = phone()) {
    const out: { conversationUuid?: string } = {};
    const result = await processIncomingMessage(
      biz, `91${from}@s.whatsapp.net`, '919999999999', text, `m-${randomUUID()}`, 'text',
      undefined, false, undefined, undefined, 'Cust', undefined, undefined, out as never,
    );
    return { result, conversationUuid: out.conversationUuid, from };
  }

  const stored = (biz: string) =>
    queryOne<{ n: string }>(`SELECT COUNT(*)::text AS n FROM whatsapp_conversation_messages WHERE business_id = $1 AND direction = 'incoming'`, [biz]);
  const skippedLog = (biz: string) =>
    queryOne<{ n: string; reason: string | null }>(
      `SELECT COUNT(*)::text AS n, MAX(reason) AS reason FROM whatsapp_inbound_routing_events
        WHERE business_id = $1 AND reason LIKE 'automation_skipped:%'`, [biz]);

  beforeAll(async () => {
    if (!enabled) return;
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('network disabled in tests'));
    const r = await queryOne<{ p: string }>(`SELECT price_monthly::text AS p FROM subscription_plans WHERE id = 'connect'`);
    savedConnectPrice = r?.p ?? null;
  });
  beforeEach(() => {
    jest.mocked(sendBusinessText).mockClear();
    jest.mocked(sendShopOrderReply).mockClear();
    jest.mocked(sendReminderMessage).mockClear();
    jest.mocked(sendWhatsAppMessage).mockClear();
  });
  afterAll(async () => {
    jest.restoreAllMocks();
    if (!enabled) return;
    if (savedConnectPrice !== null) {
      await query(`UPDATE subscription_plans SET price_monthly = $1 WHERE id = 'connect'`, [savedConnectPrice]);
    }
    for (const id of created) {
      await query(`DELETE FROM whatsapp_inbound_routing_events WHERE business_id = $1`, [id]).catch(() => undefined);
      await query(`DELETE FROM whatsapp_conversation_messages WHERE business_id = $1`, [id]).catch(() => undefined);
      await query(`DELETE FROM whatsapp_flow_sessions WHERE business_id = $1`, [id]).catch(() => undefined);
      await query(`DELETE FROM businesses WHERE id = $1`, [id]).catch(() => undefined);
    }
    await closePool();
  });

  describe('keyword bot rule', () => {
    it('plan without the Connect feature: no reply, message kept, reason logged, nothing else changed', async () => {
      const biz = await newBusiness('billing_growth', 'connect_free');
      await addKeywordRule(biz);
      const { result, conversationUuid } = await inbound(biz, 'hello');
      expect(result.response).toBeUndefined();
      expect(result.handled).toBeFalsy(); // so the chat is queued for a person
      expect(conversationUuid).toBeTruthy();
      expect(Number((await stored(biz))!.n)).toBe(1);
      expect((await skippedLog(biz))).toMatchObject({ n: '1', reason: 'automation_skipped:plan_does_not_include_feature' });
      expect(Number((await queryOne<{ n: string }>(`SELECT COUNT(*)::text AS n FROM whatsapp_conversation_states WHERE business_id = $1`, [biz]))!.n)).toBe(0);
    });

    it('Connect module not enabled at all: no reply', async () => {
      const biz = await newBusiness('billing_growth', null);
      await addKeywordRule(biz);
      expect((await inbound(biz, 'hello')).result.response).toBeUndefined();
    });

    it('daily WhatsApp cap reached: no reply', async () => {
      const biz = await newBusiness('billing_growth', 'connect');
      await addKeywordRule(biz);
      await fillQuota(biz);
      const { result } = await inbound(biz, 'hello');
      expect(result.response).toBeUndefined();
      expect((await skippedLog(biz))!.reason).toBe('automation_skipped:daily_whatsapp_limit_reached');
    });

    it('usable Connect plan: the rule replies', async () => {
      const biz = await newBusiness('billing_growth', 'connect');
      await addKeywordRule(biz);
      expect((await inbound(biz, 'hello')).result.response).toBe('Hi from the bot');
      expect((await skippedLog(biz))!.n).toBe('0');
    });

    it('a Rs 1 Connect plan replies', async () => {
      await query(`UPDATE subscription_plans SET price_monthly = 1 WHERE id = 'connect'`);
      const biz = await newBusiness('billing_growth', 'connect');
      await addKeywordRule(biz);
      expect((await inbound(biz, 'hello')).result.response).toBe('Hi from the bot');
      await query(`UPDATE subscription_plans SET price_monthly = $1 WHERE id = 'connect'`, [savedConnectPrice]);
    });

    it('lapsed beyond grace: no reply; inside grace: still replies', async () => {
      const biz = await newBusiness('billing_growth', 'connect');
      await addKeywordRule(biz);
      await setPlan(biz, 'connect', 'connect', { end: '-30 days', grace: '-23 days' });
      expect((await inbound(biz, 'hello')).result.response).toBeUndefined();
      await setPlan(biz, 'connect', 'connect', { end: '-2 days', grace: '+5 days' });
      expect((await inbound(biz, 'hello')).result.response).toBe('Hi from the bot');
    });

    it('resumes by itself when the plan comes back', async () => {
      const biz = await newBusiness('billing_growth', 'connect_free');
      await addKeywordRule(biz);
      expect((await inbound(biz, 'hello')).result.response).toBeUndefined();
      await setPlan(biz, 'connect', 'connect');
      expect((await inbound(biz, 'hello')).result.response).toBe('Hi from the bot');
    });
  });

  describe('published flow', () => {
    it('plan without the feature: no flow reply and no flow session is started', async () => {
      const biz = await newBusiness('billing_growth', 'connect_free');
      await addFlow(biz);
      const { result } = await inbound(biz, 'flowtest');
      expect(result.response).toBeUndefined();
      expect(Number((await queryOne<{ n: string }>(`SELECT COUNT(*)::text AS n FROM whatsapp_flow_sessions WHERE business_id = $1`, [biz]))!.n)).toBe(0);
      expect((await skippedLog(biz))!.n).toBe('1');
    });

    it('cap reached: no flow reply', async () => {
      const biz = await newBusiness('billing_growth', 'connect');
      await addFlow(biz);
      await fillQuota(biz);
      expect((await inbound(biz, 'flowtest')).result.response).toBeUndefined();
    });

    it('usable plan (Rs 1): the flow replies', async () => {
      await query(`UPDATE subscription_plans SET price_monthly = 1 WHERE id = 'connect'`);
      const biz = await newBusiness('billing_growth', 'connect');
      await addFlow(biz);
      expect((await inbound(biz, 'flowtest')).result.response).toBe('Flow hello');
      await query(`UPDATE subscription_plans SET price_monthly = $1 WHERE id = 'connect'`, [savedConnectPrice]);
    });

    it('lapsed beyond grace: no flow reply', async () => {
      const biz = await newBusiness('billing_growth', 'connect');
      await addFlow(biz);
      await setPlan(biz, 'connect', 'connect', { end: '-30 days', grace: '-23 days' });
      expect((await inbound(biz, 'flowtest')).result.response).toBeUndefined();
    });

    it('an open flow session is left as it is when a reply is skipped', async () => {
      const biz = await newBusiness('billing_growth', 'connect');
      await addFlow(biz);
      const { conversationUuid } = await inbound(biz, 'unrelated chatter');
      const flow = await queryOne<{ id: string }>(`SELECT id FROM whatsapp_flows WHERE business_id = $1`, [biz]);
      await query(
        `INSERT INTO whatsapp_flow_sessions (business_id, conversation_id, flow_id, flow_version, current_node_id, expires_at)
         VALUES ($1, $2, $3, 1, 'm1', NOW() + INTERVAL '1 day')`,
        [biz, conversationUuid, flow!.id],
      );
      await setPlan(biz, 'connect', 'connect_free');
      // Same chat, same phone as the first message is not available here; any message on this chat is skipped.
      await inbound(biz, 'flowtest');
      const s = await queryOne<{ status: string; current_node_id: string }>(
        `SELECT status, current_node_id FROM whatsapp_flow_sessions WHERE business_id = $1`, [biz]);
      expect(s).toMatchObject({ status: 'active', current_node_id: 'm1' });
    });
  });

  describe('Cloud pipeline and shop-cart confirmation', () => {
    const job = (biz: string, over: Record<string, unknown> = {}) => ({
      businessId: biz,
      businessPhone: '919999999999',
      from: `91${phone()}`,
      messageId: `wamid-${randomUUID()}`,
      messageType: 'text',
      text: 'hello',
      profileName: 'Cust',
      ...over,
    }) as never;

    it('bot reply is delivered on a usable plan and not delivered on a plan without the feature', async () => {
      const ok = await newBusiness('billing_growth', 'connect');
      await addKeywordRule(ok);
      await processCloudIncoming(job(ok));
      expect(sendBusinessText).toHaveBeenCalledTimes(1);

      jest.mocked(sendBusinessText).mockClear();
      const no = await newBusiness('billing_growth', 'connect_free');
      await addKeywordRule(no);
      await processCloudIncoming(job(no));
      expect(sendBusinessText).not.toHaveBeenCalled();
    });

    it('bot reply is not delivered at the cap or after a lapse beyond grace', async () => {
      const capped = await newBusiness('billing_growth', 'connect');
      await addKeywordRule(capped);
      await fillQuota(capped);
      await processCloudIncoming(job(capped));
      const lapsed = await newBusiness('billing_growth', 'connect');
      await addKeywordRule(lapsed);
      await setPlan(lapsed, 'connect', 'connect', { end: '-30 days', grace: '-23 days' });
      await processCloudIncoming(job(lapsed));
      expect(sendBusinessText).not.toHaveBeenCalled();
    });

    const cart = { items: [{ retailerId: 'x', quantity: 1 }], note: '' };

    it('cart: the order is recorded either way; the confirmation is sent only when automation is allowed', async () => {
      const ok = await newBusiness('billing_growth', 'connect');
      await processCloudIncoming(job(ok, { order: cart, text: '' }));
      expect(placeShopOrder).toHaveBeenCalled();
      expect(sendShopOrderReply).toHaveBeenCalledTimes(1);

      jest.mocked(sendShopOrderReply).mockClear();
      const no = await newBusiness('billing_growth', 'connect_free');
      await processCloudIncoming(job(no, { order: cart, text: '' }));
      expect(sendShopOrderReply).not.toHaveBeenCalled();
      expect((await skippedLog(no))!.n).toBe('1');

      const capped = await newBusiness('billing_growth', 'connect');
      await fillQuota(capped);
      await processCloudIncoming(job(capped, { order: cart, text: '' }));
      expect(sendShopOrderReply).not.toHaveBeenCalled();

      const lapsed = await newBusiness('billing_growth', 'connect');
      await setPlan(lapsed, 'connect', 'connect', { end: '-30 days', grace: '-23 days' });
      await processCloudIncoming(job(lapsed, { order: cart, text: '' }));
      expect(sendShopOrderReply).not.toHaveBeenCalled();
    });
  });

  describe('scheduled payment reminders', () => {
    async function dueInvoice(biz: string) {
      const customerId = randomUUID();
      const invoiceId = randomUUID();
      await query(`INSERT INTO customers (id, business_id, name, phone) VALUES ($1, $2, 'Cust', $3)`, [customerId, biz, phone()]);
      await query(
        `INSERT INTO invoices (id, business_id, customer_id, invoice_number, invoice_date, due_date, status, payment_status, grand_total, balance_amount)
         VALUES ($1, $2, $3, $4, CURRENT_DATE, CURRENT_DATE, 'final', 'unpaid', 100, 100)`,
        [invoiceId, biz, customerId, `INV-${invoiceId.slice(0, 6)}`],
      );
      return invoiceId;
    }
    const deliver = (biz: string, invoiceId: string) =>
      deliverPaymentReminder({ businessId: biz, invoiceId, kind: 'payment_due', messageTemplate: 'Pay {amount}', includePdf: false });

    it('plan without whatsapp_auto_reminders: skipped with its reason, nothing sent', async () => {
      const biz = await newBusiness('free', null);
      const inv = await dueInvoice(biz);
      expect(await deliver(biz, inv)).toEqual({ outcome: 'skipped', reason: 'feature_not_on_plan' });
      expect(sendReminderMessage).not.toHaveBeenCalled();
    });

    it('cap reached: skipped, nothing sent', async () => {
      const biz = await newBusiness('billing_starter', null);
      const inv = await dueInvoice(biz);
      await fillQuota(biz);
      expect(await deliver(biz, inv)).toEqual({ outcome: 'skipped', reason: 'limit_reached' });
      expect(sendReminderMessage).not.toHaveBeenCalled();
    });

    it('usable paid plan: sent (also a Rs 1 plan)', async () => {
      await query(`UPDATE subscription_plans SET price_monthly = 1 WHERE id = 'billing_starter'`);
      try {
        const biz = await newBusiness('billing_starter', null);
        const inv = await dueInvoice(biz);
        expect(await deliver(biz, inv)).toEqual({ outcome: 'sent' });
        expect(sendReminderMessage).toHaveBeenCalledTimes(1);
      } finally {
        await query(`UPDATE subscription_plans SET price_monthly = 299 WHERE id = 'billing_starter'`);
      }
    });

    it('lapsed beyond grace: skipped, nothing sent; the invoice stays due so it resumes', async () => {
      const biz = await newBusiness('billing_starter', null);
      const inv = await dueInvoice(biz);
      await setPlan(biz, 'billing', 'billing_starter', { end: '-30 days', grace: '-23 days' });
      expect((await deliver(biz, inv)).outcome).toBe('skipped');
      expect(sendReminderMessage).not.toHaveBeenCalled();
      expect((await queryOne<{ payment_status: string }>(`SELECT payment_status FROM invoices WHERE id = $1`, [inv]))!.payment_status).toBe('unpaid');
      await setPlan(biz, 'billing', 'billing_starter');
      expect(await deliver(biz, inv)).toEqual({ outcome: 'sent' });
    });
  });

  describe('WhatsApp copy of a todo reminder', () => {
    async function todoFor(biz: string) {
      const userId = randomUUID();
      await query(`INSERT INTO users (id, business_id, name, phone) VALUES ($1, $2, 'Assignee', $3)`, [userId, biz, phone()]);
      return {
        userId,
        todo: {
          id: randomUUID(), business_id: biz, title: 'Call supplier', description: null, status: 'pending',
          assigned_to: userId, created_by: userId, due_date: new Date(), reminder_channels: ['whatsapp'],
        },
      };
    }

    it('no Connect feature: not sent', async () => {
      const biz = await newBusiness('billing_growth', 'connect_free');
      const { todo, userId } = await todoFor(biz);
      await trySendWhatsAppForTodo(todo, userId);
      expect(sendWhatsAppMessage).not.toHaveBeenCalled();
    });

    it('cap reached: not sent', async () => {
      const biz = await newBusiness('billing_growth', 'connect');
      const { todo, userId } = await todoFor(biz);
      await fillQuota(biz);
      await trySendWhatsAppForTodo(todo, userId);
      expect(sendWhatsAppMessage).not.toHaveBeenCalled();
    });

    it('usable Connect plan: sent; lapsed beyond grace: not sent', async () => {
      const biz = await newBusiness('billing_growth', 'connect');
      const { todo, userId } = await todoFor(biz);
      await trySendWhatsAppForTodo(todo, userId);
      expect(sendWhatsAppMessage).toHaveBeenCalledTimes(1);
      jest.mocked(sendWhatsAppMessage).mockClear();
      await setPlan(biz, 'connect', 'connect', { end: '-30 days', grace: '-23 days' });
      await trySendWhatsAppForTodo(todo, userId);
      expect(sendWhatsAppMessage).not.toHaveBeenCalled();
    });
  });


  // ---------------------------------------------------------------------------------------------
  // Round 2: the other automatic tenant senders.
  // ---------------------------------------------------------------------------------------------
  describe('round 2: other automatic senders', () => {
    const planPrice = async (id: string) =>
      (await queryOne<{ p: string }>(`SELECT price_monthly::text AS p FROM subscription_plans WHERE id = $1`, [id]))!.p;
    /** Run `fn` with plan `id` priced at Rs 1, restoring the price after. */
    async function withRs1Plan(id: string, fn: () => Promise<void>) {
      const keep = await planPrice(id);
      await query(`UPDATE subscription_plans SET price_monthly = 1 WHERE id = $1`, [id]);
      try { await fn(); } finally { await query(`UPDATE subscription_plans SET price_monthly = $1 WHERE id = $2`, [keep, id]); }
    }
    const lapse = (biz: string, plan: string, mod = 'billing') =>
      setPlan(biz, mod, plan, { end: '-30 days', grace: '-23 days' });
    async function addOwnerUser(biz: string): Promise<string> {
      const id = randomUUID();
      await query(
        `INSERT INTO users (id, business_id, name, phone, is_primary_admin) VALUES ($1, $2, 'Owner', $3, true)`,
        [id, biz, `9${Math.floor(Math.random() * 1e9).toString().padStart(9, '0')}`],
      );
      return id;
    }
    const waSent = () => jest.mocked(sendWhatsAppMessage).mock.calls.length;
    const eventTo = (biz: string, eventKey: string) =>
      notifyBusinessEvent({
        businessId: biz, eventKey: eventKey as never, to: `91${phone()}`,
        values: { customer_name: 'A' }, fallbackText: 'hello',
      });
    beforeEach(() => {
      jest.mocked(sendWhatsAppMessage).mockClear();
      jest.mocked(sendBusinessText).mockClear();
      jest.mocked(sendPlatformEventWhatsApp).mockClear();
    });

    // Fulfilment (order_*), returns (return_*), khata (khata_*, merchant_khata_*), store notices (store_*, merchant_new_*),
    // parcel-delay and dispatch alerts all go through notifyBusinessEvent; they differ in the plan feature they are sold under.
    describe.each([
      ['fulfilment update', 'order_confirmed', null],
      ['return notice', 'return_approved', null],
      ['khata notice', 'khata_opened', null],
      ['parcel-delay notice', 'order_delayed', null],
      ['merchant dispatch alert', 'merchant_dispatch_overdue', null],
      ['store order notice', 'store_order_paid', 'advanced_online_store'],
      ['store cart reminder', 'store_cart_reminder', 'advanced_online_store'],
      ['merchant new order', 'merchant_new_order', 'advanced_online_store'],
    ])('%s (%s)', (_label, eventKey, feature) => {
      const okPlan = feature ? 'billing_business' : 'billing_starter';
      if (feature) {
        it('plan without the feature: not sent, reason returned', async () => {
          const biz = await newBusiness('free', null);
          const r = await eventTo(biz, eventKey);
          expect(r).toMatchObject({ via: null, skipped: 'plan_does_not_include_feature' });
          expect(waSent()).toBe(0);
        });
      } else {
        it('no plan feature of its own: lapsed beyond grace means not sent, reason returned', async () => {
          const biz = await newBusiness('billing_starter', null);
          await lapse(biz, 'billing_starter');
          expect(await eventTo(biz, eventKey)).toMatchObject({ via: null, skipped: 'plan_not_usable' });
          expect(waSent()).toBe(0);
        });
      }
      it('cap reached: not sent', async () => {
        const biz = await newBusiness(okPlan, null);
        await fillQuota(biz);
        expect(await eventTo(biz, eventKey)).toMatchObject({ via: null, skipped: 'daily_whatsapp_limit_reached' });
        expect(waSent()).toBe(0);
      });
      it('usable plan (Rs 1): sent', async () => {
        await withRs1Plan(okPlan, async () => {
          const biz = await newBusiness(okPlan, null);
          expect(await eventTo(biz, eventKey)).toMatchObject({ via: 'qr' });
          expect(waSent()).toBe(1);
        });
      });
      if (feature) {
        it('lapsed beyond grace: not sent', async () => {
          const biz = await newBusiness(okPlan, null);
          await lapse(biz, okPlan);
          expect((await eventTo(biz, eventKey)).via).toBeNull();
          expect(waSent()).toBe(0);
        });
      }
    });

    it('a statement a person sends by hand (manual) skips the automation check; the nightly one does not', async () => {
      const biz = await newBusiness('billing_starter', null);
      await lapse(biz, 'billing_starter');
      const base = { businessId: biz, phone: `91${phone()}`, customerName: 'A', amountDue: 10, payBy: '2026-12-01', statementToken: 't', kind: 'statement' as const };
      expect((await sendKhataStatementMessage(base)).via).toBeNull();
      expect(waSent()).toBe(0);
      expect((await sendKhataStatementMessage({ ...base, manual: true })).via).toBe('qr');
    });

    describe('khata statements (nightly)', () => {
      it('cap reached: no message; usable plan (Rs 1): sent', async () => {
        const base = { phone: `91${phone()}`, customerName: 'A', amountDue: 10, payBy: '2026-12-01', statementToken: 't', kind: 'overdue' as const };
        const capped = await newBusiness('billing_starter', null);
        await fillQuota(capped);
        expect((await sendKhataStatementMessage({ ...base, businessId: capped })).via).toBeNull();
        expect(waSent()).toBe(0);
        await withRs1Plan('billing_starter', async () => {
          const ok = await newBusiness('billing_starter', null);
          expect((await sendKhataStatementMessage({ ...base, businessId: ok })).via).toBe('qr');
        });
      });
    });

    describe('credit alerts', () => {
      async function alertFor(biz: string) {
        await addOwnerUser(biz);
        const cust = randomUUID();
        await query(`INSERT INTO customers (id, business_id, name, phone) VALUES ($1, $2, 'Debtor', $3)`, [cust, biz, phone()]);
        await checkAndSendCreditAlerts(biz, 'customer', cust, 1000, 1200);
        return cust;
      }
      it('plan without whatsapp_credit_alerts: not sent', async () => {
        const biz = await newBusiness('free', null);
        await alertFor(biz);
        expect(waSent()).toBe(0);
      });
      it('cap reached: not sent', async () => {
        const biz = await newBusiness('billing_starter', null);
        await fillQuota(biz);
        await alertFor(biz);
        expect(waSent()).toBe(0);
      });
      it('lapsed beyond grace: not sent', async () => {
        const biz = await newBusiness('billing_starter', null);
        await lapse(biz, 'billing_starter');
        await alertFor(biz);
        expect(waSent()).toBe(0);
      });
      it('usable plan (Rs 1): sent; a skipped alert is sent once the plan allows (not logged as sent)', async () => {
        await withRs1Plan('billing_starter', async () => {
          const biz = await newBusiness('billing_starter', null);
          await lapse(biz, 'billing_starter');
          const cust = await alertFor(biz);
          expect(waSent()).toBe(0);
          await setPlan(biz, 'billing', 'billing_starter');
          await checkAndSendCreditAlerts(biz, 'customer', cust, 1000, 1200);
          expect(waSent()).toBe(1);
        });
      });
    });

    describe('payment-received message', () => {
      async function receipt(biz: string) {
        const customerId = randomUUID();
        const invoiceId = randomUUID();
        const paymentId = randomUUID();
        await query(`INSERT INTO customers (id, business_id, name, phone) VALUES ($1, $2, 'Cust', $3)`, [customerId, biz, phone()]);
        await query(
          `INSERT INTO invoices (id, business_id, customer_id, invoice_number, invoice_date, grand_total, balance_amount)
           VALUES ($1, $2, $3, $4, CURRENT_DATE, 100, 0)`,
          [invoiceId, biz, customerId, `INV-${invoiceId.slice(0, 6)}`],
        );
        await query(
          `INSERT INTO payments (id, business_id, type, reference_type, reference_id, amount, payment_date)
           VALUES ($1, $2, 'receivable', 'invoice', $3, 100, CURRENT_DATE)`,
          [paymentId, biz, invoiceId],
        );
        return paymentId;
      }
      it('plan without the feature: not sent, reason returned', async () => {
        const biz = await newBusiness('free', null);
        const r = await notifyInvoicePaymentReceived({ businessId: biz, paymentId: await receipt(biz), source: 'manual' });
        expect(r).toEqual({ sent: false, reason: 'plan_does_not_include_feature' });
        expect(waSent()).toBe(0);
      });
      it('cap reached: not sent', async () => {
        const biz = await newBusiness('billing_starter', null);
        await fillQuota(biz);
        const r = await notifyInvoicePaymentReceived({ businessId: biz, paymentId: await receipt(biz), source: 'manual' });
        expect(r).toEqual({ sent: false, reason: 'limit_reached' });
        expect(waSent()).toBe(0);
      });
      it('lapsed beyond grace: not sent; usable plan (Rs 1): sent', async () => {
        await withRs1Plan('billing_starter', async () => {
          const biz = await newBusiness('billing_starter', null);
          const pay = await receipt(biz);
          await lapse(biz, 'billing_starter');
          expect((await notifyInvoicePaymentReceived({ businessId: biz, paymentId: pay, source: 'manual' })).sent).toBe(false);
          expect(waSent()).toBe(0);
          await setPlan(biz, 'billing', 'billing_starter');
          expect(await notifyInvoicePaymentReceived({ businessId: biz, paymentId: pay, source: 'manual' })).toEqual({ sent: true });
          expect(waSent()).toBe(1);
        });
      });
    });

    describe('abandoned-cart reminder', () => {
      async function cart(biz: string) {
        const customerId = randomUUID();
        const cartId = randomUUID();
        await query(`INSERT INTO store_customers (id, business_id, phone, name) VALUES ($1, $2, $3, 'Shopper')`, [customerId, biz, phone()]);
        await query(
          `INSERT INTO store_carts (id, business_id, customer_id, items, subtotal, status, reminded_at)
           VALUES ($1, $2, $3, $4::jsonb, 10, 'open', now())`,
          [cartId, biz, customerId, JSON.stringify([{ item_id: randomUUID(), name: 'Tea', quantity: 1, price: 10 }])],
        );
        return { id: cartId, businessId: biz, customerId };
      }
      const due = (c: { id: string; businessId: string }) => ({
        id: c.id, businessId: c.businessId, phone: `91${phone()}`, customerName: 'Shopper', storeName: 'Shop',
        storeSubdomain: 'shop', subtotal: '10',
        lines: [{ item_id: randomUUID(), name: 'Tea', quantity: 1, price: 10 }],
      }) as never;
      it('plan without the online store: not sent, reason recorded, the cart is released to be reminded later', async () => {
        const biz = await newBusiness('free', null);
        const c = await cart(biz);
        const r = await sendCartReminder(due(c), 'auto');
        expect(r).toMatchObject({ sent: false, error: 'plan_plan_does_not_include_feature' });
        expect(waSent()).toBe(0);
        expect((await queryOne<{ reminded_at: string | null }>(`SELECT reminded_at FROM store_carts WHERE id = $1`, [c.id]))!.reminded_at).toBeNull();
      });
      it('cap reached: not sent; usable plan (Rs 1): sent', async () => {
        const capped = await newBusiness('billing_business', null);
        await fillQuota(capped);
        expect((await sendCartReminder(due(await cart(capped)), 'auto')).sent).toBe(false);
        expect(waSent()).toBe(0);
        await withRs1Plan('billing_business', async () => {
          const ok = await newBusiness('billing_business', null);
          expect((await sendCartReminder(due(await cart(ok)), 'auto')).sent).toBe(true);
          expect(waSent()).toBe(1);
        });
      });
    });

    describe('stuck-parcel notice cron', () => {
      async function stuckParcel(biz: string) {
        await query(
          `INSERT INTO business_settings (business_id) VALUES ($1) ON CONFLICT (business_id) DO NOTHING`, [biz]);
        const id = randomUUID();
        await query(
          `INSERT INTO order_fulfilments (id, business_id, status, public_token, buyer_phone, buyer_name, status_changed_at)
           VALUES ($1, $2, 'shipped', $3, $4, 'Buyer', now() - interval '10 days')`,
          [id, biz, `tok${id.slice(0, 20)}`, `91${phone()}`],
        );
        return id;
      }
      const run = () =>
        stuckParcelsPOST(new NextRequest('http://localhost/api/cron/stuck-parcels', {
          method: 'POST', headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
        }));
      beforeAll(() => { process.env.CRON_SECRET = process.env.CRON_SECRET || 'round2-secret'; });
      it('lapsed beyond grace: the parcel stays unclaimed and the notice goes out after the plan returns', async () => {
        const biz = await newBusiness('billing_starter', null);
        const id = await stuckParcel(biz);
        await lapse(biz, 'billing_starter');
        await run();
        expect(waSent()).toBe(0);
        const row = () => queryOne<{ stuck_notified_at: string | null }>(`SELECT stuck_notified_at FROM order_fulfilments WHERE id = $1`, [id]);
        expect((await row())!.stuck_notified_at).toBeNull();
        await setPlan(biz, 'billing', 'billing_starter');
        await run();
        expect(waSent()).toBeGreaterThanOrEqual(1);
        expect((await row())!.stuck_notified_at).not.toBeNull();
      });
      it('cap reached: parcel stays unclaimed', async () => {
        const biz = await newBusiness('billing_starter', null);
        const id = await stuckParcel(biz);
        await fillQuota(biz);
        await run();
        expect((await queryOne<{ stuck_notified_at: string | null }>(`SELECT stuck_notified_at FROM order_fulfilments WHERE id = $1`, [id]))!.stuck_notified_at).toBeNull();
      });
    });

    describe('Supplier Hub notices (sent from Khatario, no daily cap)', () => {
      async function queued(biz: string) {
        const id = randomUUID();
        await query(`INSERT INTO supplier_hub_whatsapp_outbox (id, business_id, title, path) VALUES ($1, $2, 'T', $3)`, [id, biz, `/p/${id}`]);
        return id;
      }
      const status = (id: string) =>
        queryOne<{ status: string; skip_reason: string | null }>(`SELECT status, skip_reason FROM supplier_hub_whatsapp_outbox WHERE id = $1`, [id]);
      it('plan without Supplier Hub: skipped with the reason recorded, row kept', async () => {
        const biz = await newBusiness('free', null);
        const id = await queued(biz);
        await flushHubWhatsApp();
        expect(await status(id)).toEqual({ status: 'skipped', skip_reason: 'PLAN_PLAN_DOES_NOT_INCLUDE_FEATURE' });
        expect(sendPlatformEventWhatsApp).not.toHaveBeenCalledWith(expect.objectContaining({ eventKey: 'supplier_hub_update' }));
      });
      it('lapsed beyond grace: skipped; usable plan (Rs 1): sent; the cap does not apply', async () => {
        const lapsed = await newBusiness('billing_starter', null);
        await lapse(lapsed, 'billing_starter');
        const lid = await queued(lapsed);
        await withRs1Plan('billing_starter', async () => {
          const capped = await newBusiness('billing_starter', null);
          await fillQuota(capped);
          const cid = await queued(capped);
          await flushHubWhatsApp();
          expect((await status(lid))!.status).toBe('skipped');
          expect((await status(cid))!.status).toBe('sent');
        });
      });
    });

    describe('owner updates: evening summary and owner replies (count against the cap)', () => {
      async function linkedOwner(biz: string) {
        const owner = await addOwnerUser(biz);
        await query(
          `INSERT INTO owner_whatsapp_links (business_id, user_id, linked_phone, daily_summary_enabled, last_owner_message_at)
           VALUES ($1, $2, '919800000002', true, now())`, [biz, owner]);
        return owner;
      }
      const link = (biz: string) =>
        queryOne<{ last_summary_sent_on: string | null; last_summary_error: string | null }>(
          `SELECT last_summary_sent_on::text, last_summary_error FROM owner_whatsapp_links WHERE business_id = $1`, [biz]);
      const textJob = (biz: string) =>
        ({ type: 'owner-command', kind: 'owner', provider: 'cloud', businessId: biz, messageId: `m-${randomUUID()}`,
           conversationId: 'owner_x', timestamp: Date.now(), from: '919800000002', text: 'help', selfChat: false }) as never;

      it('summary: cap reached means not sent, reason recorded, day not marked sent', async () => {
        const biz = await newBusiness('billing_starter', null);
        await linkedOwner(biz);
        await fillQuota(biz);
        expect(await sendOwnerSummary(biz)).toEqual({ sent: false, reason: 'plan' });
        expect(await link(biz)).toEqual({ last_summary_sent_on: null, last_summary_error: 'plan:daily_whatsapp_limit_reached' });
        expect(sendBusinessText).not.toHaveBeenCalled();
      });
      it('summary: feature off or lapsed means not sent; a person pressing "send test now" is not blocked by the cap; Rs 1 plan sends', async () => {
        const off = await newBusiness('billing_starter', null);
        await linkedOwner(off);
        await query(`UPDATE subscription_plan_features SET enabled = false WHERE plan_id = 'billing_starter' AND feature_id = 'settings_whatsapp'`);
        try {
          expect(await sendOwnerSummary(off)).toEqual({ sent: false, reason: 'plan' });
          expect((await link(off))!.last_summary_error).toBe('plan:plan_does_not_include_feature');
        } finally {
          await query(`UPDATE subscription_plan_features SET enabled = true WHERE plan_id = 'billing_starter' AND feature_id = 'settings_whatsapp'`);
        }
        const lapsed = await newBusiness('billing_starter', null);
        await linkedOwner(lapsed);
        await lapse(lapsed, 'billing_starter');
        expect((await sendOwnerSummary(lapsed)).sent).toBe(false);
        const capped = await newBusiness('billing_starter', null);
        await linkedOwner(capped);
        await fillQuota(capped);
        expect((await sendOwnerSummary(capped, { force: true })).sent).toBe(true);
        await withRs1Plan('billing_starter', async () => {
          const ok = await newBusiness('billing_starter', null);
          await linkedOwner(ok);
          expect((await sendOwnerSummary(ok)).sent).toBe(true);
          expect((await link(ok))!.last_summary_sent_on).not.toBeNull();
        });
      });
      it('owner reply: cap reached means no reply; usable plan (Rs 1) replies; lapsed means no reply', async () => {
        const capped = await newBusiness('billing_starter', null);
        await linkedOwner(capped);
        await fillQuota(capped);
        await processOwnerCommand(textJob(capped));
        expect(sendBusinessText).not.toHaveBeenCalled();
        expect((await skippedLog(capped))!.reason).toBe('automation_skipped:daily_whatsapp_limit_reached');

        const lapsed = await newBusiness('billing_starter', null);
        await linkedOwner(lapsed);
        await lapse(lapsed, 'billing_starter');
        await processOwnerCommand(textJob(lapsed));
        expect(sendBusinessText).not.toHaveBeenCalled();

        await withRs1Plan('billing_starter', async () => {
          const ok = await newBusiness('billing_starter', null);
          await linkedOwner(ok);
          await processOwnerCommand(textJob(ok));
          expect(sendBusinessText).toHaveBeenCalledTimes(1);
        });
      });
    });
  });

  describe('guard', () => {
    it('fails closed when the plan check throws', async () => {
      const sub = await import('@/lib/subscription');
      const spy = jest.spyOn(sub, 'hasWhatsAppBotAddon').mockRejectedValueOnce(new Error('db down'));
      const d = await checkAutomationAllowed(randomUUID(), 'connect_automation');
      expect(d).toMatchObject({ allowed: false, reason: 'plan_check_failed' });
      spy.mockRestore();
    });
  });
});
