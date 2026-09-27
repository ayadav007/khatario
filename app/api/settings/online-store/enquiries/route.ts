import { NextRequest, NextResponse } from 'next/server';
import { queryOne, queryRows } from '@/lib/db';
import { requireTenantBusinessId } from '@/lib/auth-helpers';
import { ENQUIRY_STATUSES, type EnquiryStatus } from '@/lib/store/enquiry';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f-]{36}$/i;
const SELECT = `id, name, phone, email, topic, message, source_path, status, created_at`;

/** GET /api/settings/online-store/enquiries — contact-form inbox. */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tenant = requireTenantBusinessId(request, searchParams.get('business_id'));
  if (!tenant.ok) return tenant.response;
  const businessId = tenant.businessId;

  const status = searchParams.get('status');
  const q = searchParams.get('q')?.trim();
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10) || 1);
  const limit = 20;

  const conditions = ['business_id = $1'];
  const params: unknown[] = [businessId];
  if (status && (ENQUIRY_STATUSES as readonly string[]).includes(status)) {
    params.push(status);
    conditions.push(`status = $${params.length}`);
  } else {
    conditions.push(`status <> 'archived'`);
  }
  if (q) {
    params.push(`%${q}%`);
    const i = params.length;
    conditions.push(`(name ILIKE $${i} OR COALESCE(phone,'') ILIKE $${i} OR COALESCE(email,'') ILIKE $${i} OR COALESCE(topic,'') ILIKE $${i} OR message ILIKE $${i})`);
  }
  const where = conditions.join(' AND ');

  const [rows, totals, unread] = await Promise.all([
    queryRows(
      `SELECT ${SELECT} FROM store_enquiries WHERE ${where}
       ORDER BY created_at DESC LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
      params,
    ),
    queryOne<{ count: string }>(`SELECT COUNT(*)::text AS count FROM store_enquiries WHERE ${where}`, params),
    queryOne<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM store_enquiries WHERE business_id = $1 AND status = 'new'`,
      [businessId],
    ),
  ]);

  return NextResponse.json({
    enquiries: rows,
    total: Number(totals?.count ?? 0),
    unread: Number(unread?.count ?? 0),
    page_size: limit,
  });
}

/** PATCH /api/settings/online-store/enquiries — { enquiry_id, status }. */
export async function PATCH(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const tenant = requireTenantBusinessId(request, body.business_id);
  if (!tenant.ok) return tenant.response;

  const id = String(body.enquiry_id ?? '');
  const status = body.status as EnquiryStatus;
  if (!UUID_RE.test(id) || !ENQUIRY_STATUSES.includes(status)) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const row = await queryOne(
    `UPDATE store_enquiries SET status = $3, updated_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND business_id = $2
     RETURNING ${SELECT}`,
    [id, tenant.businessId, status],
  );
  if (!row) return NextResponse.json({ error: 'Enquiry not found' }, { status: 404 });
  return NextResponse.json({ success: true, enquiry: row });
}
