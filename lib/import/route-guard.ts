import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { requireStrictSession } from '@/lib/auth-helpers';
import { ImportFileError } from '@/lib/import/read-file';
import { ImportRunError } from '@/lib/import/run';
import { SECTIONS } from '@/lib/import/sections';
import type { SectionDefinition, SectionKey, ServiceCtx } from '@/lib/import/types';

export type ImportGuard =
  | { ok: true; ctx: ServiceCtx; def: SectionDefinition }
  | { ok: false; response: NextResponse };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const FILE_MESSAGES: Record<string, string> = {
  UNSUPPORTED_TYPE: 'Upload an Excel (.xlsx) or CSV file.',
  TOO_LARGE: 'This file is larger than 10 MB.',
  TOO_MANY_ROWS: 'This file has more than 10,000 rows. Split it into smaller files.',
  NO_HEADER: 'No column headings were found in this file.',
  UNREADABLE: 'This file could not be read. Save it again as Excel or CSV and retry.',
};

const RUN_ERRORS: Record<string, { status: number; message: string }> = {
  NOT_FOUND: { status: 404, message: 'This import was not found.' },
  IMPORT_BUSY: { status: 409, message: 'Another import for this list is running. Wait for it to finish.' },
  NOT_COMMITTABLE: { status: 409, message: 'This import cannot be continued. Start a new import.' },
  MISSING_REQUIRED: { status: 400, message: 'Match a column to every required field first.' },
  UNRESOLVED_VALUES: { status: 400, message: 'Choose a value for every unmatched entry first.' },
  NOT_UNDOABLE: { status: 409, message: 'This import cannot be undone.' },
};

export function badRequest(): NextResponse {
  return NextResponse.json({ error: 'Invalid request', code: 'BAD_REQUEST' }, { status: 400 });
}

export function runNotFound(): NextResponse {
  const { status, message } = RUN_ERRORS.NOT_FOUND;
  return NextResponse.json({ error: message, code: 'NOT_FOUND' }, { status });
}

export function isRunId(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

/** The response for an import or file error, or null when `e` is neither. */
export function importErrorResponse(e: unknown): NextResponse | null {
  if (e instanceof ImportRunError) {
    if (e.code === 'LIMIT_REACHED') return NextResponse.json({ error: e.message, code: e.code }, { status: 403 });
    const mapped = RUN_ERRORS[e.code];
    if (mapped) return NextResponse.json({ error: mapped.message, code: e.code }, { status: mapped.status });
    return null;
  }
  if (e instanceof ImportFileError) {
    return NextResponse.json({ error: FILE_MESSAGES[e.code] ?? e.message, code: e.code }, { status: 400 });
  }
  return null;
}

/** Known refusals as their response; anything else is logged and answered with a plain 500. */
export function importFailure(e: unknown): NextResponse {
  const mapped = importErrorResponse(e);
  if (mapped) return mapped;
  console.error('Import route error:', e);
  return NextResponse.json({ error: 'Import failed' }, { status: 500 });
}

/** Whether the signed-in user may use `module` for `action`; true or the response to send. */
async function permit(
  userId: string,
  businessId: string,
  module: SectionDefinition['module'],
  action: 'create' | 'read'
): Promise<NextResponse | null> {
  try {
    await authorize(userId, module, action, { businessId });
    return null;
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    throw error;
  }
}

/** Session, access boundary, known section and permission on the section's module. */
export async function guardImportRequest(
  request: NextRequest,
  sectionParam: string,
  action: 'create' | 'read'
): Promise<ImportGuard> {
  const session = await requireStrictSession(request);
  if (!session.ok) return { ok: false, response: session.response };
  const ctx: ServiceCtx = { businessId: session.businessId, userId: session.userId };

  const def = Object.prototype.hasOwnProperty.call(SECTIONS, sectionParam) ? SECTIONS[sectionParam as SectionKey] : null;
  if (!def) {
    return { ok: false, response: NextResponse.json({ error: 'Unknown import section', code: 'NOT_FOUND' }, { status: 404 }) };
  }

  const { checkEmployeeAccessBoundary } = await import('@/lib/access-boundary');
  const accessCheck = await checkEmployeeAccessBoundary(ctx.userId, 'portal');
  if (!accessCheck.allowed) {
    return { ok: false, response: NextResponse.json({ error: accessCheck.reason, code: 'ACCESS_DENIED' }, { status: 403 }) };
  }

  const denied = await permit(ctx.userId, ctx.businessId, def.module, action);
  if (denied) return { ok: false, response: denied };
  return { ok: true, ctx, def };
}

/** Modules the user may read, for the history list without a section. */
export async function readableSections(ctx: ServiceCtx): Promise<SectionKey[]> {
  const readable: SectionKey[] = [];
  for (const def of Object.values(SECTIONS)) {
    if ((await permit(ctx.userId, ctx.businessId, def.module, 'read')) === null) readable.push(def.key);
  }
  return readable;
}

/** Session, access boundary only (no section): for the history route. */
export async function guardImportSession(
  request: NextRequest
): Promise<{ ok: true; ctx: ServiceCtx } | { ok: false; response: NextResponse }> {
  const session = await requireStrictSession(request);
  if (!session.ok) return { ok: false, response: session.response };
  const ctx: ServiceCtx = { businessId: session.businessId, userId: session.userId };
  const { checkEmployeeAccessBoundary } = await import('@/lib/access-boundary');
  const accessCheck = await checkEmployeeAccessBoundary(ctx.userId, 'portal');
  if (!accessCheck.allowed) {
    return { ok: false, response: NextResponse.json({ error: accessCheck.reason, code: 'ACCESS_DENIED' }, { status: 403 }) };
  }
  return { ok: true, ctx };
}

/**
 * The run's column count when it belongs to this business and section, else null. Keeps a user
 * with rights on one module from reaching another module's run through that module's URL.
 */
export async function runColumnCount(ctx: ServiceCtx, runId: string, def: SectionDefinition): Promise<number | null> {
  if (!isRunId(runId)) return null;
  const row = await queryOne<{ n: number }>(
    `SELECT jsonb_array_length(headers::jsonb)::int AS n FROM import_runs
      WHERE id = $1 AND business_id = $2 AND section = $3`,
    [runId, ctx.businessId, def.key]
  );
  return row ? row.n : null;
}
