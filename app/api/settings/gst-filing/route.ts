import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { getUserIdFromRequest, requirePortalSession } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import type { Gstr3BFilingFrequency } from '@/lib/gst/gst-interest';

/**
 * GET /api/settings/gst-filing
 * Org defaults for GSTR-3B due-date rules (used by GST status, charges, and filing unless overridden per request).
 */
export async function GET(request: NextRequest) {
  try {
    const gate = await requirePortalSession(request);
    if (gate) return gate;

    const userId = getUserIdFromRequest(request);
    if (!userId) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const user = await queryOne<{ business_id: string | null }>(
      'SELECT business_id FROM users WHERE id = $1',
      [userId]
    );
    if (!user?.business_id) {
      return NextResponse.json({ error: 'No business' }, { status: 400 });
    }

    await authorize(userId, 'settings', 'read', { businessId: user.business_id });

    const row = await queryOne<{
      gst_filing_frequency: string;
      gst_qrmp_due_day: number;
    }>(
      `SELECT gst_filing_frequency, gst_qrmp_due_day FROM business_settings WHERE business_id = $1::uuid`,
      [user.business_id]
    );

    const filing_frequency: Gstr3BFilingFrequency = row?.gst_filing_frequency === 'qrmp' ? 'qrmp' : 'monthly';
    const qrmp_due_day: 22 | 24 = row?.gst_qrmp_due_day === 24 ? 24 : 22;

    return NextResponse.json({ filing_frequency, qrmp_due_day });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return error.toNextResponse();
    }
    console.error('gst-filing settings GET:', error);
    return NextResponse.json({ error: 'Failed to load GST filing settings' }, { status: 500 });
  }
}

/**
 * PATCH /api/settings/gst-filing
 * Body: { filing_frequency: 'monthly' | 'qrmp', qrmp_due_day?: 22 | 24 }
 */
export async function PATCH(request: NextRequest) {
  try {
    const gate = await requirePortalSession(request);
    if (gate) return gate;

    const userId = getUserIdFromRequest(request);
    if (!userId) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const user = await queryOne<{ business_id: string | null }>(
      'SELECT business_id FROM users WHERE id = $1',
      [userId]
    );
    if (!user?.business_id) {
      return NextResponse.json({ error: 'No business' }, { status: 400 });
    }

    await authorize(userId, 'settings', 'update', { businessId: user.business_id });

    const body = await request.json();
    const ff = body?.filing_frequency as string | undefined;
    const qd = body?.qrmp_due_day as number | undefined;

    if (ff !== 'monthly' && ff !== 'qrmp') {
      return NextResponse.json(
        { error: 'filing_frequency must be "monthly" or "qrmp"' },
        { status: 400 }
      );
    }

    let qrmp_due_day: 22 | 24 = 22;
    if (ff === 'qrmp') {
      if (qd !== 22 && qd !== 24) {
        return NextResponse.json(
          { error: 'qrmp_due_day must be 22 or 24 when filing_frequency is qrmp' },
          { status: 400 }
        );
      }
      qrmp_due_day = qd;
    }

    const row = await queryOne<{
      gst_filing_frequency: string;
      gst_qrmp_due_day: number;
    }>(
      `INSERT INTO business_settings (business_id, gst_filing_frequency, gst_qrmp_due_day)
       VALUES ($1::uuid, $2, $3)
       ON CONFLICT (business_id) DO UPDATE
       SET gst_filing_frequency = EXCLUDED.gst_filing_frequency,
           gst_qrmp_due_day = EXCLUDED.gst_qrmp_due_day,
           updated_at = CURRENT_TIMESTAMP
       RETURNING gst_filing_frequency, gst_qrmp_due_day`,
      [user.business_id, ff, qrmp_due_day]
    );

    const filing_frequency: Gstr3BFilingFrequency = row?.gst_filing_frequency === 'qrmp' ? 'qrmp' : 'monthly';
    const outDay: 22 | 24 = row?.gst_qrmp_due_day === 24 ? 24 : 22;

    return NextResponse.json({ filing_frequency, qrmp_due_day: outDay });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return error.toNextResponse();
    }
    console.error('gst-filing settings PATCH:', error);
    return NextResponse.json({ error: 'Failed to update GST filing settings' }, { status: 500 });
  }
}
