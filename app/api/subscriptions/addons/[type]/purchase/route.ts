import { NextRequest, NextResponse } from 'next/server';
import { requireTenantBusinessId } from '@/lib/auth-helpers';
import * as db from '@/lib/db';
import { WhatsAppAddonType, clearAddonCache } from '@/lib/subscription';

/**
 * POST /api/subscriptions/addons/[type]/purchase
 * Purchase/activate a WhatsApp add-on
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { type: string } }
) {
  try {
    const body = await request.json();
    const tenant = requireTenantBusinessId(request, body.business_id);
    if (!tenant.ok) return tenant.response;
    const business_id = tenant.businessId;
    const addonType = params.type as WhatsAppAddonType;

    // Validate addon type
    const validAddonTypes: WhatsAppAddonType[] = ['whatsapp_bot', 'whatsapp_send_message'];
    if (!validAddonTypes.includes(addonType)) {
      return NextResponse.json(
        { error: `Invalid addon type: ${addonType}` },
        { status: 400 }
      );
    }

    // Pricing for addons
    const addonPricing: Record<WhatsAppAddonType, number> = {
      whatsapp_bot: 499,
      whatsapp_send_message: 299,
    };

    const price = addonPricing[addonType];

    // Check if business exists
    const business = await db.queryOne(`SELECT id FROM businesses WHERE id = $1`, [business_id]);
    if (!business) {
      return NextResponse.json({ error: 'Business not found' }, { status: 404 });
    }

    // Check if addon already exists
    const existingAddon = await db.queryOne(`
      SELECT id, status FROM whatsapp_addons
      WHERE business_id = $1 AND addon_type = $2
    `, [business_id, addonType]);

    if (existingAddon) {
      if (existingAddon.status === 'active') {
        return NextResponse.json(
          { error: 'This add-on is already active', addon: existingAddon },
          { status: 400 }
        );
      }

      // Reactivate existing addon
      await db.query(`
        UPDATE whatsapp_addons
        SET status = 'active',
            start_date = CURRENT_DATE,
            end_date = NULL,
            price_monthly = $1,
            updated_at = CURRENT_TIMESTAMP
        WHERE business_id = $2 AND addon_type = $3
      `, [price, business_id, addonType]);

      const reactivatedAddon = await db.queryOne(`
        SELECT * FROM whatsapp_addons
        WHERE business_id = $1 AND addon_type = $2
      `, [business_id, addonType]);

      // Clear addon cache so reactivated addon is immediately available
      clearAddonCache(business_id);

      return NextResponse.json({
        success: true,
        message: 'Add-on reactivated successfully',
        addon: reactivatedAddon,
      });
    }

    // Create new addon
    // In production, this would integrate with payment gateway
    // For MVP, we'll just create the addon record
    const newAddon = await db.queryOne(`
      INSERT INTO whatsapp_addons (
        business_id, addon_type, status, price_monthly, start_date, end_date
      ) VALUES ($1, $2, 'active', $3, CURRENT_DATE, NULL)
      RETURNING *
    `, [business_id, addonType, price]);

    // Clear addon cache so new addon is immediately available
    clearAddonCache(business_id);

    return NextResponse.json({
      success: true,
      message: 'Add-on purchased successfully',
      addon: newAddon,
    });
  } catch (error: any) {
    console.error('Error purchasing addon:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to purchase addon' },
      { status: 500 }
    );
  }
}

