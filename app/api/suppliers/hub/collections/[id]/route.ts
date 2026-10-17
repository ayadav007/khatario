import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { requireAuthenticatedTenant } from '@/lib/stock-request-security';
import { CatalogInputError, publishCollection } from '@/lib/supplier-catalog';

export const dynamic = 'force-dynamic';

function errorResponse(error: unknown, fallback: string) {
  if (error instanceof CatalogInputError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof AuthorizationError) return error.toNextResponse();
  console.error(fallback, error);
  return NextResponse.json({ error: fallback }, { status: 500 });
}

/**
 * PATCH /api/suppliers/hub/collections/[id]
 * Body: { action?: 'publish' | 'archive', name?, season?, description?, cover_image_url?, audience? }
 * Publishing the first time notifies connected buyers (see lib/supplier-catalog).
 */
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = requireAuthenticatedTenant(request);
  if (auth instanceof NextResponse) return auth;
  const client = await db.getPool().connect();
  try {
    await authorize(auth.userId, 'items', 'update', { businessId: auth.businessId });
    const body = await request.json().catch(() => ({}));
    const existing = (
      await client.query(`SELECT id FROM supplier_collections WHERE id = $1 AND supplier_business_id = $2`, [
        params.id,
        auth.businessId,
      ])
    ).rows[0];
    if (!existing) throw new CatalogInputError('Collection not found', 404);

    const cover = body.cover_image_url !== undefined ? String(body.cover_image_url || '').trim() : undefined;
    if (cover && !/^https:\/\//i.test(cover) && !cover.startsWith('/')) {
      throw new CatalogInputError('Cover must be an https:// link or an uploaded file path');
    }

    await client.query('BEGIN');
    await client.query(
      `UPDATE supplier_collections SET
         name = COALESCE($3, name),
         season = CASE WHEN $4::boolean THEN $5 ELSE season END,
         description = CASE WHEN $6::boolean THEN $7 ELSE description END,
         cover_image_url = CASE WHEN $8::boolean THEN $9 ELSE cover_image_url END,
         audience = COALESCE($10, audience),
         updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND supplier_business_id = $2`,
      [
        params.id,
        auth.businessId,
        body.name ? String(body.name).trim().slice(0, 120) : null,
        body.season !== undefined,
        body.season ? String(body.season).slice(0, 60) : null,
        body.description !== undefined,
        body.description ? String(body.description).slice(0, 2000) : null,
        cover !== undefined,
        cover || null,
        body.audience === 'public_preview' || body.audience === 'linked_only' ? body.audience : null,
      ]
    );

    let notified = 0;
    if (body.action === 'publish') {
      notified = (await publishCollection(auth.businessId, params.id, client)).notified;
    } else if (body.action === 'archive') {
      await client.query(
        `UPDATE supplier_collections SET status = 'archived', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [params.id]
      );
    }
    await client.query('COMMIT');
    const collection = (await client.query(`SELECT * FROM supplier_collections WHERE id = $1`, [params.id])).rows[0];
    return NextResponse.json({ collection, notified });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    return errorResponse(error, 'Failed to update the collection');
  } finally {
    client.release();
  }
}

/** DELETE — only a draft that was never published; its items stay in the catalog. */
export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = requireAuthenticatedTenant(request);
  if (auth instanceof NextResponse) return auth;
  try {
    await authorize(auth.userId, 'items', 'update', { businessId: auth.businessId });
    const res = await db.query(
      `DELETE FROM supplier_collections
        WHERE id = $1 AND supplier_business_id = $2 AND status = 'draft' AND published_at IS NULL`,
      [params.id, auth.businessId]
    );
    if (!res.rowCount) {
      return NextResponse.json({ error: 'Only an unpublished draft can be deleted. Archive it instead.' }, { status: 409 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error, 'Failed to delete the collection');
  }
}
