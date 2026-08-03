import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { getUserIdFromRequest, requireTenantBusinessId } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const tenant = requireTenantBusinessId(request, params.id);
    if (!tenant.ok) return tenant.response;

    const userId = getUserIdFromRequest(request);
    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    try {
      await authorize(userId, 'settings', 'read', { businessId: tenant.businessId });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    const business = await db.queryOne(`
      SELECT 
        id, name, email, phone, address_line1, address_line2, city, state, state_code, pincode, gstin
      FROM businesses
      WHERE id = $1
    `, [tenant.businessId]);

    if (!business) {
      return NextResponse.json(
        { error: 'Business not found' },
        { status: 404 }
      );
    }

    // Map address_line1 to address for compatibility
    const businessData = {
      ...business,
      address: business.address_line1 || business.address_line2 || null
    };

    return NextResponse.json({ business: businessData });
  } catch (error: any) {
    console.error('Error fetching business:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch business' },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const tenant = requireTenantBusinessId(request, params.id);
    if (!tenant.ok) return tenant.response;

    const userId = getUserIdFromRequest(request);
    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    try {
      await authorize(userId, 'settings', 'update', { businessId: tenant.businessId });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    const body = await request.json();

    const {
      name,
      phone,
      email,
      address_line1,
      city,
      state,
      state_code,
      pincode,
      gstin,
      company_introduction,
    } = body;

    // Update business
    const updateQuery = `
      UPDATE businesses
      SET 
        name = COALESCE($1, name),
        phone = COALESCE($2, phone),
        email = COALESCE($3, email),
        address_line1 = COALESCE($4, address_line1),
        city = COALESCE($5, city),
        state = COALESCE($6, state),
        state_code = COALESCE($7, state_code),
        pincode = COALESCE($8, pincode),
        gstin = COALESCE($9, gstin),
        company_introduction = COALESCE($10, company_introduction),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $11
      RETURNING *
    `;

    const business = await db.queryOne(updateQuery, [
      name,
      phone,
      email,
      address_line1,
      city,
      state,
      state_code,
      pincode,
      gstin,
      company_introduction,
      tenant.businessId,
    ]);

    if (!business) {
      return NextResponse.json(
        { error: 'Business not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ business });
  } catch (error: any) {
    console.error('Error updating business:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to update business' },
      { status: 500 }
    );
  }
}
