import { NextRequest, NextResponse } from 'next/server';
import { queryOne, getPool } from '@/lib/db';
import { resolveStoreBySubdomain } from '@/lib/store/resolve-store';
import { buildStoreQuote } from '@/lib/store/quote';
import {
  getBusinessPaymentProviderConfig,
  getPreferredConfiguredProvider,
} from '@/lib/payments/business-provider-config';
import { RazorpayPaymentProvider } from '@/lib/payments/providers/razorpay-payment-provider';
import { EasebuzzPaymentProvider } from '@/lib/payments/providers/easebuzz-payment-provider';
import type { StoreOnlinePaymentProvider } from '@/lib/store/fulfill-paid-order';

const STORE_ONLINE_PROVIDERS: readonly StoreOnlinePaymentProvider[] = ['razorpay', 'easebuzz'];
import { readStoreCustomer, STORE_CUSTOMER_COOKIE } from '@/lib/store/customer-session';
import { storePhonesMatch, storePhoneDigits } from '@/lib/store/store-phone';
import { hasFeatureAccess } from '@/lib/subscription/feature-access';
import { FeatureKeys } from '@/lib/featureKeys';
import { validateStoreOrderLines } from '@/lib/store/fulfillment-rules';
import { reserveStoreOrderNumber } from '@/lib/store/order-lifecycle';
import {
  checkStoreCartStock,
  holdStoreOrderStock,
  shortfallMessage,
  STORE_ONLINE_HOLD_MINUTES,
} from '@/lib/store/checkout-stock';
import { notifyStoreEvent } from '@/lib/store/notify-whatsapp';
import { getBusinessUpiVpa, upiAppLinks } from '@/lib/payments/upi-pay-link';
import { claimStoreCouponUse } from '@/lib/store/coupons';
import { todayIst } from '@/lib/gst/time-limits';
import { decideKhataOrder } from '@/lib/khata/rules';
import { khataPayBy, khataStatementDateFor, khataShortDate } from '@/lib/khata/cycle';
import {
  effectiveKhataRules,
  getKhataSettings,
  khataCustomerForShopper,
  khataOverdueAmount,
  khataPendingOrdersTotal,
  loadKhataCustomer,
} from '@/lib/khata/service';

export const dynamic = 'force-dynamic';

/** Open COD / UPI orders one shopper may have before paying or cancelling one. */
const MAX_OPEN_UNPAID_ORDERS = 3;

