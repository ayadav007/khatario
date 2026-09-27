import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { requireTenantBusinessId } from '@/lib/auth-helpers';
import { STUDIO_DRAFT_MAX_BYTES, sanitizeStudioDraft } from '@/lib/store/studio-draft';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tenant = requireTenantBusinessId(request, searchParams.get('business_id'));
  if (!tenant.ok) return tenant.response;
  try {
    const row = await queryOne<{ store_studio_draft: unknown; store_studio_draft_at: string | null }>(
      `SELECT store_studio_draft, store_studio_draft_at FROM business_settings WHERE business_id = $1`,
      [tenant.businessId],
    );
    const draft = row?.store_studio_draft ? sanitizeStudioDraft(row.store_studio_draft) : null;
    return NextResponse.json({ draft, saved_at: draft ? row?.store_studio_draft_at ?? null : null });
  } catch (error) {
    console.error('studio-draft GET:', error);
    return NextResponse.json({ error: 'Failed to load draft' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const raw = await request.text();
  if (raw.length > STUDIO_DRAFT_MAX_BYTES) {
    return NextResponse.json({ error: 'Draft is too large. Use image links instead of pasted images.' }, { status: 413 });
  }
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const tenant = requireTenantBusinessId(request, body.business_id as string | undefined);
  if (!tenant.ok) return tenant.response;
  const draft = sanitizeStudioDraft(body.draft);
  if (!draft) return NextResponse.json({ error: 'Invalid draft' }, { status: 400 });
  try {
    const row = await queryOne<{ store_studio_draft_at: string }>(
      `INSERT INTO business_settings (business_id, store_studio_draft, store_studio_draft_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (business_id) DO UPDATE
         SET store_studio_draft = EXCLUDED.store_studio_draft,
             store_studio_draft_at = EXCLUDED.store_studio_draft_at
       RETURNING store_studio_draft_at`,
      [tenant.businessId, JSON.stringify(draft)],
    );
    return NextResponse.json({ ok: true, saved_at: row?.store_studio_draft_at ?? null });
  } catch (error) {
    console.error('studio-draft PUT:', error);
    return NextResponse.json({ error: 'Failed to save draft' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tenant = requireTenantBusinessId(request, searchParams.get('business_id'));
  if (!tenant.ok) return tenant.response;
  try {
    await query(
      `UPDATE business_settings SET store_studio_draft = NULL, store_studio_draft_at = NULL WHERE business_id = $1`,
      [tenant.businessId],
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('studio-draft DELETE:', error);
    return NextResponse.json({ error: 'Failed to discard draft' }, { status: 500 });
  }
}
