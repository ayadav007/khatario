import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne, queryRows } from '@/lib/db';
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
 * GET  /api/label-templates?business_id=...
 *   Returns system templates (business_id IS NULL) + the caller's business
 *   templates, sorted by system-first then name.
 *
 * POST /api/label-templates
 *   Body: LabelTemplatePayload (see validatePayload). Creates a per-business
 *   template; system templates are seeded via migration and cannot be created
 *   through this endpoint.
 */

type FieldAlign = 'left' | 'center' | 'right';

interface FieldLayout {
  key: string;
  x_mm: number;
  y_mm: number;
  w_mm: number;
  h_mm: number;
  font_size?: number;
  bold?: boolean;
  align?: FieldAlign;
  visible: boolean;
  prefix?: string | null;
  suffix?: string | null;
}

interface LabelTemplatePayload {
  name: string;
  description?: string | null;
  format: 'A4_SHEET' | 'ROLL';
  width_mm: number;
  height_mm: number;
  columns?: number | null;
  rows_count?: number | null;
  gap_x_mm?: number;
  gap_y_mm?: number;
  margin_top_mm?: number;
  margin_left_mm?: number;
  symbology?: string;
  fields: FieldLayout[];
  is_active?: boolean;
}

const ALLOWED_FIELD_KEYS = new Set([
  'business_name',
  'brand',
  'product_name',
  'variant_name',
  'net_quantity',
  'barcode',
  'barcode_text',
  'price',
  'mrp',
  'hsn',
  'batch',
  'mfg',
  'expiry',
  'country_of_origin',
  'fssai',
]);

const ALLOWED_SYMBOLOGIES = new Set([
  'AUTO',
  'EAN13',
  'EAN8',
  'UPCA',
  'CODE128',
  'GS1_128',
  'QR',
  'CODE39',
]);

function validatePayload(payload: any): {
  ok: true;
  data: LabelTemplatePayload;
} | { ok: false; error: string } {
  if (!payload || typeof payload !== 'object')
    return { ok: false, error: 'Body required' };
  if (!payload.name || typeof payload.name !== 'string')
    return { ok: false, error: 'name is required' };
  if (payload.format !== 'A4_SHEET' && payload.format !== 'ROLL')
    return { ok: false, error: 'format must be A4_SHEET or ROLL' };
  const w = Number(payload.width_mm);
  const h = Number(payload.height_mm);
  if (!Number.isFinite(w) || w <= 0 || w > 500)
    return { ok: false, error: 'width_mm must be between 1 and 500' };
  if (!Number.isFinite(h) || h <= 0 || h > 500)
    return { ok: false, error: 'height_mm must be between 1 and 500' };

  const symbology = payload.symbology || 'AUTO';
  if (!ALLOWED_SYMBOLOGIES.has(symbology))
    return { ok: false, error: `Invalid symbology: ${symbology}` };

  if (!Array.isArray(payload.fields))
    return { ok: false, error: 'fields must be an array' };
  const fields: FieldLayout[] = [];
  for (const f of payload.fields) {
    if (!f || typeof f !== 'object')
      return { ok: false, error: 'Invalid field entry' };
    if (!ALLOWED_FIELD_KEYS.has(f.key))
      return { ok: false, error: `Unsupported field key: ${f.key}` };
    const fx = Number(f.x_mm);
    const fy = Number(f.y_mm);
    const fw = Number(f.w_mm);
    const fh = Number(f.h_mm);
    if ([fx, fy, fw, fh].some((n) => !Number.isFinite(n)))
      return { ok: false, error: `Field ${f.key} requires numeric x/y/w/h` };
    if (fw <= 0 || fh <= 0)
      return { ok: false, error: `Field ${f.key} must have positive size` };
    const align: FieldAlign =
      f.align === 'center' || f.align === 'right' ? f.align : 'left';
    fields.push({
      key: f.key,
      x_mm: fx,
      y_mm: fy,
      w_mm: fw,
      h_mm: fh,
      font_size: Number.isFinite(Number(f.font_size))
        ? Number(f.font_size)
        : undefined,
      bold: !!f.bold,
      align,
      visible: f.visible !== false,
      prefix: f.prefix ?? null,
      suffix: f.suffix ?? null,
    });
  }

  return {
    ok: true,
    data: {
      name: payload.name.trim().slice(0, 200),
      description: payload.description?.toString().slice(0, 1000) ?? null,
      format: payload.format,
      width_mm: w,
      height_mm: h,
      columns: payload.columns != null ? Number(payload.columns) : null,
      rows_count: payload.rows_count != null ? Number(payload.rows_count) : null,
      gap_x_mm: Number(payload.gap_x_mm) || 0,
      gap_y_mm: Number(payload.gap_y_mm) || 0,
      margin_top_mm: Number(payload.margin_top_mm) || 0,
      margin_left_mm: Number(payload.margin_left_mm) || 0,
      symbology,
      fields,
      is_active: payload.is_active !== false,
    },
  };
}

