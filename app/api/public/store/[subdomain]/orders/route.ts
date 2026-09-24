import { NextRequest, NextResponse } from 'next/server';
import { queryOne, getPool } from '@/lib/db';
import { resolveStoreBySubdomain } from '@/lib/store/resolve-store';
import { buildStoreQuote } from '@/lib/store/quote';
import { getBusinessPaymentProviderConfig } from '@/lib/payments/business-provider-config';
import { RazorpayPaymentProvider } from '@/lib/payments/providers/razorpay-payment-provider';
import { readStoreCustomer, STORE_CUSTOMER_COOKIE } from '@/lib/store/customer-session';
import { hasFeatureAccess } from '@/lib/subscription/feature-access';
import { FeatureKeys } from '@/lib/featureKeys';
import { shouldDecrementStockOnPlace } from '@/lib/store/fulfillment-rules';
import { notifyStoreCustomerWhatsApp } from '@/lib/store/notify-whatsapp';

export const dynamic = 'force-dynamic';

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

    const body = await request.json();
    const paymentMethod = body.payment_method === 'razorpay' ? 'razorpay' : 'cod';

    if (paymentMethod === 'razorpay') {
      const payOk = await hasFeatureAccess(store.business_id, FeatureKeys.PAYMENT_GATEWAY);
      if (!payOk) {
        return NextResponse.json(
          { error: 'Online payment is not available for this store' },
          { status: 400 },
        );
      }
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

    const quote = await buildStoreQuote({
      businessId: store.business_id,
      minOrderAmount: store.store_min_order_amount,
      branchId: body.branch_id,
      items: (body.items ?? []).map((i: { item_id: string; variant_id?: string; quantity: number }) => ({
        item_id: i.item_id,
        variant_id: i.variant_id,
        quantity: i.quantity,
      })),
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
    const customer_phone = String(body.customer_phone ?? '').trim();
    if (!customer_name) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }
    if (!customer_phone) {
      return NextResponse.json({ error: 'Phone number is required' }, { status: 400 });
    }
    if (body.delivery_mode !== 'pickup' && !String(body.customer_address ?? '').trim()) {
      return NextResponse.json({ error: 'Delivery address is required' }, { status: 400 });
    }

    const session = readStoreCustomer(request.cookies.get(STORE_CUSTOMER_COOKIE)?.value);
    const storeCustomerId =
      session && session.businessId === store.business_id ? session.customerId : null;
    const countRow = await queryOne<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM store_orders WHERE business_id = $1`,
      [store.business_id],
    );
    const orderNum = `SO-${(parseInt(countRow?.count ?? '0', 10) + 1).toString().padStart(4, '0')}`;

    const decrementStock = shouldDecrementStockOnPlace(paymentMethod);
    await client.query('BEGIN');

    if (decrementStock) {
      for (const line of quote.lines) {
        if (line.variant_id) {
          const stock = await client.query(
            `UPDATE item_variants SET current_stock = current_stock - $1
             WHERE id = $2 AND current_stock >= $1 RETURNING current_stock`,
            [line.quantity, line.variant_id],
          );
          if (stock.rowCount === 0) {
            await client.query('ROLLBACK');
            return NextResponse.json(
              { error: `"${line.item_name}" is out of stock` },
              { status: 409 },
            );
          }
        } else {
          const stock = await client.query(
            `UPDATE items SET current_stock = current_stock - $1
             WHERE id = $2 AND business_id = $3 AND current_stock >= $1 RETURNING current_stock`,
            [line.quantity, line.item_id, store.business_id],
          );
          if (stock.rowCount === 0) {
            await client.query('ROLLBACK');
            return NextResponse.json(
              { error: `"${line.item_name}" is out of stock` },
              { status: 409 },
            );
          }
        }
      }
    }

    const order = await client.query(
      `INSERT INTO store_orders
         (business_id, branch_id, order_number,
          customer_name, customer_phone, customer_email,
          customer_address, customer_pincode, customer_lat, customer_lng,
          delivery_mode, notes,
          subtotal, tax_total, delivery_charge, discount_amount, coupon_code, grand_total,
          payment_status, quoted_delivery_fee, store_customer_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
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
        paymentMethod === 'cod' ? 'cod' : 'unpaid',
        quote.delivery_charge,
        storeCustomerId,
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

    await client.query('COMMIT');

    const { notifyStoreMerchantNewOrder } = await import('@/lib/store/notify-merchant');
    void notifyStoreMerchantNewOrder({
      businessId: store.business_id,
      orderNumber: orderNum,
      grandTotal: quote.grand_total,
      customerName: customer_name,
    });

    if (paymentMethod === 'cod') {
      const { createInvoiceForStoreOrder } = await import('@/lib/store/fulfill-paid-order');
      const { incrementStoreCouponUse } = await import('@/lib/store/coupons');
      await incrementStoreCouponUse(store.business_id, quote.coupon_code);
      await createInvoiceForStoreOrder(orderId, store.business_id).catch((err) => {
        console.error('[store invoice cod]', err);
      });
      void notifyStoreCustomerWhatsApp({
        businessId: store.business_id,
        phone: customer_phone,
        text: `Order ${orderNum} placed at ${store.name}. Pay on delivery. Total ₹${quote.grand_total.toLocaleString('en-IN')}.`,
      });
    }

    let paymentUrl: string | undefined;
    if (paymentMethod === 'razorpay') {
      const cfg = await getBusinessPaymentProviderConfig(store.business_id, 'razorpay');
      if (!cfg?.clientId || !cfg.clientSecret) {
        return NextResponse.json(
          {
            order_id: orderId,
            order_number: orderNum,
            grand_total: quote.grand_total,
            payment_status: 'unpaid',
            error: 'Online payment is not configured for this store',
          },
          { status: 201 },
        );
      }
      const rzp = new RazorpayPaymentProvider(cfg);
      const origin = process.env.NEXT_PUBLIC_APP_URL || 'https://staging.khatario.com';
      const link = await rzp.createHostedPaymentLink({
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
        },
      });
      paymentUrl = link.paymentUrl;
      if (link.providerPaymentId) {
        await queryOne(
          `UPDATE store_orders SET payment_provider = 'razorpay', payment_ref = $1 WHERE id = $2`,
          [link.providerPaymentId, orderId],
        );
      }
    }

    return NextResponse.json({
      order_id: orderId,
      order_number: orderNum,
      grand_total: quote.grand_total,
      payment_status: paymentMethod === 'cod' ? 'cod' : 'unpaid',
      payment_url: paymentUrl,
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[store order]', error);
    return NextResponse.json({ error: 'Failed to place order' }, { status: 500 });
  } finally {
    client.release();
  }
}
