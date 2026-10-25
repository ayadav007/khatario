import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne, queryRows } from '@/lib/db';
import { requireRegistrationAccess, registrationMigrationResponse } from '@/lib/business/registration-access';
import {
  isRegistrationKind,
  REGISTRATION_MAX_BYTES,
  safeRegistrationFileName,
  sniffRegistrationFile,
} from '@/lib/business/registration-ids';

export const dynamic = 'force-dynamic';

type DocRow = { kind: string; file_name: string; mime_type: string; uploaded_at: string };
type NumberRow = { udyam_number: string | null; tan: string | null; din: string | null };

/**
 * GET /api/business/registration-documents
 * Numbers and certificate names for the signed-in business. File bytes are not included.
 */
export async function GET(request: NextRequest) {
  try {
    const access = await requireRegistrationAccess(request, 'read');
    if (!access.ok) return access.response;

    const numbers = await queryOne<NumberRow>(
      `SELECT udyam_number, tan, din FROM businesses WHERE id = $1`,
      [access.businessId],
    );
    const docs = await queryRows<DocRow>(
      `SELECT kind, file_name, mime_type, uploaded_at
       FROM business_registration_documents
       WHERE business_id = $1`,
      [access.businessId],
    );
    const byKind = new Map(docs.map((row) => [row.kind, row]));
    const entry = (kind: 'msme' | 'tan' | 'din', number: string | null) => {
      const doc = byKind.get(kind);
      return {
        number,
        file_name: doc?.file_name ?? null,
        mime_type: doc?.mime_type ?? null,
        uploaded_at: doc?.uploaded_at ?? null,
      };
    };

    return NextResponse.json({
      msme: entry('msme', numbers?.udyam_number ?? null),
      tan: entry('tan', numbers?.tan ?? null),
      din: entry('din', numbers?.din ?? null),
    });
  } catch (error) {
    const migration = registrationMigrationResponse(error);
    if (migration) return migration;
    console.error('Error reading registration documents:', error);
    return NextResponse.json({ error: 'Failed to load registration details' }, { status: 500 });
  }
}

/**
 * POST /api/business/registration-documents
 * Replace the certificate for msme, tan, or din. PDF, JPEG, PNG, or WebP, up to 5 MB.
 */
export async function POST(request: NextRequest) {
  try {
    const access = await requireRegistrationAccess(request, 'update');
    if (!access.ok) return access.response;

    const form = await request.formData();
    const kind = form.get('kind');
    const file = form.get('file');
    if (!isRegistrationKind(kind)) {
      return NextResponse.json({ error: 'Choose MSME, TAN, or DIN', code: 'INVALID_KIND' }, { status: 400 });
    }
    if (!(file instanceof Blob) || file.size === undefined) {
      return NextResponse.json({ error: 'Choose a PDF or image', code: 'FILE_REQUIRED' }, { status: 400 });
    }
    if (file.size <= 0 || file.size > REGISTRATION_MAX_BYTES) {
      return NextResponse.json({ error: 'Certificate must be 5 MB or smaller', code: 'FILE_TOO_LARGE' }, { status: 400 });
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const sniffed = sniffRegistrationFile(bytes);
    if (!sniffed) {
      return NextResponse.json(
        { error: 'Use a PDF, JPEG, PNG, or WebP file', code: 'INVALID_FILE_TYPE' },
        { status: 400 },
      );
    }
    const fileName = safeRegistrationFileName(file instanceof File ? file.name : '', sniffed.mime);

    await query(
      `INSERT INTO business_registration_documents
         (business_id, kind, file_name, mime_type, file_bytes, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (business_id, kind) DO UPDATE SET
         file_name = EXCLUDED.file_name,
         mime_type = EXCLUDED.mime_type,
         file_bytes = EXCLUDED.file_bytes,
         uploaded_by = EXCLUDED.uploaded_by,
         uploaded_at = NOW()`,
      [access.businessId, kind, fileName, sniffed.mime, bytes, access.userId],
    );

    return NextResponse.json({ kind, file_name: fileName, mime_type: sniffed.mime });
  } catch (error) {
    const migration = registrationMigrationResponse(error);
    if (migration) return migration;
    console.error('Error saving registration document:', error);
    return NextResponse.json({ error: 'Failed to save the certificate' }, { status: 500 });
  }
}
