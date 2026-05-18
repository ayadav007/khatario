import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import {
  getUserIdFromRequest,
  getBusinessIdFromRequest,
} from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import {
  assertFeatureAccess,
  FeatureAccessDeniedError,
} from '@/lib/subscription/feature-access';

/**
 * POST /api/label-templates/[id]/duplicate
 *
 * Copies a template (system or owned) into the caller's business as an
 * editable custom template. Used by the designer UI's "Duplicate" action.
 *
 * Body: { name?: string } — optional override; otherwise "<Source Name> (Copy)"
 */

export async function POST(
  request: NextRequest,
  context: { params: { id: string } }
) {
  try {
    const userId = getUserIdFromRequest(request);
    if (!userId)
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );

    const body = await request.json().catch(() => ({} as any));
    const businessId = getBusinessIdFromRequest(request, body);
    if (!businessId)
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );

    try {
      await authorize(userId, 'items', 'create');
    } catch (error) {
      if (error instanceof AuthorizationError)
        return error.toNextResponse();
      throw error;
    }

    try {
      await assertFeatureAccess(businessId, 'barcode_label_templates');
    } catch (err) {
      if (err instanceof FeatureAccessDeniedError)
        return NextResponse.json(err.toResponse(), { status: 403 });
      throw err;
    }

    const src = await queryOne<any>(
      `SELECT * FROM label_templates
        WHERE id = $1
          AND (business_id IS NULL OR business_id = $2)`,
      [context.params.id, businessId]
    );
    if (!src)
      return NextResponse.json(
        { error: 'Source template not found' },
        { status: 404 }
      );

    const requestedName: string | null =
      typeof body?.name === 'string' && body.name.trim()
        ? body.name.trim().slice(0, 200)
        : null;

    // Find a unique name: caller-provided, else "<src> (Copy)", then "(Copy 2)", etc.
    let baseName = requestedName ?? `${src.name} (Copy)`;
    let finalName = baseName;
    for (let i = 2; i < 50; i++) {
      const clash = await queryOne<{ id: string }>(
        `SELECT id FROM label_templates
          WHERE business_id = $1 AND LOWER(name) = LOWER($2)`,
        [businessId, finalName]
      );
      if (!clash) break;
      finalName = `${baseName} ${i}`;
    }

    const cloned = await queryOne<any>(
      `INSERT INTO label_templates (
         business_id, name, description, format,
         width_mm, height_mm, columns, rows_count,
         gap_x_mm, gap_y_mm, margin_top_mm, margin_left_mm,
         symbology, fields, is_system, is_active, created_by, updated_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,FALSE,TRUE,$15,$15)
       RETURNING *`,
      [
        businessId,
        finalName,
        src.description,
        src.format,
        src.width_mm,
        src.height_mm,
        src.columns,
        src.rows_count,
        src.gap_x_mm,
        src.gap_y_mm,
        src.margin_top_mm,
        src.margin_left_mm,
        src.symbology,
        src.fields,
        userId,
      ]
    );

    return NextResponse.json({ template: cloned }, { status: 201 });
  } catch (error: any) {
    console.error(
      '[POST /api/label-templates/[id]/duplicate] error:',
      error
    );
    return NextResponse.json(
      { error: error?.message || 'Failed to duplicate template' },
      { status: 500 }
    );
  }
}
