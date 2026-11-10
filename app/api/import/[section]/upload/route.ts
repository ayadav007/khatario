import { NextRequest, NextResponse } from 'next/server';
import { createDraftRun } from '@/lib/import/run';
import { badRequest, guardImportRequest, importFailure } from '@/lib/import/route-guard';
import { ImportFileError } from '@/lib/import/read-file';
import type { SourceApp } from '@/lib/import/types';

export const dynamic = 'force-dynamic';

const MAX_BYTES = 10 * 1024 * 1024;
const SOURCE_APPS: string[] = ['tally', 'vyapar', 'zoho_books', 'other'];

export async function POST(request: NextRequest, { params }: { params: { section: string } }) {
  try {
    const guard = await guardImportRequest(request, params.section, 'create');
    if (!guard.ok) return guard.response;

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return badRequest();
    }
    const file = form.get('file');
    if (!file || typeof file === 'string') return badRequest();
    const sourceRaw = form.get('source_app');
    if (typeof sourceRaw === 'string' && sourceRaw !== '' && !SOURCE_APPS.includes(sourceRaw)) return badRequest();
    const sourceApp = (typeof sourceRaw === 'string' && sourceRaw !== '' ? sourceRaw : 'other') as SourceApp;

    // Checked before the bytes are read into memory.
    if (file.size > MAX_BYTES) throw new ImportFileError('TOO_LARGE', 'The file is larger than 10 MB.');
    const buffer = Buffer.from(await file.arrayBuffer());

    const result = await createDraftRun(guard.ctx, { section: guard.def.key, sourceApp, fileName: file.name, buffer });
    return NextResponse.json(result);
  } catch (e) {
    return importFailure(e);
  }
}
