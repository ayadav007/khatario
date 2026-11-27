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
jest.mock('@/lib/queue/redis', () => ({ getRedisConnection: () => null }));
jest.mock('@/lib/whatsapp', () => ({
  sendWhatsAppMessage: jest.fn(async () => 'wa-id'),
  getWhatsAppStatus: jest.fn(async () => ({ status: 'connected' })),
}));
jest.mock('@/lib/whatsapp/business-transport', () => ({
  ...jest.requireActual('@/lib/whatsapp/business-transport'),
  businessTransport: jest.fn(async () => 'baileys'),
  sendBusinessText: jest.fn(async () => ({ messageId: 'bt-1' })),
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