export async function POST(
  request: NextRequest,
  { params }: { params: { subdomain: string } },
) {
  const pool = getPool();
  const client = await pool.connect();

  try {
    const store = await resolveStoreBySubdomain(params.subdomain);
    if (!store) {
      return NextResponse.json({ error: 'Store not found' }, { status: 404 });
    }
    if (store.is_demo) {
      return NextResponse.json({ error: 'This is a theme preview. Checkout is disabled.' }, { status: 403 });
    }

    const body = await request.json();
    const paymentMethod: 'online' | 'upi' | 'cod' | 'khata' =
      body.payment_method === 'online' || body.payment_method === 'razorpay'
        ? 'online'
        : body.payment_method === 'upi'
          ? 'upi'
          : body.payment_method === 'khata'
            ? 'khata'
            : 'cod';

    const upiVpa = paymentMethod === 'upi' ? await getBusinessUpiVpa(store.business_id) : null;
    if (paymentMethod === 'upi' && !upiVpa) {
      return NextResponse.json(
        { error: 'UPI payment is not available for this store. Please choose another payment option.' },
        { status: 400 },
      );
    }

    let gateway: { providerId: StoreOnlinePaymentProvider; cfg: NonNullable<Awaited<ReturnType<typeof getBusinessPaymentProviderConfig>>> } | null = null;
    if (paymentMethod === 'online') {
      const payOk = await hasFeatureAccess(store.business_id, FeatureKeys.PAYMENT_GATEWAY);
      const providerId = payOk
        ? ((await getPreferredConfiguredProvider(store.business_id, STORE_ONLINE_PROVIDERS)) as StoreOnlinePaymentProvider | null)
        : null;
      const cfg = providerId ? await getBusinessPaymentProviderConfig(store.business_id, providerId) : null;
      if (!providerId || !cfg?.clientId || !cfg.clientSecret) {
        return NextResponse.json(
          { error: 'Online payment is not available for this store. Please choose another payment option.' },
          { status: 400 },
        );
      }
      gateway = { providerId, cfg };
    }

    if (paymentMethod === 'cod') {
      const allow = await queryOne<{ store_allow_cod: boolean }>(
        `SELECT COALESCE(store_allow_cod, true) AS store_allow_cod
         FROM business_settings WHERE business_id = $1`,
        [store.business_id],
      );
      if (allow && allow.store_allow_cod === false) {
        return NextResponse.json(
          { error: 'Pay on delivery is not available' },
          { status: 400 },
        );
      }
    }

    const cart = validateStoreOrderLines(body.items);
    if (!cart.ok) {
      return NextResponse.json({ error: cart.error }, { status: 400 });
    }

    const quote = await buildStoreQuote({
      businessId: store.business_id,
      minOrderAmount: store.store_min_order_amount,
      branchId: body.branch_id,
      items: cart.lines,
      deliveryMode: body.delivery_mode === 'pickup' ? 'pickup' : 'delivery',
      pincode: body.customer_pincode,
      customerLat: body.customer_lat != null ? Number(body.customer_lat) : null,
      customerLng: body.customer_lng != null ? Number(body.customer_lng) : null,
      couponCode: body.coupon_code,
    });

    if (!quote.serviceable) {
      return NextResponse.json({ error: quote.error || 'Not serviceable' }, { status: 400 });
    }

    const customer_name = String(body.customer_name ?? '').trim();
    const customer_phone = storePhoneDigits(String(body.customer_phone ?? ''));
    if (!customer_name) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }
    if (customer_phone.length !== 10) {
      return NextResponse.json({ error: 'Phone number is required' }, { status: 400 });
    }
    if (body.delivery_mode !== 'pickup' && !String(body.customer_address ?? '').trim()) {
      return NextResponse.json({ error: 'Delivery address is required' }, { status: 400 });
    }

    const session = readStoreCustomer(request.cookies.get(STORE_CUSTOMER_COOKIE)?.value);
    if (!session || session.businessId !== store.business_id) {
      return NextResponse.json(
        { error: 'Verify your number to place an order' },
        { status: 401 },
      );
    }
    const verified = await queryOne<{ id: string; phone: string }>(
      `SELECT id, phone FROM store_customers WHERE id = $1 AND business_id = $2`,
      [session.customerId, store.business_id],
    );
    if (!verified || !storePhonesMatch(verified.phone, customer_phone)) {
      return NextResponse.json(
        { error: 'Verify the mobile number you entered' },
        { status: 401 },
      );
    }
    const storeCustomerId = verified.id;

    // Khata: only a customer the business opened a khata for, found from the verified sign-in.
    const khataCustomer =
      paymentMethod === 'khata' ? await khataCustomerForShopper(store.business_id, storeCustomerId) : null;
    if (
      paymentMethod === 'khata' &&
      (!khataCustomer || !khataCustomer.khata_enabled || khataCustomer.khata_settlement_day == null)
    ) {
      return NextResponse.json(
        {
          error: 'Khata is not open for this number. Ask the shop to open one, or choose another way to pay.',
          code: 'KHATA_NOT_OPEN',
        },
        { status: 400 },
      );
    }

    // COD and UPI orders hold stock until invoiced or cancelled, so one shopper must not be able
    // to tie up the whole store with unpaid orders.
    if (paymentMethod !== 'online') {
      const open = await queryOne<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM store_orders
          WHERE business_id = $1 AND store_customer_id = $2
            AND payment_status IN ('cod', 'unpaid')
            AND status <> 'cancelled' AND invoice_id IS NULL`,
        [store.business_id, storeCustomerId],
      );
      if (Number(open?.n ?? 0) >= MAX_OPEN_UNPAID_ORDERS) {
        return NextResponse.json(
          { error: 'You already have orders waiting for payment. Please complete or cancel them first.', code: 'TOO_MANY_OPEN_ORDERS' },
          { status: 429 },
        );
      }
    }

    await client.query('BEGIN');
    // Lock and compare against what is left (on-hand minus other orders' holds) before saving.
    const shortfall = await checkStoreCartStock(client, {
      businessId: store.business_id,
      branchId: body.branch_id ?? null,
      lines: quote.lines,
    });
    if (shortfall.length > 0) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: shortfallMessage(shortfall), code: 'OUT_OF_STOCK', shortfall },
        { status: 409 },
      );
    }
    let khata: {
      customerId: string;
      dueDate: string;
      payBy: string;
      approval: 'pending' | null;
      reason: string | null;
      warned: boolean;
    } | null = null;
    if (paymentMethod === 'khata' && khataCustomer) {
      // Lock the customer so two orders at once cannot both slip under the limit.
      const locked = await loadKhataCustomer(store.business_id, khataCustomer.id, client, true);
      if (!locked || !locked.khata_enabled || locked.khata_settlement_day == null) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { error: 'Khata is not open for this number. Choose another way to pay.', code: 'KHATA_NOT_OPEN' },
          { status: 400 },
        );
      }
      const settings = await getKhataSettings(store.business_id, client);
      const rules = effectiveKhataRules(locked, settings);
      const today = todayIst();
      const overdue = await khataOverdueAmount(store.business_id, locked.id, settings.graceDays, today, client);
      const pending = await khataPendingOrdersTotal(store.business_id, locked.id, client);
      const decision = decideKhataOrder({
        balance: Number(locked.current_balance ?? 0) || 0,
        pendingOrders: pending,
        orderTotal: quote.grand_total,
        creditLimit: Number(locked.credit_limit ?? 0) || 0,
        overdueAmount: overdue.amount,
        overLimitRule: rules.overLimitRule,
        overdueRule: rules.overdueRule,
      });
      if (decision.outcome === 'block') {
        await client.query('ROLLBACK');
        const owed = Math.max(0, Number(locked.current_balance ?? 0) || 0);
        const message = decision.overdue
          ? `Khata is paused because ₹${overdue.amount.toLocaleString('en-IN')} is overdue. Please pay the shop, or choose another way to pay.`
          : `This order takes your khata ₹${decision.overBy.toLocaleString('en-IN')} over its limit. Please pay the ₹${owed.toLocaleString('en-IN')} you owe, or choose another way to pay.`;
        return NextResponse.json(
          {
            error: message,
            code: 'KHATA_BLOCKED',
            reason: decision.reason,
            overdue_amount: overdue.amount,
            over_by: decision.overBy,
          },
          { status: 409 },
        );
      }
      const dueDate = khataStatementDateFor(today, locked.khata_settlement_day);
      khata = {
        customerId: locked.id,
        dueDate,
        payBy: khataPayBy(dueDate, settings.graceDays),
        approval: decision.outcome === 'approval' ? 'pending' : null,
        reason: decision.reason,
        warned: decision.outcome === 'warn',
      };
    }

    const orderNum = await reserveStoreOrderNumber(client, store.business_id);

    const order = await client.query(
      `INSERT INTO store_orders
         (business_id, branch_id, order_number,
          customer_name, customer_phone, customer_email,
          customer_address, customer_pincode, customer_lat, customer_lng,
          delivery_mode, notes,
          subtotal, tax_total, delivery_charge, discount_amount, coupon_code, grand_total,
          payment_status, quoted_delivery_fee, store_customer_id, payment_provider,
          khata_customer_id, khata_due_date, khata_approval, khata_approval_reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)
       RETURNING id, order_number`,
      [
        store.business_id,
        body.branch_id ?? null,
        orderNum,
        customer_name,
        customer_phone,
        body.customer_email?.trim() ?? null,
        body.customer_address?.trim() ?? null,
        body.customer_pincode?.trim() ?? null,
        body.customer_lat ?? null,
        body.customer_lng ?? null,
        body.delivery_mode === 'pickup' ? 'pickup' : 'delivery',
        body.notes?.trim() ?? null,
        quote.subtotal,
        quote.tax_total,
        quote.delivery_charge,
        quote.discount,
        quote.coupon_code,
        quote.grand_total,
        // Direct UPI and khata are settled outside a gateway like COD; payment_provider tells them
        // apart ('upi': paid at checkout, 'khata': on the customer's khata). Neither has cash to collect.
        paymentMethod === 'online' ? 'unpaid' : 'cod',
        quote.delivery_charge,
        storeCustomerId,
        paymentMethod === 'upi' ? 'upi' : paymentMethod === 'khata' ? 'khata' : null,
        khata?.customerId ?? null,
        khata?.dueDate ?? null,
        khata?.approval ?? null,
        khata?.approval ? khata.reason : null,
      ],
    );

    const orderId = order.rows[0].id as string;
    for (const line of quote.lines) {
      await client.query(
        `INSERT INTO store_order_items
           (order_id, item_id, variant_id, item_name, variant_name,
            quantity, unit, unit_price, tax_rate, line_total)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          orderId,
          line.item_id,
          line.variant_id,
          line.item_name,
          line.variant_name,
          line.quantity,
          line.unit,
          line.unit_price,
          line.tax_rate,
          line.line_total,
        ],
      );
    }

    if (
      !(await claimStoreCouponUse(client, {
        businessId: store.business_id,
        code: quote.coupon_code,
        orderId,
        storeCustomerId,
      }))
    ) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'This coupon can no longer be used', code: 'COUPON_UNAVAILABLE' },
        { status: 409 },
      );
    }

    await holdStoreOrderStock(client, {
      businessId: store.business_id,
      orderId,
      lines: quote.lines,
      // Pay-online orders hold briefly; COD / UPI hold until the invoice or a cancel.
      expiresAt:
        paymentMethod === 'online' ? new Date(Date.now() + STORE_ONLINE_HOLD_MINUTES * 60_000) : null,
    });

    await client.query(
      `UPDATE store_customers
       SET name = COALESCE(NULLIF($1, ''), name),
           email = COALESCE($2, email),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $3`,
      [customer_name, body.customer_email?.trim() || null, storeCustomerId],
    );
    const addr = String(body.customer_address ?? '').trim();
    if (addr && body.delivery_mode !== 'pickup') {
      await client.query(
        `UPDATE store_customer_addresses SET is_default = false WHERE customer_id = $1`,
        [storeCustomerId],
      );
      await client.query(
        `INSERT INTO store_customer_addresses (customer_id, address, pincode, is_default)
         VALUES ($1, $2, $3, true)`,
        [storeCustomerId, addr, body.customer_pincode?.trim() || null],
      );
    }

    await client.query('COMMIT');

    const { notifyStoreMerchantNewOrder } = await import('@/lib/store/notify-merchant');
    void notifyStoreMerchantNewOrder({
      businessId: store.business_id,
      orderNumber: orderNum,
      grandTotal: quote.grand_total,
      customerName: customer_name,
    });

    if (paymentMethod === 'khata' && khata) {
      const notify = await import('@/lib/khata/notify');
      if (khata.approval === 'pending') {
        void notify.notifyMerchantKhataApproval({
          businessId: store.business_id,
          orderId,
          orderNumber: orderNum,
          customerName: customer_name,
          total: quote.grand_total,
          reason: khata.reason,
        });
        void notify.notifyCustomerKhataOrder({
          businessId: store.business_id,
          phone: customer_phone,
          customerName: customer_name,
          orderNumber: orderNum,
          total: quote.grand_total,
          payBy: khata.payBy,
          kind: 'waiting',
        });
      } else {
        const { createInvoiceForStoreOrder } = await import('@/lib/store/fulfill-paid-order');
        await createInvoiceForStoreOrder(orderId, store.business_id).catch((err) => {
          console.error('[store invoice khata]', err);
        });
        if (khata.warned) {
          void notify.notifyMerchantKhataWarning({
            businessId: store.business_id,
            orderId,
            orderNumber: orderNum,
            customerName: customer_name,
            total: quote.grand_total,
            reason: khata.reason,
          });
        }
        void notify.notifyCustomerKhataOrder({
          businessId: store.business_id,
          phone: customer_phone,
          customerName: customer_name,
          orderNumber: orderNum,
          total: quote.grand_total,
          payBy: khata.payBy,
          kind: 'placed',
        });
      }
    }

    if (paymentMethod === 'cod' || paymentMethod === 'upi') {
      const { createInvoiceForStoreOrder } = await import('@/lib/store/fulfill-paid-order');
      await createInvoiceForStoreOrder(orderId, store.business_id).catch((err) => {
        console.error(`[store invoice ${paymentMethod}]`, err);
      });
      const total = quote.grand_total.toLocaleString('en-IN');
      const mode = paymentMethod === 'upi' ? 'UPI' : 'Pay on delivery';
      void notifyStoreEvent({
        businessId: store.business_id,
        eventKey: 'store_order_placed',
        phone: customer_phone,
        values: {
          customer_name,
          order_number: orderNum,
          store_name: store.name,
          total,
          payment_mode: mode,
        },
        text: `Order ${orderNum} placed at ${store.name}. ${mode}. Total ₹${total}.`,
      });
    }

    const upi = upiVpa
      ? {
          vpa: upiVpa,
          amount: quote.grand_total,
          links: upiAppLinks({
            vpa: upiVpa,
            payeeName: store.name,
            amount: quote.grand_total,
            note: `Order ${orderNum}`,
            reference: orderNum,
          }),
        }
      : undefined;

    let paymentUrl: string | undefined;
    if (gateway) {
      const { providerId, cfg } = gateway;
      const psp =
        providerId === 'easebuzz' ? new EasebuzzPaymentProvider(cfg) : new RazorpayPaymentProvider(cfg);
      const origin = process.env.NEXT_PUBLIC_APP_URL || 'https://staging.khatario.com';
      const link = await psp.createHostedPaymentLink({
        businessId: store.business_id,
        orderId,
        amount: quote.grand_total,
        currency: 'INR',
        customerName: customer_name,
        customerPhone: customer_phone,
        customerEmail: body.customer_email,
        returnUrl: `${origin.replace(/\/$/, '')}/pay/complete`,
        metadata: {
          description: `Store order ${orderNum}`,
          store_order_id: orderId,
          store_subdomain: store.store_subdomain,
          ...(providerId === 'easebuzz' ? { easebuzz_context: 'ST' } : {}),
        },
      });
      paymentUrl = link.paymentUrl;
      if (link.providerPaymentId) {
        await queryOne(
          `UPDATE store_orders SET payment_provider = $3, payment_ref = $1 WHERE id = $2`,
          [link.providerPaymentId, orderId, providerId],
        );
      }
    }

    return NextResponse.json({
      order_id: orderId,
      order_number: orderNum,
      grand_total: quote.grand_total,
      payment_status: paymentMethod === 'online' ? 'unpaid' : 'cod',
      payment_url: paymentUrl,
      upi,
      khata: khata
        ? {
            due_date: khata.dueDate,
            pay_by: khata.payBy,
            pay_by_label: khataShortDate(khata.payBy),
            awaiting_approval: khata.approval === 'pending',
            warning: khata.warned ? khata.reason : null,
          }
        : undefined,
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[store order]', error);
    return NextResponse.json({ error: 'Failed to place order' }, { status: 500 });
  } finally {
    client.release();
  }
}
