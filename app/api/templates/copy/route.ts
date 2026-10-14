import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getUserIdFromRequest, requireTenantBusinessId } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { denyIfFeatureMissing } from '@/lib/subscription/feature-access';

export const dynamic = 'force-dynamic';

/**
 * POST /api/templates/copy
 * Copy template settings to multiple document types for the signed-in business.
 * Body: { template_id, source_doc_type, target_doc_types: string[], business_id? }
 * business_id is ignored unless it matches the session.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const userId = getUserIdFromRequest(request);
    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const tenant = requireTenantBusinessId(request, body.business_id);
    if (!tenant.ok) return tenant.response;
    const businessId = tenant.businessId;

    try {
      await authorize(userId, 'settings', 'update', { businessId });
    } catch (error) {
      if (error instanceof AuthorizationError) return error.toNextResponse();
      throw error;
    }

    const denied = await denyIfFeatureMissing(businessId, 'settings_template_customization');
    if (denied) return denied;

    const { template_id, source_doc_type, target_doc_types } = body;

    if (!template_id || !source_doc_type || !Array.isArray(target_doc_types)) {
      return NextResponse.json(
        { error: 'template_id, source_doc_type, and target_doc_types[] are required' },
        { status: 400 }
      );
    }

    if (target_doc_types.length === 0) {
      return NextResponse.json(
        { error: 'At least one target document type is required' },
        { status: 400 }
      );
    }

    const sourceResult = await query(
      `SELECT settings FROM business_template_assignments 
       WHERE business_id = $1 AND document_type = $2`,
      [businessId, source_doc_type]
    );

    const sourceSettings = sourceResult.rows[0]?.settings || {};

    const copyPromises = target_doc_types.map((targetDocType: string) =>
      query(
        `INSERT INTO business_template_assignments 
           (business_id, template_id, document_type, settings) 
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (business_id, document_type) 
         DO UPDATE SET 
           template_id = EXCLUDED.template_id,
           settings = EXCLUDED.settings,
           updated_at = CURRENT_TIMESTAMP`,
        [businessId, template_id, targetDocType, JSON.stringify(sourceSettings)]
      )
    );

    await Promise.all(copyPromises);

    return NextResponse.json({
      success: true,
      message: `Template "${template_id}" copied to ${target_doc_types.length} document type(s)`,
      copied_to: target_doc_types
    });
  } catch (error) {
    console.error('Error copying template:', error);
    return NextResponse.json(
      { error: 'Failed to copy template' },
      { status: 500 }
    );
  }
}
