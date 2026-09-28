import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { normalizePhoneOrNull } from '@/lib/utils/phone';
import { getStateCode } from '@/lib/gst-utils';
import { getBusinessIdFromRequest, getUserIdFromRequest } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { resolveGstinAndState } from '@/lib/tax/gstin';
import { normalizePan } from '@/lib/tax/pan';

export const dynamic = 'force-dynamic';

/**
 * When the business has exactly one active branch, keep it in sync with company identity
 * on the business row (GSTIN, address, etc.) so branch-scoped flows stay consistent.
 */
async function syncSingleActiveBranchFromBusiness(businessId: string): Promise<void> {
  await query(
    `
    UPDATE branches br
    SET
      name = b.name,
      email = b.email,
      phone = b.phone,
      address_line1 = b.address_line1,
      address_line2 = b.address_line2,
      city = b.city,
      state = b.state,
      state_code = b.state_code,
      pincode = b.pincode,
      gstin = b.gstin,
      updated_at = CURRENT_TIMESTAMP
    FROM businesses b
    WHERE b.id = $1
      AND br.business_id = b.id
      AND br.is_active = true
      AND br.is_default = true
      AND (
        SELECT COUNT(*)::int
        FROM branches x
        WHERE x.business_id = b.id AND x.is_active = true
      ) = 1
    `,
    [businessId]
  );
}

