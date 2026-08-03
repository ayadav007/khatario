import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';

export const dynamic = 'force-dynamic';

import { requireTenantBusinessId } from '@/lib/auth-helpers';

/**
 * Legacy API — proxies reads/writes to business_template_assignments.
 * Kept for backward compatibility with older code paths.
 */

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const tenant = requireTenantBusinessId(req, searchParams.get('business_id'));
    if (!tenant.ok) return tenant.response;
    const business_id = tenant.businessId;

    const result = await db.queryOne(
      `SELECT template_id, settings FROM business_template_assignments 
       WHERE business_id = $1 AND document_type = 'tax_invoice'
       LIMIT 1`,
      [business_id]
    );

    if (result) {
      const settings = typeof result.settings === 'string'
        ? JSON.parse(result.settings)
        : result.settings || {};

      return NextResponse.json({
        ...settings,
        template_id: result.template_id
      });
    }

    return NextResponse.json({});
  } catch (error: any) {
    console.error('[Legacy Settings API] GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const tenant = requireTenantBusinessId(req, body.business_id);
    if (!tenant.ok) return tenant.response;
    const business_id = tenant.businessId;
    const { settings } = body;

    if (!business_id || !settings) {
      return NextResponse.json({ error: 'Missing business_id or settings' }, { status: 400 });
    }

    const templateId = settings.template_id || 'gst_standard';

    const result = await db.queryOne(
      `INSERT INTO business_template_assignments (business_id, document_type, template_id, settings)
       VALUES ($1, 'tax_invoice', $2, $3)
       ON CONFLICT (business_id, document_type)
       DO UPDATE SET template_id = $2, settings = $3, updated_at = NOW()
       RETURNING *`,
      [business_id, templateId, JSON.stringify(settings)]
    );

    return NextResponse.json(result);
  } catch (error: any) {
    console.error('[Legacy Settings API] POST error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
