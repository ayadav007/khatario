import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import type { BusinessDiscovery } from '@/types/database';
import { normalizeCategoryList } from '@/lib/suppliers-hub';

/**
 * GET /api/suppliers/hub/discovery — current business discovery settings
 * PATCH — update (requires updated_by_user_id)
 */
export async function GET(request: NextRequest) {
  try {
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    if (!businessId || !userId) {
      return NextResponse.json({ error: 'business_id and user context required' }, { status: 400 });
    }
    try {
      await authorize(userId, 'settings', 'read', { businessId });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    const row = await db.queryOne<BusinessDiscovery>(
      `SELECT * FROM business_discovery WHERE business_id = $1`,
      [businessId]
    );
    if (!row) {
      return NextResponse.json({
        discovery: {
          business_id: businessId,
          visibility: 'hidden',
          profile_summary: null,
          featured_categories: [],
          public_slug: null,
          directory_approved: true,
        },
      });
    }
    return NextResponse.json({ discovery: row });
  } catch (e: any) {
    console.error('hub discovery GET', e);
    return NextResponse.json({ error: e.message || 'Failed' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const businessId = getBusinessIdFromRequest(request, body);
    const {
      visibility,
      profile_summary,
      featured_categories,
      public_slug,
      updated_by_user_id,
      directory_approved,
    } = body;

    if (!businessId) {
      return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
    }
    if (!updated_by_user_id) {
      return NextResponse.json(
        { error: 'updated_by_user_id is required for authorization' },
        { status: 400 }
      );
    }

    try {
      await authorize(updated_by_user_id, 'settings', 'update', { businessId });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    const vis = visibility as string | undefined;
    if (vis && !['hidden', 'directory', 'link_only'].includes(vis)) {
      return NextResponse.json({ error: 'Invalid visibility' }, { status: 400 });
    }

    const existing = await db.queryOne<BusinessDiscovery>(
      `SELECT * FROM business_discovery WHERE business_id = $1`,
      [businessId]
    );

    const nextVis = (vis ?? existing?.visibility ?? 'hidden') as BusinessDiscovery['visibility'];
    const nextSummary =
      profile_summary !== undefined
        ? profile_summary === null
          ? null
          : String(profile_summary)
        : existing?.profile_summary ?? null;
    const nextCats =
      featured_categories !== undefined
        ? normalizeCategoryList(featured_categories)
        : existing?.featured_categories ?? [];
    let nextSlug =
      public_slug !== undefined
        ? public_slug === null || public_slug === ''
          ? null
          : String(public_slug)
              .trim()
              .toLowerCase()
              .replace(/[^a-z0-9-]/g, '-')
              .replace(/-+/g, '-')
              .replace(/^-|-$/g, '')
              .slice(0, 80)
        : existing?.public_slug ?? null;
    const nextApproved =
      directory_approved !== undefined
        ? Boolean(directory_approved)
        : existing?.directory_approved ?? true;

    if (nextSlug) {
      const taken = await db.queryOne(
        `SELECT business_id FROM business_discovery WHERE public_slug = $1 AND business_id <> $2`,
        [nextSlug, businessId]
      );
      if (taken) {
        return NextResponse.json({ error: 'This public URL slug is already taken' }, { status: 409 });
      }
    }

    if (nextVis === 'directory' && nextApproved) {
      const eff = (nextSummary || '').trim();
      if (eff.length < 10) {
        return NextResponse.json(
          {
            error:
              'Directory visibility requires a short profile summary (at least 10 characters).',
          },
          { status: 400 }
        );
      }
    }

    let updated: BusinessDiscovery | null;
    if (!existing) {
      updated = await db.queryOne<BusinessDiscovery>(
        `
        INSERT INTO business_discovery (
          business_id, visibility, profile_summary, featured_categories, public_slug,
          directory_approved, updated_by_user_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *
        `,
        [
          businessId,
          nextVis,
          nextSummary,
          nextCats,
          nextSlug,
          nextApproved,
          updated_by_user_id,
        ]
      );
    } else {
      updated = await db.queryOne<BusinessDiscovery>(
        `
        UPDATE business_discovery SET
          visibility = $2,
          profile_summary = $3,
          featured_categories = $4,
          public_slug = $5,
          directory_approved = $6,
          updated_by_user_id = $7,
          updated_at = CURRENT_TIMESTAMP
        WHERE business_id = $1
        RETURNING *
        `,
        [
          businessId,
          nextVis,
          nextSummary,
          nextCats,
          nextSlug,
          nextApproved,
          updated_by_user_id,
        ]
      );
    }

    return NextResponse.json({ discovery: updated });
  } catch (e: any) {
    console.error('hub discovery PATCH', e);
    return NextResponse.json({ error: e.message || 'Failed' }, { status: 500 });
  }
}