/**
 * PATCH /api/business/[id]
 * Update business information
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const businessId = params.id;
    const body = await request.json();

    const userId = getUserIdFromRequest(request, body);
    const scopedBusinessId = getBusinessIdFromRequest(request, body);
    if (!userId || !scopedBusinessId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    if (scopedBusinessId !== businessId) {
      return NextResponse.json({ error: 'Business not found' }, { status: 404 });
    }
    try {
      await authorize(userId, 'settings', 'update', { businessId });
    } catch (error) {
      if (error instanceof AuthorizationError) return error.toNextResponse();
      throw error;
    }

    const {
      name,
      email,
      phone,
      address_line1,
      address_line2,
      city,
      state: stateIn,
      state_code: stateCodeIn,
      pincode,
      gstin: gstinIn,
      pan: panIn,
      logo_url,
      currency,
      invoice_prefix,
      next_invoice_number,
      default_tax_rate,
      iec_code,
      swift_code,
      company_introduction,
      gst_registration_type,
      business_type,
      industry,
      business_model,
    } = body;

    let state = stateIn as string | null | undefined;
    let state_code = stateCodeIn as string | null | undefined;
    let gstin = gstinIn as string | null | undefined;
    let pan = panIn as string | null | undefined;
    if (typeof gstinIn === 'string' && gstinIn.trim()) {
      const gstinCheck = resolveGstinAndState({ gstin: gstinIn, state: stateIn, state_code: stateCodeIn });
      if (!gstinCheck.ok) {
        return NextResponse.json({ error: gstinCheck.error, code: gstinCheck.code }, { status: 400 });
      }
      gstin = gstinCheck.gstin;
      state = gstinCheck.state;
      state_code = gstinCheck.state_code;
      if (panIn && normalizePan(panIn) && gstinCheck.pan && normalizePan(panIn) !== gstinCheck.pan) {
        return NextResponse.json(
          { error: `PAN does not match the PAN inside GSTIN (${gstinCheck.pan}).`, code: 'PAN_GSTIN_MISMATCH' },
          { status: 400 }
        );
      }
      pan = gstinCheck.pan ?? pan;
    }
    if (typeof pan === 'string' && pan.trim() && !normalizePan(pan)) {
      return NextResponse.json({ error: 'Invalid PAN. Expected format: ABCDE1234F', code: 'INVALID_PAN' }, { status: 400 });
    }
    if (typeof pan === 'string') pan = normalizePan(pan) ?? null;

    // Build update query dynamically
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      values.push(name);
    }
    if (email !== undefined) {
      updates.push(`email = $${paramIndex++}`);
      values.push(email || null);
    }
    if (phone !== undefined) {
      updates.push(`phone = $${paramIndex++}`);
      values.push(normalizePhoneOrNull(phone));
    }
    if (address_line1 !== undefined) {
      updates.push(`address_line1 = $${paramIndex++}`);
      values.push(address_line1 || null);
    }
    if (address_line2 !== undefined) {
      updates.push(`address_line2 = $${paramIndex++}`);
      values.push(address_line2 || null);
    }
    if (city !== undefined) {
      updates.push(`city = $${paramIndex++}`);
      values.push(city || null);
    }
    if (state !== undefined) {
      updates.push(`state = $${paramIndex++}`);
      values.push(state || null);
      if (state_code !== undefined) {
        updates.push(`state_code = $${paramIndex++}`);
        values.push(state_code ? String(state_code).trim().slice(0, 2) : null);
      } else {
        const derived = getStateCode(String(state || ''));
        updates.push(`state_code = $${paramIndex++}`);
        values.push(derived ? derived.slice(0, 2) : null);
      }
    } else if (state_code !== undefined) {
      updates.push(`state_code = $${paramIndex++}`);
      values.push(state_code ? String(state_code).trim().slice(0, 2) : null);
    }
    if (pincode !== undefined) {
      updates.push(`pincode = $${paramIndex++}`);
      values.push(pincode || null);
    }
    if (gstin !== undefined) {
      updates.push(`gstin = $${paramIndex++}`);
      values.push(gstin || null);
    }
    if (pan !== undefined) {
      updates.push(`pan = $${paramIndex++}`);
      values.push(pan || null);
    }
    if (logo_url !== undefined) {
      updates.push(`logo_url = $${paramIndex++}`);
      values.push(logo_url || null);
    }
    if (body.signature_url !== undefined) {
      updates.push(`signature_url = $${paramIndex++}`);
      values.push(body.signature_url || null);
    }
    if (currency !== undefined) {
      updates.push(`currency = $${paramIndex++}`);
      values.push(currency || 'INR');
    }
    if (invoice_prefix !== undefined) {
      updates.push(`invoice_prefix = $${paramIndex++}`);
      values.push(invoice_prefix || 'INV');
    }
    if (next_invoice_number !== undefined) {
      updates.push(`next_invoice_number = $${paramIndex++}`);
      values.push(next_invoice_number || 1);
    }
    if (default_tax_rate !== undefined) {
      updates.push(`default_tax_rate = $${paramIndex++}`);
      values.push(default_tax_rate || 18);
    }
    if (iec_code !== undefined) {
      updates.push(`iec_code = $${paramIndex++}`);
      values.push(iec_code || null);
    }
    if (swift_code !== undefined) {
      updates.push(`swift_code = $${paramIndex++}`);
      values.push(swift_code || null);
    }
    if (company_introduction !== undefined) {
      updates.push(`company_introduction = $${paramIndex++}`);
      values.push(company_introduction || null);
    }
    if (gst_registration_type !== undefined) {
      updates.push(`gst_registration_type = $${paramIndex++}`);
      const g = String(gst_registration_type || '').trim().toLowerCase();
      const allowed = ['regular', 'composition', 'unregistered'];
      values.push(allowed.includes(g) ? g : 'unregistered');
    }
    if (business_type !== undefined) {
      updates.push(`business_type = $${paramIndex++}`);
      values.push(business_type || null);
    }
    if (industry !== undefined) {
      updates.push(`industry = $${paramIndex++}`);
      values.push(industry || null);
    }
    if (business_model !== undefined) {
      updates.push(`business_model = $${paramIndex++}`);
      values.push(business_model || null);
    }

    if (updates.length === 0) {
      return NextResponse.json(
        { error: 'No fields to update' },
        { status: 400 }
      );
    }

    updates.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(businessId);

    const updatedBusiness = await queryOne(`
      UPDATE businesses
      SET ${updates.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `, values);

    if (!updatedBusiness) {
      return NextResponse.json(
        { error: 'Business not found' },
        { status: 404 }
      );
    }

    try {
      await syncSingleActiveBranchFromBusiness(businessId);
    } catch (syncErr) {
      console.warn('[PATCH /api/business] Single-branch sync skipped or failed:', syncErr);
    }

    return NextResponse.json({
      success: true,
      business: updatedBusiness,
      message: 'Business updated successfully'
    });
  } catch (error: any) {
    console.error('Error updating business:', error);
    return NextResponse.json(
      { error: 'Failed to update business', details: error.message },
      { status: 500 }
    );
  }
}

