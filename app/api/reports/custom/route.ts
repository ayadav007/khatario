export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import {
  getUserIdFromRequest,
  getBusinessIdFromRequest,
  requirePortalSession,
} from '@/lib/auth-helpers';
import * as db from '@/lib/db';
import { assertFeatureAccess } from '@/lib/subscription/feature-access';
import { requireTenantBusinessId } from '@/lib/auth-helpers';

// GET - Load saved custom reports
export async function GET(request: NextRequest) {
  try {
    const gate = await requirePortalSession(request);
    if (gate) return gate;

    const { searchParams } = new URL(request.url);
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);

    if (!businessId) {
      return NextResponse.json({ error: 'business_id required' }, { status: 400 });
    }

    await assertFeatureAccess(businessId, 'report_builder');

    const query = `
      SELECT 
        id,
        name,
        description,
        entity_type,
        fields,
        is_public,
        created_at
      FROM custom_reports
      WHERE business_id = $1
        AND (is_public = true OR user_id = $2)
      ORDER BY created_at DESC
    `;

    const reports = await db.queryRows(query, [businessId, userId]);

    return NextResponse.json({ reports });
  } catch (error: any) {
    console.error('Error loading custom reports:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST - Save custom report template
export async function POST(request: NextRequest) {
  try {
    const gate = await requirePortalSession(request);
    if (gate) return gate;

    const body = await request.json();
    const { business_id: claimedBusinessId, name, description, entity_type, fields } = body;
    const userId = getUserIdFromRequest(request);
    const tenant = requireTenantBusinessId(request, claimedBusinessId);
    if (!tenant.ok) return tenant.response;
    const business_id = tenant.businessId;

    if (!business_id || !userId || !name || !entity_type || !fields) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    await assertFeatureAccess(business_id, 'report_builder');

    const query = `
      INSERT INTO custom_reports (
        business_id,
        user_id,
        name,
        description,
        entity_type,
        fields
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, name, created_at
    `;

    const result = await db.queryRows(query, [
      business_id,
      userId,
      name,
      description || null,
      entity_type,
      JSON.stringify(fields),
    ]);

    return NextResponse.json({ success: true, report: result[0] }, { status: 201 });
  } catch (error: any) {
    console.error('Error saving custom report:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
