import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { withWhatsAppPremiumApi } from '@/lib/security/premium-module-api';
import { normalizePhone, isValidPhone } from '@/lib/utils/phone';

export const dynamic = 'force-dynamic';

/**
 * GET /api/whatsapp/unsubscribes
 * List all unsubscribed numbers for a business
 */
export const GET = withWhatsAppPremiumApi({}, async ({ request, businessId, userId }) => {
  try {
    const { searchParams } = new URL(request.url);
    const checkPhone = searchParams.get('check_phone'); // Check if specific phone is unsubscribed
    const checkPhones = searchParams.get('check_phones'); // Check multiple phones (comma-separated)

    if (!businessId) {
      return NextResponse.json({ error: 'Business ID is required' }, { status: 400 });
    }

    const pool = getPool();

    // If checking specific phone(s)
    if (checkPhone || checkPhones) {
      const phonesToCheck = checkPhones 
        ? checkPhones.split(',').map(p => normalizePhone(p.trim()))
        : [normalizePhone(checkPhone!)];

      const result = await pool.query(
        `SELECT phone FROM whatsapp_unsubscribes 
        WHERE business_id = $1 AND phone = ANY($2)`,
        [businessId, phonesToCheck]
      );

      const unsubscribedPhones = result.rows.map(r => r.phone);

      return NextResponse.json({
        checked: phonesToCheck,
        unsubscribed: unsubscribedPhones,
        counts: {
          total: phonesToCheck.length,
          unsubscribed: unsubscribedPhones.length,
          subscribed: phonesToCheck.length - unsubscribedPhones.length,
        },
      });
    }

    // Get all unsubscribed numbers
    const result = await pool.query(
      `SELECT * FROM whatsapp_unsubscribes 
      WHERE business_id = $1 
      ORDER BY unsubscribed_at DESC`,
      [businessId]
    );

    return NextResponse.json({
      unsubscribes: result.rows,
      total: result.rows.length,
    });
  } catch (error: any) {
    console.error('[Unsubscribes API] GET error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch unsubscribes' },
      { status: 500 }
    );
  }
});
/**
 * POST /api/whatsapp/unsubscribes
 * Add phone(s) to unsubscribe list
 */
export const POST = withWhatsAppPremiumApi({ parseJsonBody: true }, async ({ request, businessId, body, userId }) => {
  try {
    const { phone, phones } = (body ?? {}) as Record<string, any>;

    if (! (!phone && !phones)) {
      return NextResponse.json(
        { error: 'Business ID and phone(s) are required' },
        { status: 400 }
      );
    }


    // Normalize phone numbers
    const phonesToAdd = phones 
      ? phones.map((p: string) => normalizePhone(p))
      : [normalizePhone(phone)];

    // Validate all phones
    const invalidPhones = phonesToAdd.filter((p: string) => !isValidPhone(p));
    if (invalidPhones.length > 0) {
      return NextResponse.json(
        { error: 'Invalid phone numbers', invalid: invalidPhones },
        { status: 400 }
      );
    }

    const pool = getPool();
    let added = 0;
    let skipped = 0;

    for (const phoneNumber of phonesToAdd) {
      try {
        const result = await pool.query(
          `INSERT INTO whatsapp_unsubscribes (business_id, phone)
          VALUES ($1, $2)
          ON CONFLICT (business_id, phone) DO NOTHING
          RETURNING id`,
          [businessId, phoneNumber]
        );

        if (result.rows.length > 0) {
          added++;
        } else {
          skipped++;
        }
      } catch (error) {
        console.error('[Unsubscribes API] Error adding phone:', error);
        skipped++;
      }
    }

    return NextResponse.json({
      message: `Added ${added} phone(s) to unsubscribe list, ${skipped} already unsubscribed`,
      added,
      skipped,
      total: phonesToAdd.length,
    });
  } catch (error: any) {
    console.error('[Unsubscribes API] POST error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to add to unsubscribe list' },
      { status: 500 }
    );
  }
});

/**
 * DELETE /api/whatsapp/unsubscribes
 * Remove phone(s) from unsubscribe list (re-subscribe)
 */
export const DELETE = withWhatsAppPremiumApi({}, async ({ request, businessId, userId }) => {
  try {
    const { searchParams } = new URL(request.url);
    const phone = searchParams.get('phone');
    const phones = searchParams.get('phones')?.split(',') || [];

    if (!businessId || (!phone && phones.length === 0)) {
      return NextResponse.json(
        { error: 'Business ID and phone(s) are required' },
        { status: 400 }
      );
    }

    // Normalize phone numbers
    const phonesToRemove = phones.length > 0
      ? phones.map(p => normalizePhone(p.trim()))
      : [normalizePhone(phone!)];

    const pool = getPool();

    // Remove from unsubscribe list
    const result = await pool.query(
      `DELETE FROM whatsapp_unsubscribes 
      WHERE business_id = $1 AND phone = ANY($2)
      RETURNING phone`,
      [businessId, phonesToRemove]
    );

    return NextResponse.json({
      message: `Removed ${result.rows.length} phone(s) from unsubscribe list (re-subscribed)`,
      removed: result.rows.length,
      phones: result.rows.map(r => r.phone),
    });
  } catch (error: any) {
    console.error('[Unsubscribes API] DELETE error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to remove from unsubscribe list' },
      { status: 500 }
    );
  }
});
