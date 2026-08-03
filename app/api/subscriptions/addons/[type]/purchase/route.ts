import { NextRequest, NextResponse } from 'next/server';
import { requireTenantBusinessId } from '@/lib/auth-helpers';
import { applySubscriptionMutationGuard } from '@/lib/security/apply-subscription-mutation-guard';
import * as db from '@/lib/db';
import { WhatsAppAddonType } from '@/lib/subscription';
import {
  WHATSAPP_ADDON_PRICING,
  createAddonCheckout,
  isPlatformRazorpayConfigured,
} from '@/lib/platform-addon-checkout';

export const dynamic = 'force-dynamic';

/**
 * POST /api/subscriptions/addons/[type]/purchase
 * Start Razorpay checkout for a WhatsApp add-on (no free activation).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { type: string } },
) {
  try {
    const body = await request.json();
    const tenant = requireTenantBusinessId(request, body.business_id);
    if (!tenant.ok) return tenant.response;
    const business_id = tenant.businessId;

    const guard = await applySubscriptionMutationGuard(request, business_id);
    if (guard) return guard;

    const addonType = params.type as WhatsAppAddonType;

    const validAddonTypes: WhatsAppAddonType[] = [
      'whatsapp_bot',
      'whatsapp_send_message',
    ];
    if (!validAddonTypes.includes(addonType)) {
      return NextResponse.json(
        { error: `Invalid addon type: ${addonType}` },
        { status: 400 },
      );
    }

    const price = WHATSAPP_ADDON_PRICING[addonType];

    const business = await db.queryOne(
      `SELECT id FROM businesses WHERE id = $1`,
      [business_id],
    );
    if (!business) {
      return NextResponse.json({ error: 'Business not found' }, { status: 404 });
    }

    const existingAddon = await db.queryOne<{ id: string; status: string }>(
      `SELECT id, status FROM whatsapp_addons
       WHERE business_id = $1 AND addon_type = $2`,
      [business_id, addonType],
    );

    if (existingAddon?.status === 'active') {
      return NextResponse.json(
        {
          error: 'This add-on is already active',
          code: 'ALREADY_ACTIVE',
          addon: existingAddon,
        },
        { status: 400 },
      );
    }

    if (!isPlatformRazorpayConfigured()) {
      return NextResponse.json(
        {
          error:
            'Online payments are not configured yet. Please contact support to purchase add-ons.',
          code: 'PAYMENT_NOT_CONFIGURED',
        },
        { status: 503 },
      );
    }

    const checkout = await createAddonCheckout({
      businessId: business_id,
      addonType,
    });

    return NextResponse.json({
      success: true,
      mode: 'redirect',
      checkoutUrl: checkout.checkoutUrl,
      amount: checkout.amount,
      currency: checkout.currency,
      billingTransactionId: checkout.billingTransactionId,
      addon: {
        addon_type: addonType,
        price_monthly: price,
        status: 'pending_payment',
      },
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : 'Failed to purchase addon';
    console.error('Error purchasing addon:', error);

    if (message === 'PAYMENT_NOT_CONFIGURED') {
      return NextResponse.json(
        { error: 'Payments not configured', code: 'PAYMENT_NOT_CONFIGURED' },
        { status: 503 },
      );
    }

    return NextResponse.json(
      { error: message || 'Failed to purchase addon' },
      { status: 500 },
    );
  }
}
