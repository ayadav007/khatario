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
import { withWhatsAppSlot, WhatsAppSlotRefused } from '@/lib/whatsapp/send-slot';
import { releaseCustomerBotReply, reserveCustomerBotReply, repliesToday } from '@/lib/whatsapp/customer-bot';
import { reserveKhatarioReply, reserveTrialReply } from '@/lib/ai-agent/billing';
import { KHATARIO_AI_TRIAL_REPLIES } from '@/lib/ai-agent/billing-constants';

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

    it('daily WhatsApp cap reached: the reply to the customer is still sent (replies are not refused by the cap)', async () => {
      const biz = await newBusiness('billing_growth', 'connect');
      await addKeywordRule(biz);
      await fillQuota(biz);
      const { result } = await inbound(biz, 'hello');
      expect(result.response).toBe('Hi from the bot');
      expect((await skippedLog(biz))!.n).toBe('0');
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

    it('cap reached: the flow still replies', async () => {
      const biz = await newBusiness('billing_growth', 'connect');
      await addFlow(biz);
      await fillQuota(biz);
      expect((await inbound(biz, 'flowtest')).result.response).toBe('Flow hello');
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

    it('bot reply is still delivered at the cap, and not after a lapse beyond grace', async () => {
      const capped = await newBusiness('billing_growth', 'connect');
      await addKeywordRule(capped);
      await fillQuota(capped);
      await processCloudIncoming(job(capped));
      expect(sendBusinessText).toHaveBeenCalledTimes(1);
      jest.mocked(sendBusinessText).mockClear();
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
      expect(sendShopOrderReply).toHaveBeenCalledTimes(1); // a reply to the customer's cart is not refused by the cap
      jest.mocked(sendShopOrderReply).mockClear();

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
      ['store order notice', 'store_order_paid', null],
      ['store cart reminder', 'store_cart_reminder', null],
      ['merchant new order', 'merchant_new_order', null],
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
      it('no plan feature needed (as before): the Free plan sends; a lapsed plan does not, with its reason', async () => {
        const free = await newBusiness('free', null);
        expect(await notifyInvoicePaymentReceived({ businessId: free, paymentId: await receipt(free), source: 'manual' })).toEqual({ sent: true });
        jest.mocked(sendWhatsAppMessage).mockClear();
        const biz = await newBusiness('billing_starter', null);
        const pay = await receipt(biz);
        await lapse(biz, 'billing_starter');
        expect(await notifyInvoicePaymentReceived({ businessId: biz, paymentId: pay, source: 'manual' })).toEqual({ sent: false, reason: 'plan_not_usable' });
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
      it('lapsed plan: not sent, reason recorded, the cart is released to be reminded later', async () => {
        const biz = await newBusiness('billing_business', null);
        const c = await cart(biz);
        await lapse(biz, 'billing_business');
        const r = await sendCartReminder(due(c), 'auto');
        expect(r).toMatchObject({ sent: false, error: 'plan_plan_not_usable' });
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
      it('lapsed plan: skipped with the reason recorded, row kept (Free plan has no feature requirement and sends)', async () => {
        const biz = await newBusiness('billing_starter', null);
        await lapse(biz, 'billing_starter');
        const id = await queued(biz);
        await flushHubWhatsApp();
        expect(await status(id)).toEqual({ status: 'skipped', skip_reason: 'PLAN_PLAN_NOT_USABLE' });
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
      it('summary: lapsed means not sent; a person pressing "send test now" is not blocked by the cap; Rs 1 plan sends', async () => {
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
      it('owner reply: still sent at the cap (a reply to the owner is not refused by it); lapsed means no reply; Rs 1 plan replies', async () => {
        const capped = await newBusiness('billing_starter', null);
        await linkedOwner(capped);
        await fillQuota(capped);
        await processOwnerCommand(textJob(capped));
        expect(sendBusinessText).toHaveBeenCalledTimes(1);
        jest.mocked(sendBusinessText).mockClear();

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


  // ---------------------------------------------------------------------------------------------
  // Round 3: places under the daily cap are reserved atomically, and bot replies count.
  // ---------------------------------------------------------------------------------------------
  describe('round 3: atomic reservation under the daily cap', () => {
    const capOf = async (biz: string) => (await checkLimit(biz, 'whatsapp'));
    const count = async (sqlAfterFrom: string, params: unknown[]) =>
      Number((await queryOne<{ n: string }>(`SELECT COUNT(*)::text AS n FROM ${sqlAfterFrom}`, params))!.n);
    /** Leave exactly `left` messages under today's cap. */
    async function leaveRoom(biz: string, left: number) {
      const c = await capOf(biz);
      for (let i = c.current; i < (c.limit as number) - left; i++) {
        await query(`INSERT INTO whatsapp_messages (business_id, to_number, message_type, status) VALUES ($1, $2, 'text', 'sent')`, [biz, phone()]);
      }
      clearSubscriptionCache(biz);
    }
    const cloudJob = (biz: string, text = 'hello') => ({
      businessId: biz, businessPhone: '919999999999', from: `91${phone()}`, messageId: `wamid-${randomUUID()}`,
      messageType: 'text', text, profileName: 'Cust',
    }) as never;
    beforeEach(() => {
      jest.mocked(sendWhatsAppMessage).mockReset().mockImplementation(async () => 'wa-id' as never);
      jest.mocked(sendBusinessText).mockReset().mockImplementation(async () => ({ messageId: 'bt-1' }) as never);
    });

    it('two concurrent automatic notices at cap - 1: exactly one is sent', async () => {
      const biz = await newBusiness('billing_starter', null);
      await leaveRoom(biz, 1);
      jest.mocked(sendWhatsAppMessage).mockImplementation(async () => { await new Promise((r) => setTimeout(r, 150)); return 'x' as never; });
      const ev = () => notifyBusinessEvent({ businessId: biz, eventKey: 'order_confirmed', to: `91${phone()}`, values: {}, fallbackText: 'hi' });
      const results = await Promise.all([ev(), ev(), ev()]);
      expect(results.filter((r) => r.via).length).toBe(1);
      expect(results.filter((r) => r.skipped === 'daily_whatsapp_limit_reached').length).toBe(2);
      expect(jest.mocked(sendWhatsAppMessage)).toHaveBeenCalledTimes(1);
      const c = await capOf(biz);
      expect(c.current).toBe(c.limit);
    });

    it('bot replies are not counted and not refused: at the cap they are still sent and the count does not move', async () => {
      const biz = await newBusiness('billing_growth', 'connect');
      await addKeywordRule(biz);
      await leaveRoom(biz, 1);
      const before = (await capOf(biz)).current;
      for (let i = 0; i < 3; i++) await processCloudIncoming(cloudJob(biz));
      expect(sendBusinessText).toHaveBeenCalledTimes(3);
      expect((await capOf(biz)).current).toBe(before); // replies do not move the count
      expect(await count(`whatsapp_messages WHERE business_id = $1 AND message_type = 'bot_reply'`, [biz])).toBe(0);
      // ...but a proactive notice still takes the last place, and the next one is refused
      const ev = () => notifyBusinessEvent({ businessId: biz, eventKey: 'order_confirmed', to: `91${phone()}`, values: {}, fallbackText: 'hi' });
      expect((await ev()).via).toBe('qr');
      expect(await ev()).toMatchObject({ via: null, skipped: 'daily_whatsapp_limit_reached' });
      // and bot replies still go out with the cap used up
      await processCloudIncoming(cloudJob(biz));
      expect(sendBusinessText).toHaveBeenCalledTimes(4);
    });

    it('rows left sending for more than 10 minutes are swept to failed and stop counting; fresh ones are left', async () => {
      const biz = await newBusiness('billing_starter', null);
      const old = randomUUID();
      const fresh = randomUUID();
      await query(`INSERT INTO whatsapp_messages (id, business_id, to_number, message_type, status, sent_at) VALUES ($1, $2, '91', 'notice', 'sending', CURRENT_TIMESTAMP - INTERVAL '11 minutes')`, [old, biz]);
      await query(`INSERT INTO whatsapp_messages (id, business_id, to_number, message_type, status) VALUES ($1, $2, '91', 'notice', 'sending')`, [fresh, biz]);
      expect((await capOf(biz)).current).toBe(2);
      const { sweepStaleWhatsAppSlots } = await import('@/lib/whatsapp/send-slot');
      expect(await sweepStaleWhatsAppSlots()).toBeGreaterThanOrEqual(1);
      clearSubscriptionCache(biz);
      expect((await capOf(biz)).current).toBe(1);
      const rows = await query(`SELECT id, status, sent_at FROM whatsapp_messages WHERE business_id = $1`, [biz]);
      const by = (id: string) => rows.rows.find((r: { id: string }) => r.id === id);
      expect(by(old)).toMatchObject({ status: 'failed', sent_at: null });
      expect(by(fresh).status).toBe('sending');
      await sweepStaleWhatsAppSlots(); // a second run changes nothing
      expect((await capOf(biz)).current).toBe(1);
    });

    it('notifyBusinessEvent never throws: an unexpected error is answered with { via: null }', async () => {
      const biz = await newBusiness('billing_starter', null);
      const { enqueueCustomerPush } = await import('@/lib/push/customer-push');
      jest.mocked(enqueueCustomerPush).mockRejectedValueOnce(new Error('push lookup exploded'));
      await expect(notifyBusinessEvent({ businessId: biz, eventKey: 'order_confirmed', to: `91${phone()}`, values: {}, fallbackText: 'x' }))
        .resolves.toEqual({ via: null });
    });

    it('a statement reminder is one reservation: every bill listed is logged in it, and a refusal sends nothing', async () => {
      const { sendStatementReminder } = await import('@/lib/payment-reminders/statement');
      async function setup() {
        const biz = await newBusiness('billing_starter', null);
        const customerId = randomUUID();
        await query(`INSERT INTO customers (id, business_id, name, phone) VALUES ($1, $2, 'Stmt', $3)`, [customerId, biz, phone()]);
        const bills: string[] = [];
        for (let i = 0; i < 3; i++) {
          const id = randomUUID();
          bills.push(id);
          await query(
            `INSERT INTO invoices (id, business_id, customer_id, invoice_number, invoice_date, due_date, status, payment_status, grand_total, balance_amount)
             VALUES ($1, $2, $3, $4, CURRENT_DATE - 20, CURRENT_DATE - 10, 'final', 'unpaid', 100, 100)`,
            [id, biz, customerId, `S-${id.slice(0, 6)}`]);
        }
        return { biz, customerId, chased: bills.slice(0, 2).map((invoiceId) => ({ invoiceId, source: 'auto_overdue' as const })) };
      }
      const a = await setup();
      await leaveRoom(a.biz, 2); // two places left, three bills listed: refused as a whole
      expect(await sendStatementReminder({ businessId: a.biz, customerId: a.customerId, chased: a.chased, scheduled: true }))
        .toMatchObject({ outcome: 'skipped', reason: 'limit_reached' });
      expect(jest.mocked(sendWhatsAppMessage)).not.toHaveBeenCalled();
      expect(await count(`whatsapp_messages WHERE business_id = $1 AND batch_id IS NOT NULL`, [a.biz])).toBe(0);

      const b = await setup();
      await leaveRoom(b.biz, 3);
      const before = (await capOf(b.biz)).current;
      const ok = await sendStatementReminder({ businessId: b.biz, customerId: b.customerId, chased: b.chased, scheduled: true });
      expect(['sent', 'failed']).toContain(ok.outcome);
      const rows = await query(`SELECT batch_id FROM whatsapp_messages WHERE business_id = $1 AND message_type = 'reminder' AND batch_id IS NOT NULL`, [b.biz]);
      expect(rows.rows).toHaveLength(3); // every bill listed is logged...
      expect(new Set(rows.rows.map((r: { batch_id: string }) => r.batch_id)).size).toBe(1); // ...in one batch, reserved together
      if (ok.outcome === 'sent') expect((await capOf(b.biz)).current).toBe(before + 3);
      else expect((await capOf(b.biz)).current).toBe(before); // a failed send gives all of it back
    });

    it('a failed send does not use up the quota, and the failed attempt stays on record', async () => {
      const biz = await newBusiness('billing_starter', null);
      jest.mocked(sendWhatsAppMessage).mockRejectedValueOnce(new Error('socket closed'));
      const r = await notifyBusinessEvent({ businessId: biz, eventKey: 'order_confirmed', to: `91${phone()}`, values: {}, fallbackText: 'hi' });
      expect(r.via).toBeNull();
      expect((await capOf(biz)).current).toBe(0);
      expect(await count(`whatsapp_messages WHERE business_id = $1 AND status = 'failed' AND sent_at IS NULL`, [biz])).toBe(1);
      expect((await notifyBusinessEvent({ businessId: biz, eventKey: 'order_confirmed', to: `91${phone()}`, values: {}, fallbackText: 'hi' })).via).toBe('qr');
      expect((await capOf(biz)).current).toBe(1);
    });

    it('a bot reply whose send throws gives its place back', async () => {
      const biz = await newBusiness('billing_growth', 'connect');
      await addKeywordRule(biz);
      jest.mocked(sendBusinessText).mockRejectedValueOnce(new Error('meta down'));
      await processCloudIncoming(cloudJob(biz));
      expect((await capOf(biz)).current).toBe(0);
    });

    it('a campaign recipient is counted once, and a campaign stops (recipients stay pending) when the reserved place is refused', async () => {
      const biz = await newBusiness('billing_growth', 'connect');
      await leaveRoom(biz, 1);
      const id = randomUUID();
      await query(
        `INSERT INTO whatsapp_campaigns (id, business_id, name, message_type, message_text, status, total_recipients, pending_count,
            delay_between_messages, random_delay_jitter, batch_size, pause_between_batches, started_at)
         VALUES ($1, $2, 'c', 'text', 'Hello', 'running', 2, 2, 1, 0, 20, 0, CURRENT_TIMESTAMP)`, [id, biz]);
      for (let i = 0; i < 2; i++) await query(`INSERT INTO whatsapp_campaign_recipients (campaign_id, phone, name) VALUES ($1, $2, 'R')`, [id, phone()]);
      const { processCampaign } = await import('@/lib/campaign-processor');
      const r = await processCampaign(id);
      expect(r.sent).toBe(1);
      expect(jest.mocked(sendWhatsAppMessage)).toHaveBeenCalledTimes(1);
      expect((await capOf(biz)).current).toBe((await capOf(biz)).limit);
      expect(await count(`whatsapp_campaign_recipients WHERE campaign_id = $1 AND status = 'pending'`, [id])).toBe(1);
    });

    it('the slot refuses with WhatsAppSlotRefused at the cap and sends nothing', async () => {
      const biz = await newBusiness('billing_starter', null);
      await fillQuota(biz);
      const fn = jest.fn(async () => 'x');
      await expect(withWhatsAppSlot(biz, { to: '9100000000', messageType: 'notice' }, fn)).rejects.toBeInstanceOf(WhatsAppSlotRefused);
      expect(fn).not.toHaveBeenCalled();
    });

    describe('AI replies', () => {
      it('concurrent replies at the daily limit: exactly one takes the slot; a released slot is free again', async () => {
        const biz = await newBusiness('billing_starter', null);
        const caps = { dailyLimit: 1, monthlyQuota: -1 };
        const results = await Promise.all([1, 2, 3, 4].map(() => reserveCustomerBotReply(biz, phone(), caps)));
        const ok = results.filter((r) => r.ok);
        expect(ok).toHaveLength(1);
        expect(await repliesToday(biz)).toBe(1);
        await releaseCustomerBotReply(biz, (ok[0] as { messageId: string }).messageId);
        expect(await repliesToday(biz)).toBe(0);
        expect((await reserveCustomerBotReply(biz, phone(), caps)).ok).toBe(true);
      });

      it('concurrent trial replies at the last trial slot: exactly one; releasing gives it back', async () => {
        const biz = await newBusiness('billing_starter', null);
        await query(
          `INSERT INTO assistant_settings (scope, settings) VALUES ($1, $2::jsonb)
           ON CONFLICT (scope) DO UPDATE SET settings = EXCLUDED.settings`,
          [`business:${biz}`, JSON.stringify({ khatarioAiTrialUsed: KHATARIO_AI_TRIAL_REPLIES - 1 })]);
        const got = await Promise.all([reserveTrialReply(biz), reserveTrialReply(biz), reserveTrialReply(biz)]);
        expect(got.filter(Boolean)).toHaveLength(1);
        const used = async () => Number((await queryOne<{ u: string }>(`SELECT settings->>'khatarioAiTrialUsed' AS u FROM assistant_settings WHERE scope = $1`, [`business:${biz}`]))!.u);
        expect(await used()).toBe(KHATARIO_AI_TRIAL_REPLIES);
        const { releaseTrialReply } = await import('@/lib/ai-agent/billing');
        await releaseTrialReply(biz);
        expect(await used()).toBe(KHATARIO_AI_TRIAL_REPLIES - 1);
      });

      it('reserveKhatarioReply on a trial: two racing at the last slot, one wins', async () => {
        process.env.GROQ_API_KEY = process.env.GROQ_API_KEY || 'test-key';
        const biz = await newBusiness('billing_starter', null);
        await query(
          `INSERT INTO assistant_settings (scope, settings) VALUES ($1, $2::jsonb)
           ON CONFLICT (scope) DO UPDATE SET settings = EXCLUDED.settings`,
          [`business:${biz}`, JSON.stringify({ khatarioAiTrialUsed: KHATARIO_AI_TRIAL_REPLIES - 1 })]);
        const r = await Promise.all([reserveKhatarioReply(biz, phone(), { live: false }), reserveKhatarioReply(biz, phone(), { live: false })]);
        expect(r.filter((x) => x.ok)).toHaveLength(1);
        expect(r.filter((x) => !x.ok && x.reason === 'trial_exhausted')).toHaveLength(1);
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
