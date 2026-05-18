import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { assertFeatureAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';

// GET - Load dashboard widgets
export async function GET(request: NextRequest) {
  try {
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);

    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    try {
      await authorize(userId, 'dashboard', 'read');
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    if (!businessId) {
      return NextResponse.json({ error: 'business_id required' }, { status: 400 });
    }

    try {
      await assertFeatureAccess(businessId, 'customizable_dashboard');
    } catch (err) {
      if (err instanceof FeatureAccessDeniedError) {
        return NextResponse.json({ widgets: [] });
      }
      throw err;
    }

    const query = `
      SELECT widgets
      FROM dashboard_layouts
      WHERE business_id = $1
      LIMIT 1
    `;

    const result = await db.queryRows(query, [businessId]);
    const widgets = result[0]?.widgets || [];

    return NextResponse.json({ widgets });
  } catch (error: any) {
    console.error('Error loading widgets:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST - Save dashboard widgets
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { business_id, widgets } = body;
    const userId = getUserIdFromRequest(request, body);

    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    try {
      await authorize(userId, 'dashboard', 'read');
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    if (!business_id || !widgets) {
      return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
    }

    try {
      await assertFeatureAccess(business_id, 'customizable_dashboard');
    } catch (err) {
      if (err instanceof FeatureAccessDeniedError) {
        return err.toNextResponse();
      }
      throw err;
    }

    const query = `
      INSERT INTO dashboard_layouts (business_id, widgets, updated_at)
      VALUES ($1, $2, CURRENT_TIMESTAMP)
      ON CONFLICT (business_id)
      DO UPDATE SET widgets = $2, updated_at = CURRENT_TIMESTAMP
    `;

    await db.query(query, [business_id, JSON.stringify(widgets)]);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error saving widgets:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
