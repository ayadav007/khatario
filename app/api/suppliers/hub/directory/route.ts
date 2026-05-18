import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';

/**
 * GET /api/suppliers/hub/directory?q=&page=
 * Lists businesses opted into directory search (excludes current business).
 */
export async function GET(request: NextRequest) {
  try {
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    if (!businessId || !userId) {
      return NextResponse.json({ error: 'business_id and user context required' }, { status: 400 });
    }
    try {
      await authorize(userId, 'purchases', 'read', { businessId });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    const { searchParams } = new URL(request.url);
    const q = (searchParams.get('q') || '').trim();
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') || '20', 10)));
    const offset = (page - 1) * limit;

    const term = q ? `%${q}%` : '%';
    const rows = await db.queryRows<{
      id: string;
      name: string;
      city: string | null;
      state: string | null;
      gstin: string | null;
      profile_summary: string | null;
      featured_categories: string[] | null;
    }>(
      `
      SELECT b.id, b.name, b.city, b.state, b.gstin,
             d.profile_summary, d.featured_categories
      FROM businesses b
      INNER JOIN business_discovery d ON d.business_id = b.id
      WHERE d.visibility = 'directory'
        AND d.directory_approved = true
        AND b.id <> $1
        AND (
          $2::text = '%'
          OR b.name ILIKE $2
          OR COALESCE(b.city, '') ILIKE $2
          OR COALESCE(b.state, '') ILIKE $2
          OR COALESCE(b.gstin, '') ILIKE $2
        )
      ORDER BY b.name ASC
      LIMIT $3 OFFSET $4
      `,
      [businessId, term, limit, offset]
    );

    const countRow = await db.queryOne<{ n: string }>(
      `
      SELECT COUNT(*)::text AS n
      FROM businesses b
      INNER JOIN business_discovery d ON d.business_id = b.id
      WHERE d.visibility = 'directory'
        AND d.directory_approved = true
        AND b.id <> $1
        AND (
          $2::text = '%'
          OR b.name ILIKE $2
          OR COALESCE(b.city, '') ILIKE $2
          OR COALESCE(b.state, '') ILIKE $2
          OR COALESCE(b.gstin, '') ILIKE $2
        )
      `,
      [businessId, term]
    );
    const total = parseInt(countRow?.n || '0', 10);

    return NextResponse.json({
      businesses: rows,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 0 },
    });
  } catch (e: any) {
    console.error('hub directory GET', e);
    return NextResponse.json({ error: e.message || 'Failed' }, { status: 500 });
  }
}