export async function GET(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request);
    if (!userId)
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );

    const businessId = getBusinessIdFromRequest(request);
    if (!businessId)
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );

    try {
      await authorize(userId, 'items', 'read');
    } catch (error) {
      if (error instanceof AuthorizationError)
        return error.toNextResponse();
      throw error;
    }

    try {
      await assertFeatureAccess(businessId, 'barcode_label_printing');
    } catch (err) {
      if (err instanceof FeatureAccessDeniedError)
        return NextResponse.json(err.toResponse(), { status: 403 });
      throw err;
    }

    const rows = await queryRows<any>(
      `SELECT id, business_id, name, description, format,
              width_mm, height_mm, columns, rows_count,
              gap_x_mm, gap_y_mm, margin_top_mm, margin_left_mm,
              symbology, fields, is_system, is_active,
              created_at, updated_at
         FROM label_templates
        WHERE (business_id IS NULL OR business_id = $1)
          AND COALESCE(is_active, TRUE) = TRUE
        ORDER BY is_system DESC, name ASC`,
      [businessId]
    );

    return NextResponse.json({ templates: rows });
  } catch (error: any) {
    console.error('[GET /api/label-templates] error:', error);
    return NextResponse.json(
      { error: error?.message || 'Failed to load label templates' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request);
    if (!userId)
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );

    const body = await request.json().catch(() => null);
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

    const check = validatePayload(body);
    if (!check.ok)
      return NextResponse.json({ error: check.error }, { status: 400 });
    const data = check.data;

    // Prevent duplicate name within same business.
    const existing = await queryOne<{ id: string }>(
      `SELECT id FROM label_templates
        WHERE business_id = $1 AND LOWER(name) = LOWER($2)`,
      [businessId, data.name]
    );
    if (existing)
      return NextResponse.json(
        { error: `A template named "${data.name}" already exists.` },
        { status: 409 }
      );

    const inserted = await queryOne<any>(
      `INSERT INTO label_templates (
         business_id, name, description, format,
         width_mm, height_mm, columns, rows_count,
         gap_x_mm, gap_y_mm, margin_top_mm, margin_left_mm,
         symbology, fields, is_system, is_active, created_by, updated_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,FALSE,$15,$16,$16)
       RETURNING *`,
      [
        businessId,
        data.name,
        data.description,
        data.format,
        data.width_mm,
        data.height_mm,
        data.columns ?? null,
        data.rows_count ?? null,
        data.gap_x_mm ?? 0,
        data.gap_y_mm ?? 0,
        data.margin_top_mm ?? 0,
        data.margin_left_mm ?? 0,
        data.symbology,
        JSON.stringify(data.fields),
        data.is_active !== false,
        userId,
      ]
    );

    return NextResponse.json({ template: inserted }, { status: 201 });
  } catch (error: any) {
    console.error('[POST /api/label-templates] error:', error);
    return NextResponse.json(
      { error: error?.message || 'Failed to create template' },
      { status: 500 }
    );
  }
}
