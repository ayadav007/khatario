import { NextRequest, NextResponse } from 'next/server';
import { getBusinessIdFromRequest, getUserIdFromRequest } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { queryOne } from '@/lib/db';
import {
  listDocumentTemplates,
  mapRowToTemplate,
  DOCUMENT_ATTRIBUTES,
} from '@/lib/hr/document-templates';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    if (!businessId || !userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    await authorize(userId, 'settings', 'read', { businessId });
    const templates = await listDocumentTemplates(businessId);
    return NextResponse.json({ templates, attributes: DOCUMENT_ATTRIBUTES });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    return NextResponse.json({ error: 'Failed to load templates' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    if (!businessId || !userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    await authorize(userId, 'settings', 'update', { businessId });

    const body = await request.json();
    const name = String(body?.name ?? '').trim();
    if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 });

    const row = await queryOne(
      `INSERT INTO hr_document_templates (
         business_id, name, document_type, body_html, margin_mm, show_border, show_logo
       ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7) RETURNING *`,
      [
        businessId,
        name,
        String(body?.document_type ?? 'appointment_letter'),
        String(body?.body_html ?? '<p>Dear {{employee.first_name}},</p><p>We are pleased to appoint you as {{employee.designation}} effective {{employee.joining_date}}.</p>'),
        JSON.stringify(body?.margin_mm ?? { top: 20, right: 20, bottom: 20, left: 20 }),
        body?.show_border === true,
        body?.show_logo !== false,
      ],
    );
    return NextResponse.json({ template: mapRowToTemplate(row as Record<string, unknown>) });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    return NextResponse.json({ error: 'Failed to create template' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    if (!businessId || !userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    await authorize(userId, 'settings', 'update', { businessId });

    const body = await request.json();
    const id = String(body?.id ?? '');
    if (!id) return NextResponse.json({ error: 'Template id required' }, { status: 400 });

    const row = await queryOne(
      `UPDATE hr_document_templates SET
         name = COALESCE($3, name),
         body_html = COALESCE($4, body_html),
         margin_mm = COALESCE($5::jsonb, margin_mm),
         show_border = COALESCE($6, show_border),
         show_logo = COALESCE($7, show_logo),
         updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND business_id = $2 RETURNING *`,
      [
        id,
        businessId,
        body.name ? String(body.name) : null,
        body.body_html != null ? String(body.body_html) : null,
        body.margin_mm ? JSON.stringify(body.margin_mm) : null,
        body.show_border != null ? Boolean(body.show_border) : null,
        body.show_logo != null ? Boolean(body.show_logo) : null,
      ],
    );
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ template: mapRowToTemplate(row as Record<string, unknown>) });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    return NextResponse.json({ error: 'Failed to update template' }, { status: 500 });
  }
}
