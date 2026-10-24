import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest } from '@/lib/auth-helpers';
import { getDefaultTemplateSettings } from '@/lib/template-defaults';
import { TEMPLATE_REGISTRY } from '@/lib/template-registry-real';

export const dynamic = 'force-dynamic';

/**
 * GET /api/template-catalog
 * Template names and default print settings. The phone settings screen uses this
 * so it does not keep a second copy of the registry.
 */
export async function GET(request: NextRequest) {
  const userId = getUserIdFromRequest(request);
  if (!userId) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  return NextResponse.json({
    templates: TEMPLATE_REGISTRY.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      documentTypes: t.documentTypes,
      features: t.features,
      defaults: getDefaultTemplateSettings(t.id),
    })),
  });
}
