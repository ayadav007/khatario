import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { requireRegistrationAccess, registrationMigrationResponse } from '@/lib/business/registration-access';
import { isRegistrationKind } from '@/lib/business/registration-ids';

export const dynamic = 'force-dynamic';

type StoredFile = { file_name: string; mime_type: string; file_bytes: Buffer };

function kindFrom(params: { kind: string }) {
  return isRegistrationKind(params.kind) ? params.kind : null;
}

/**
 * GET /api/business/registration-documents/[kind]
 * The certificate itself, for the signed-in business only.
 */
export async function GET(request: NextRequest, { params }: { params: { kind: string } }) {
  try {
    const kind = kindFrom(params);
    if (!kind) {
      return NextResponse.json({ error: 'Choose MSME, TAN, or DIN', code: 'INVALID_KIND' }, { status: 400 });
    }
    const access = await requireRegistrationAccess(request, 'read');
    if (!access.ok) return access.response;

    const row = await queryOne<StoredFile>(
      `SELECT file_name, mime_type, file_bytes
       FROM business_registration_documents
       WHERE business_id = $1 AND kind = $2`,
      [access.businessId, kind],
    );
    if (!row) {
      return NextResponse.json({ error: 'No certificate uploaded', code: 'NOT_FOUND' }, { status: 404 });
    }

    const fileName = row.file_name.replace(/["\r\n]/g, '');
    const body = new Uint8Array(row.file_bytes);
    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': row.mime_type,
        'Content-Disposition': `inline; filename="${fileName}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    const migration = registrationMigrationResponse(error);
    if (migration) return migration;
    console.error('Error reading registration certificate:', error);
    return NextResponse.json({ error: 'Failed to open the certificate' }, { status: 500 });
  }
}

/**
 * DELETE /api/business/registration-documents/[kind]
 * Remove the certificate. The registration number is left as it is.
 */
export async function DELETE(request: NextRequest, { params }: { params: { kind: string } }) {
  try {
    const kind = kindFrom(params);
    if (!kind) {
      return NextResponse.json({ error: 'Choose MSME, TAN, or DIN', code: 'INVALID_KIND' }, { status: 400 });
    }
    const access = await requireRegistrationAccess(request, 'update');
    if (!access.ok) return access.response;

    await query(
      `DELETE FROM business_registration_documents WHERE business_id = $1 AND kind = $2`,
      [access.businessId, kind],
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    const migration = registrationMigrationResponse(error);
    if (migration) return migration;
    console.error('Error deleting registration certificate:', error);
    return NextResponse.json({ error: 'Failed to remove the certificate' }, { status: 500 });
  }
}
