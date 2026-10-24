import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { requireAuthenticatedTenant } from '@/lib/stock-request-security';

export const dynamic = 'force-dynamic';

/**
 * GET /api/suppliers/hub/directory?q=&page=
 * Lists businesses opted into directory search (excludes current business), each with
 * whether the signed-in business is already connected to it or has asked to be.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = requireAuthenticatedTenant(request);
    if (auth instanceof NextResponse) return auth;
    const { businessId, userId } = auth;
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
      connection: 'connected' | 'requested' | null;
    }>(
      `
      SELECT b.id, b.name, b.city, b.state, b.gstin,
             d.profile_summary, d.featured_categories,
             CASE
               WHEN EXISTS (
                 SELECT 1 FROM suppliers s
                 WHERE s.business_id = $1 AND s.linked_business_id = b.id
                   AND s.approval_status = 'approved' AND s.deleted_at IS NULL
               ) THEN 'connected'
               WHEN EXISTS (
                 SELECT 1 FROM supplier_connection_requests r
                 WHERE r.buyer_business_id = $1 AND r.supplier_business_id = b.id AND r.status = 'pending'
               ) THEN 'requested'
             END AS connection
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
