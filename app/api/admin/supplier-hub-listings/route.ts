import { NextRequest, NextResponse } from 'next/server';
import { query, queryRows } from '@/lib/db';
import { requirePlatformRequest } from '@/lib/platform-request-auth';
import { isListingReviewOn, setListingReview } from '@/lib/supplier-hub-visibility';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/supplier-hub-listings?status=waiting|listed|hidden
 * Supplier Hub directory listings for platform review, with GST registry status.
 */
export async function GET(request: NextRequest) {
  const auth = await requirePlatformRequest(request, 'viewer', 'can_manage_subscriptions');
  if (!auth.ok) return auth.response;
  const status = new URL(request.url).searchParams.get('status') || 'waiting';
  const where =
    status === 'listed'
      ? 'd.directory_approved = true'
      : status === 'hidden'
        ? 'd.directory_approved = false AND d.reviewed_at IS NOT NULL'
        : 'd.directory_approved = false AND d.reviewed_at IS NULL';
  const listings = await queryRows(
    `SELECT d.business_id, b.name, b.city, b.state, b.gstin, b.phone, d.profile_summary, d.featured_categories,
            d.directory_approved, d.reviewed_at, d.review_note, d.updated_at, d.gst_status, d.gst_legal_name,
            (d.gst_verified_gstin IS NOT NULL AND d.gst_verified_gstin = UPPER(b.gstin)) AS gst_checked
       FROM business_discovery d JOIN businesses b ON b.id = d.business_id
      WHERE d.visibility = 'directory' AND ${where}
      ORDER BY d.updated_at DESC
      LIMIT 200`
  );
  return NextResponse.json({ review_listings: await isListingReviewOn(), listings });
}

/**
 * PATCH — { business_id, approved, note? } approves or hides one listing;
 * { review_listings: boolean } turns review of new listings on or off.
 */
export async function PATCH(request: NextRequest) {
  const auth = await requirePlatformRequest(request, 'viewer', 'can_manage_plans');
  if (!auth.ok) return auth.response;
  const body = await request.json().catch(() => null);
  if (body && typeof body.review_listings === 'boolean') {
    await setListingReview(body.review_listings);
    return NextResponse.json({ review_listings: body.review_listings });
  }
  if (!body || typeof body.business_id !== 'string' || typeof body.approved !== 'boolean') {
    return NextResponse.json({ error: 'business_id and approved are required' }, { status: 400 });
  }
  const res = await query(
    `UPDATE business_discovery SET directory_approved = $2, reviewed_at = CURRENT_TIMESTAMP, review_note = $3
      WHERE business_id = $1`,
    [body.business_id, body.approved, typeof body.note === 'string' ? body.note.slice(0, 300) : null]
  );
  if (!res.rowCount) return NextResponse.json({ error: 'Listing not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
