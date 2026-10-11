import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { getUserIdFromRequest, requirePortalSession } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { normalizeDocumentLanguage, DOCUMENT_LANGUAGE_CODES } from '@/lib/print-language';
import { getBusinessDocumentLanguage } from '@/lib/print-language/storage';
import { hasTableColumn } from '@/lib/schema-columns';

export const dynamic = 'force-dynamic';

async function businessIdForUser(userId: string): Promise<string | null> {
  const user = await queryOne<{ business_id: string | null }>(
    'SELECT business_id FROM users WHERE id = $1',
    [userId],
  );
  return user?.business_id ?? null;
}

export async function GET(request: NextRequest) {
  try {
    const gate = await requirePortalSession(request);
    if (gate) return gate;

    const userId = getUserIdFromRequest(request);
    if (!userId) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const businessId = await businessIdForUser(userId);
    if (!businessId) {
      return NextResponse.json({ document_language: 'en' });
    }

    await authorize(userId, 'settings', 'read', { businessId });

    return NextResponse.json({
      document_language: await getBusinessDocumentLanguage(businessId),
    });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return error.toNextResponse();
    }
    console.error('document-language GET:', error);
    return NextResponse.json({ error: 'Failed to load document language' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const gate = await requirePortalSession(request);
    if (gate) return gate;

    const userId = getUserIdFromRequest(request);
    if (!userId) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const businessId = await businessIdForUser(userId);
    if (!businessId) {
      return NextResponse.json({ error: 'No business' }, { status: 400 });
    }

    await authorize(userId, 'settings', 'update', { businessId });

    if (!(await hasTableColumn('business_settings', 'document_language'))) {
      return NextResponse.json(
        { error: 'Print language is not available until the latest database migration is applied' },
        { status: 400 },
      );
    }

    const body = await request.json();
    const raw = String(body?.document_language ?? '').trim().toLowerCase();
    if (!DOCUMENT_LANGUAGE_CODES.includes(raw as (typeof DOCUMENT_LANGUAGE_CODES)[number])) {
      return NextResponse.json({ error: 'Choose a supported document language' }, { status: 400 });
    }

    const row = await queryOne<{ document_language: string }>(
      `INSERT INTO business_settings (business_id, document_language)
       VALUES ($1, $2)
       ON CONFLICT (business_id) DO UPDATE
       SET document_language = EXCLUDED.document_language, updated_at = CURRENT_TIMESTAMP
       RETURNING document_language`,
      [businessId, raw],
    );

    return NextResponse.json({
      document_language: normalizeDocumentLanguage(row?.document_language),
    });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return error.toNextResponse();
    }
    console.error('document-language PATCH:', error);
    return NextResponse.json({ error: 'Failed to save document language' }, { status: 500 });
  }
}
