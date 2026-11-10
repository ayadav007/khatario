import type { PoolClient } from 'pg';
import { getPool, query, queryOne, queryRows } from '@/lib/db';
import { logActivity } from '@/lib/activity-logger';
import { csvSafeText } from '@/lib/csv-safe';
import { checkLimit } from '@/lib/subscription';
import { guessColumns } from '@/lib/import/match-columns';
import { isAmbiguousDate, normaliseKey } from '@/lib/import/parse-values';
import { readImportFile } from '@/lib/import/read-file';
import { buildRow, SECTIONS } from '@/lib/import/sections';
import type {
  BuiltRow,
  ColumnMatches,
  DateOrder,
  ImportField,
  SectionDefinition,
  SectionKey,
  ServiceCtx,
  SourceApp,
} from '@/lib/import/types';

const BATCH_SIZE = 200;
const UNDO_BATCH = 200;
const PROBLEM_PREVIEW_LIMIT = 50;
const HISTORY_LIMIT = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SOURCE_APPS: SourceApp[] = ['tally', 'vyapar', 'zoho_books', 'other'];

export type ImportRunErrorCode =
  | 'NOT_FOUND'
  | 'IMPORT_BUSY'
  | 'NOT_COMMITTABLE'
  | 'MISSING_REQUIRED'
  | 'UNRESOLVED_VALUES'
  | 'LIMIT_REACHED'
  | 'NOT_UNDOABLE';

/** A refusal the routes map to an HTTP status by `code`. */
export class ImportRunError extends Error {
  code: ImportRunErrorCode;
  constructor(code: ImportRunErrorCode, message: string) {
    super(message);
    this.name = 'ImportRunError';
    this.code = code;
  }
}

type RunStatus = 'draft' | 'committing' | 'done' | 'undone' | 'failed';
type Counts = { total: number; saved: number; skipped: number; failed: number };
type ProblemStatus = 'needs_attention' | 'already_exists' | 'failed';
/** A row that was not imported, with the user's own cells for the problem-rows file. */
interface ProblemRow {
  row_number: number;
  status: ProblemStatus;
  reasons: string[];
  cells: string[];
}

interface RunRow {
  id: string;
  business_id: string;
  section: SectionKey;
  source_app: SourceApp;
  file_name: string;
  status: RunStatus;
  headers: string[];
  draft_rows: string[][] | null;
  row_numbers: number[] | null;
  column_matches: ColumnMatches | null;
  value_matches: Record<string, Record<string, string>>;
  date_order: DateOrder;
  cursor: number;
  counts: Partial<Counts>;
  preview_ready: number | null;
  created_at: Date;
}

const RUN_COLUMNS = `id, business_id, section, source_app, file_name, status, headers, draft_rows, row_numbers,
  column_matches, value_matches, date_order, cursor, counts, preview_ready, created_at`;

async function loadRun(ctx: ServiceCtx, runId: string): Promise<RunRow> {
  const row = UUID.test(String(runId ?? ''))
    ? await queryOne<RunRow>(`SELECT ${RUN_COLUMNS} FROM import_runs WHERE id = $1 AND business_id = $2`, [
        runId,
        ctx.businessId,
      ])
    : null;
  if (!row || !SECTIONS[row.section]) throw new ImportRunError('NOT_FOUND', 'Import not found');
  return row;
}

function countsOf(run: RunRow): Counts {
  const c = run.counts ?? {};
  return { total: c.total ?? 0, saved: c.saved ?? 0, skipped: c.skipped ?? 0, failed: c.failed ?? 0 };
}

const hasError = (b: BuiltRow) => b.issues.some((i) => i.level === 'error');

function buildAll(def: SectionDefinition, run: RunRow): BuiltRow[] {
  const matches = run.column_matches ?? {};
  return (run.draft_rows ?? []).map((cells) =>
    buildRow(def, cells, run.headers, matches, { dateOrder: run.date_order, valueMatches: run.value_matches ?? {} })
  );
}

/** Labels of required fields no column is matched to. */
function missingRequiredOf(def: SectionDefinition, matches: ColumnMatches): string[] {
  const matched = new Set(Object.values(matches).filter(Boolean));
  return def.fields.filter((f) => f.required && !matched.has(f.key)).map((f) => f.label);
}

function unmatchedOf(def: SectionDefinition, built: BuiltRow[]): PreviewResult['unmatched'] {
  const byField = new Map<string, Map<string, string>>();
  for (const b of built) {
    for (const u of b.unmatched) {
      if (!byField.has(u.field)) byField.set(u.field, new Map());
      const values = byField.get(u.field)!;
      const key = normaliseKey(u.value);
      if (!values.has(key)) values.set(key, u.value);
    }
  }
  return def.fields
    .filter((f) => byField.has(f.key))
    .map((f) => ({ field: f.key, label: f.label, values: [...byField.get(f.key)!.values()] }));
}

/**
 * For each row, the index of the earlier row of this file with a shared duplicate key, or -1.
 * Keys are taken from every row without errors, in file order.
 */
function duplicateOf(def: SectionDefinition, built: BuiltRow[]): number[] {
  const firstRow = new Map<string, number>();
  return built.map((b, i) => {
    if (hasError(b)) return -1;
    const keys = def.duplicateKeys(b.values);
    const earlier = keys.map((k) => firstRow.get(k)).find((n) => n !== undefined);
    for (const k of keys) if (!firstRow.has(k)) firstRow.set(k, i);
    return earlier ?? -1;
  });
}

type Classified = { status: 'ready' | 'needs_attention' | 'already_exists'; reasons: string[] };

/** Errors first, then a record already in the business, then an earlier row of this file. */
async function classifyRow(
  ctx: ServiceCtx,
  def: SectionDefinition,
  built: BuiltRow[],
  dupOf: number[],
  rowNumbers: number[],
  i: number
): Promise<Classified> {
  const b = built[i];
  if (hasError(b)) {
    return { status: 'needs_attention', reasons: b.issues.filter((x) => x.level === 'error').map((x) => x.message) };
  }
  const existing = await def.findExisting(ctx, b.values);
  if (existing) {
    return { status: 'already_exists', reasons: [`Already exists: ${existing.label}, matched on ${existing.matchedOn}`] };
  }
  if (dupOf[i] >= 0) {
    return { status: 'already_exists', reasons: [`Same as row ${rowNumbers[dupOf[i]]} in this file`] };
  }
  return { status: 'ready', reasons: b.issues.map((x) => x.message) };
}

/** Whether `ready` more records fit the plan, as app/api/items/import does. */
async function limitFor(ctx: ServiceCtx, def: SectionDefinition, ready: number): Promise<PreviewResult['limit']> {
  if (ready === 0) return { allowed: true };
  const lc = await checkLimit(ctx.businessId, def.limitType);
  if (!lc.allowed || (lc.limit >= 0 && lc.current + ready > lc.limit)) {
    return {
      allowed: false,
      message: lc.message || `${def.label} limit would be exceeded by this import`,
    };
  }
  return { allowed: true };
}

/** A column guessed as a date whose values only read one way when day and month are swapped. */
function needsDateOrderFor(fields: ImportField[], guesses: ColumnMatches, rows: string[][]): boolean {
  const dateFields = new Set(fields.filter((f) => f.type === 'date').map((f) => f.key));
  for (const [index, key] of Object.entries(guesses)) {
    if (!key || !dateFields.has(key)) continue;
    const values = rows.map((r) => String(r[Number(index)] ?? '').trim()).filter(Boolean);
    const revealsOrder = values.some((v) => {
      const m = v.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/);
      return Boolean(m) && (Number(m![1]) > 12) !== (Number(m![2]) > 12);
    });
    if (!revealsOrder && values.some(isAmbiguousDate)) return true;
  }
  return false;
}

export async function createDraftRun(
  ctx: ServiceCtx,
  p: { section: SectionKey; sourceApp: SourceApp; fileName: string; buffer: Buffer }
): Promise<{
  runId: string;
  headers: string[];
  samples: string[][];
  guesses: ColumnMatches;
  fields: ImportField[];
  rowCount: number;
  needsDateOrder: boolean;
}> {
  const def = SECTIONS[p.section];
  if (!def) throw new ImportRunError('NOT_FOUND', 'Unknown import section');
  const sourceApp: SourceApp = SOURCE_APPS.includes(p.sourceApp) ? p.sourceApp : 'other';

  await query(
    `DELETE FROM import_runs WHERE business_id = $1 AND status = 'draft' AND created_at < now() - interval '24 hours'`,
    [ctx.businessId]
  );

  const file = await readImportFile(p.buffer, p.fileName);

  const savedRows = await queryRows<{ header_key: string; field_key: string | null }>(
    `SELECT header_key, field_key FROM import_column_matches WHERE business_id = $1 AND section = $2`,
    [ctx.businessId, def.key]
  );
  const saved: Record<string, string> = {};
  const savedSkip = new Set<string>();
  for (const r of savedRows) {
    if (r.field_key === null) savedSkip.add(r.header_key);
    else saved[r.header_key] = r.field_key;
  }
  const guesses = guessColumns({
    fields: def.fields,
    headers: file.headers,
    sampleRows: file.rows,
    sourceApp,
    section: def.key,
    saved,
  });
  // A header the user chose "Don't import" for last time stays unmatched.
  file.headers.forEach((h, i) => {
    if (savedSkip.has(normaliseKey(h))) guesses[i] = null;
  });

  const inserted = await queryOne<{ id: string }>(
    `INSERT INTO import_runs (business_id, section, source_app, file_name, status, headers, header_row_number,
       first_data_row_number, draft_rows, row_numbers, counts, created_by)
     VALUES ($1, $2, $3, $4, 'draft', $5, $6, $7, $8, $9, $10, $11)
     RETURNING id`,
    [
      ctx.businessId,
      def.key,
      sourceApp,
      p.fileName,
      JSON.stringify(file.headers),
      file.headerRowNumber,
      file.firstDataRowNumber,
      JSON.stringify(file.rows),
      JSON.stringify(file.rowNumbers),
      JSON.stringify({ total: file.rows.length, saved: 0, skipped: 0, failed: 0 }),
      ctx.userId,
    ]
  );

  return {
    runId: inserted!.id,
    headers: file.headers,
    samples: file.rows.slice(0, 3),
    guesses,
    fields: def.fields,
    rowCount: file.rows.length,
    needsDateOrder: needsDateOrderFor(def.fields, guesses, file.rows),
  };
}

export interface PreviewResult {
  ready: number;
  needsAttention: number;
  alreadyExists: number;
  warnings: number;
  unmatched: { field: string; label: string; values: string[] }[];
  /** First 50. */
  problems: { rowNumber: number; status: 'needs_attention' | 'already_exists'; reasons: string[] }[];
  /** Labels of required fields with no column. */
  missingRequired: string[];
  limit: { allowed: boolean; message?: string };
}

/** Only real columns and this section's fields; value matches keyed the way buildRow looks them up. */
function cleanMatches(def: SectionDefinition, headers: string[], p: { columnMatches: ColumnMatches; valueMatches: Record<string, Record<string, string>> }) {
  const fieldKeys = new Set(def.fields.map((f) => f.key));
  const columnMatches: ColumnMatches = {};
  headers.forEach((_, i) => {
    const key = p.columnMatches?.[i];
    columnMatches[i] = typeof key === 'string' && fieldKeys.has(key) ? key : null;
  });
  const choiceFields = new Set(
    def.fields.filter((f) => f.type === 'state' || f.type === 'unit' || f.type === 'tax_rate').map((f) => f.key)
  );
  const valueMatches: Record<string, Record<string, string>> = {};
  for (const [field, map] of Object.entries(p.valueMatches ?? {})) {
    if (!choiceFields.has(field) || !map || typeof map !== 'object') continue;
    valueMatches[field] = {};
    for (const [raw, chosen] of Object.entries(map)) {
      if (typeof chosen === 'string' && chosen.trim()) valueMatches[field][normaliseKey(raw)] = chosen.trim();
    }
  }
  return { columnMatches, valueMatches };
}

/** Every row built and classified; calls findExisting row by row for rows without errors. */
async function analyse(ctx: ServiceCtx, def: SectionDefinition, run: RunRow): Promise<PreviewResult> {
  const built = buildAll(def, run);
  const rowNumbers = run.row_numbers ?? [];
  const dupOf = duplicateOf(def, built);
  const classified: Classified[] = [];
  for (let i = 0; i < built.length; i++) classified.push(await classifyRow(ctx, def, built, dupOf, rowNumbers, i));

  let ready = 0;
  let needsAttention = 0;
  let alreadyExists = 0;
  let warnings = 0;
  const problems: PreviewResult['problems'] = [];
  classified.forEach((c, i) => {
    if (c.status === 'ready') {
      ready += 1;
      if (built[i].issues.some((x) => x.level === 'warning')) warnings += 1;
      return;
    }
    if (c.status === 'needs_attention') needsAttention += 1;
    else alreadyExists += 1;
    if (problems.length < PROBLEM_PREVIEW_LIMIT) problems.push({ rowNumber: rowNumbers[i], status: c.status, reasons: c.reasons });
  });

  return {
    ready,
    needsAttention,
    alreadyExists,
    warnings,
    unmatched: unmatchedOf(def, built),
    problems,
    missingRequired: missingRequiredOf(def, run.column_matches ?? {}),
    limit: await limitFor(ctx, def, ready),
  };
}

export async function previewRun(
  ctx: ServiceCtx,
  runId: string,
  p: { columnMatches: ColumnMatches; valueMatches: Record<string, Record<string, string>>; dateOrder: DateOrder }
): Promise<PreviewResult> {
  const run = await loadRun(ctx, runId);
  if (run.status !== 'draft' || !run.draft_rows) {
    throw new ImportRunError('NOT_COMMITTABLE', 'This import has already started');
  }
  const def = SECTIONS[run.section];
  const { columnMatches, valueMatches } = cleanMatches(def, run.headers, p);
  const dateOrder: DateOrder = p.dateOrder === 'mdy' ? 'mdy' : 'dmy';
  await query(
    `UPDATE import_runs SET column_matches = $3, value_matches = $4, date_order = $5, updated_at = now()
      WHERE id = $1 AND business_id = $2`,
    [run.id, ctx.businessId, JSON.stringify(columnMatches), JSON.stringify(valueMatches), dateOrder]
  );
  run.column_matches = columnMatches;
  run.value_matches = valueMatches;
  run.date_order = dateOrder;
  const preview = await analyse(ctx, def, run);
  await query(`UPDATE import_runs SET preview_ready = $3 WHERE id = $1 AND business_id = $2`, [
    run.id,
    ctx.businessId,
    preview.ready,
  ]);
  return preview;
}

/**
 * Runs `work` holding a session advisory lock for this business and section on a client kept
 * for the whole call. Saves happen on other connections (each service opens its own), so a
 * transaction-scoped lock would not cover them. The lock is released in `finally`; when the
 * unlock cannot run, the connection is destroyed instead, which drops its session locks.
 */
async function withRunLock<T>(ctx: ServiceCtx, def: SectionDefinition, work: () => Promise<T>): Promise<T> {
  const client: PoolClient = await getPool().connect();
  let locked = false;
  let destroy = false;
  try {
    const r = await client.query<{ ok: boolean }>(
      `SELECT pg_try_advisory_lock(hashtext('import:' || $1::text || ':' || $2)) AS ok`,
      [ctx.businessId, def.key]
    );
    if (!r.rows[0]?.ok) {
      throw new ImportRunError(
        'IMPORT_BUSY',
        `Another import of ${def.label.toLowerCase()} is running for this business. Try again when it finishes.`
      );
    }
    locked = true;
    return await work();
  } catch (e) {
    if (!locked && !(e instanceof ImportRunError)) destroy = true;
    throw e;
  } finally {
    if (locked) {
      try {
        await client.query(`SELECT pg_advisory_unlock(hashtext('import:' || $1::text || ':' || $2))`, [
          ctx.businessId,
          def.key,
        ]);
      } catch {
        destroy = true;
      }
    }
    client.release(destroy ? true : undefined);
  }
}

/**
 * Bookkeeping after a row: the import record (for a saved row), problem rows not yet written,
 * counts and cursor, in one transaction. The cursor never passes a row whose outcome is not stored.
 */
async function recordProgress(
  ctx: ServiceCtx,
  runId: string,
  cursor: number,
  counts: Counts,
  pending: ProblemRow[],
  record?: { table: string; id: string; rowNumber: number }
): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    if (record) {
      await client.query(
        `INSERT INTO import_run_records (run_id, business_id, record_table, record_id, row_number)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
        [runId, ctx.businessId, record.table, record.id, record.rowNumber]
      );
    }
    if (pending.length > 0) {
      await client.query(
        `INSERT INTO import_run_problems (run_id, business_id, row_number, status, reasons, cells)
         SELECT $1, $2, p.row_number, p.status, p.reasons, p.cells
           FROM jsonb_to_recordset($3::jsonb) AS p(row_number int, status text, reasons jsonb, cells jsonb)
         ON CONFLICT DO NOTHING`,
        [runId, ctx.businessId, JSON.stringify(pending)]
      );
    }
    await client.query(
      `UPDATE import_runs SET cursor = $3, counts = $4, updated_at = now() WHERE id = $1 AND business_id = $2`,
      [runId, ctx.businessId, cursor, JSON.stringify(counts)]
    );
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** Done: rows cleared, matches remembered for the next upload, one activity-log entry. */
async function finishRun(ctx: ServiceCtx, def: SectionDefinition, run: RunRow, counts: Counts): Promise<void> {
  const matches = new Map<string, string | null>();
  run.headers.forEach((h, i) => {
    const key = normaliseKey(h);
    if (key && !matches.has(key)) matches.set(key, run.column_matches?.[i] ?? null);
  });
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE import_runs SET status = 'done', draft_rows = NULL, row_numbers = NULL, counts = $3, updated_at = now()
        WHERE id = $1 AND business_id = $2`,
      [run.id, ctx.businessId, JSON.stringify(counts)]
    );
    for (const [headerKey, fieldKey] of matches) {
      await client.query(
        `INSERT INTO import_column_matches (business_id, section, header_key, field_key) VALUES ($1, $2, $3, $4)
         ON CONFLICT (business_id, section, header_key) DO UPDATE SET field_key = EXCLUDED.field_key`,
        [ctx.businessId, def.key, headerKey, fieldKey]
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
  await logActivity({
    business_id: ctx.businessId,
    user_id: ctx.userId,
    action_type: 'import',
    module: def.module,
    entity_id: run.id,
    entity_type: 'import_run',
    description: `Imported ${counts.saved} ${def.label.toLowerCase()} from ${run.file_name}`,
    metadata: { section: def.key, source_app: run.source_app, ...counts },
  });
}

async function runBatch(ctx: ServiceCtx, runId: string, def: SectionDefinition) {
  const run = await loadRun(ctx, runId);
  if (!['draft', 'committing', 'failed'].includes(run.status) || !run.draft_rows || !run.row_numbers) {
    throw new ImportRunError('NOT_COMMITTABLE', 'This import cannot be continued');
  }
  if (!run.column_matches || run.preview_ready === null) {
    throw new ImportRunError('NOT_COMMITTABLE', 'Check the file before importing');
  }
  const missing = missingRequiredOf(def, run.column_matches);
  if (missing.length > 0) throw new ImportRunError('MISSING_REQUIRED', `Match a column to: ${missing.join(', ')}`);

  // Checked in memory: rows are not looked up again here (the preview did that).
  const built = buildAll(def, run);
  if (unmatchedOf(def, built).length > 0) {
    throw new ImportRunError('UNRESOLVED_VALUES', 'Choose what each highlighted value means before importing');
  }
  if (run.status === 'draft') {
    const limit = await limitFor(ctx, def, run.preview_ready);
    if (!limit.allowed) throw new ImportRunError('LIMIT_REACHED', limit.message ?? `${def.label} limit reached`);
  }

  await query(`UPDATE import_runs SET status = 'committing', updated_at = now() WHERE id = $1 AND business_id = $2`, [
    run.id,
    ctx.businessId,
  ]);

  const rows = run.draft_rows;
  const rowNumbers = run.row_numbers;
  const total = rows.length;
  const counts = { ...countsOf(run), total };
  let cursor = run.cursor;

  try {
    const dupOf = duplicateOf(def, built);
    const end = Math.min(cursor + BATCH_SIZE, total);
    const lc = cursor < end ? await checkLimit(ctx.businessId, def.limitType) : null;
    let room = !lc || lc.limit < 0 ? Infinity : Math.max(0, lc.limit - lc.current);
    const limitMessage =
      lc?.message || `Your plan's ${def.label.toLowerCase()} limit is reached. Upgrade your plan to import this row.`;
    let pending: ProblemRow[] = [];
    const problem = (i: number, status: ProblemStatus, reasons: string[]) =>
      pending.push({ row_number: rowNumbers[i], status, reasons, cells: rows[i] });

    for (let i = cursor; i < end; i++) {
      const c = await classifyRow(ctx, def, built, dupOf, rowNumbers, i);
      if (c.status === 'needs_attention') {
        counts.failed += 1;
        problem(i, 'needs_attention', c.reasons);
        continue;
      }
      if (c.status === 'already_exists') {
        counts.skipped += 1;
        problem(i, 'already_exists', c.reasons);
        continue;
      }
      if (room <= 0) {
        counts.failed += 1;
        problem(i, 'failed', [limitMessage]);
        continue;
      }
      const saved = await def.saveRow(ctx, built[i].values);
      if (!saved.ok) {
        counts.failed += 1;
        problem(i, 'failed', [saved.error]);
        continue;
      }
      room -= 1;
      counts.saved += 1;
      await recordProgress(ctx, run.id, i + 1, counts, pending, {
        table: saved.table,
        id: saved.id,
        rowNumber: rowNumbers[i],
      });
      cursor = i + 1;
      pending = [];
    }
    if (cursor < end || pending.length > 0) {
      await recordProgress(ctx, run.id, end, counts, pending);
      cursor = end;
    }

    if (cursor >= total) await finishRun(ctx, def, run, counts);
  } catch (e) {
    // Not a problem with one row (an outage, a bug): stop here; the next call resumes at `cursor`.
    await query(`UPDATE import_runs SET status = 'failed', updated_at = now() WHERE id = $1 AND business_id = $2`, [
      run.id,
      ctx.businessId,
    ]).catch(() => {});
    throw e;
  }

  return { done: cursor >= total, processed: cursor, total, saved: counts.saved, skipped: counts.skipped, failed: counts.failed };
}

export async function commitNextBatch(
  ctx: ServiceCtx,
  runId: string
): Promise<{ done: boolean; processed: number; total: number; saved: number; skipped: number; failed: number }> {
  const def = SECTIONS[(await loadRun(ctx, runId)).section];
  return withRunLock(ctx, def, () => runBatch(ctx, runId, def));
}

export async function undoRun(ctx: ServiceCtx, runId: string): Promise<{ removed: number; kept: { label: string; reason: string }[] }> {
  const def = SECTIONS[(await loadRun(ctx, runId)).section];
  return withRunLock(ctx, def, async () => {
    const run = await loadRun(ctx, runId);
    // Holding the lock proves no batch is running, so a run left 'committing' is stuck and may be undone.
    if (run.status !== 'done' && run.status !== 'failed' && run.status !== 'committing') {
      throw new ImportRunError('NOT_UNDOABLE', 'Only a finished or stopped import can be undone');
    }
    const records = await queryRows<{ record_table: string; record_id: string }>(
      `SELECT record_table, record_id FROM import_run_records
        WHERE run_id = $1 AND business_id = $2 AND undone_at IS NULL
        ORDER BY row_number DESC`,
      [run.id, ctx.businessId]
    );
    let removed = 0;
    const kept: { label: string; reason: string }[] = [];
    for (let start = 0; start < records.length; start += UNDO_BATCH) {
      const ids = records.slice(start, start + UNDO_BATCH).map((r) => r.record_id);
      const results = await def.undoRecords(ctx, ids);
      const undone = results.filter((r) => r.ok).map((r) => r.id);
      if (undone.length > 0) {
        await query(
          `UPDATE import_run_records SET undone_at = now()
            WHERE run_id = $1 AND business_id = $2 AND record_id = ANY($3::uuid[])`,
          [run.id, ctx.businessId, undone]
        );
        removed += undone.length;
      }
      const refused = results.filter((r): r is { id: string; ok: false; reason: string } => !r.ok);
      if (refused.length > 0) {
        const names = await queryRows<{ id: string; name: string }>(
          `SELECT id, name FROM ${def.module} WHERE business_id = $1 AND id = ANY($2::uuid[])`,
          [ctx.businessId, refused.map((r) => r.id)]
        );
        const nameOf = new Map(names.map((n) => [n.id, n.name]));
        for (const r of refused) kept.push({ label: nameOf.get(r.id) ?? r.id, reason: r.reason });
      }
    }
    // An undone run (or a stopped one being undone) is never resumed: its rows are cleared.
    await query(
      `UPDATE import_runs
          SET status = CASE WHEN $3 THEN 'undone' ELSE status END,
              draft_rows = NULL, row_numbers = NULL, updated_at = now()
        WHERE id = $1 AND business_id = $2`,
      [run.id, ctx.businessId, kept.length === 0]
    );
    return { removed, kept };
  });
}

export interface RunSummary {
  id: string;
  section: SectionKey;
  sourceApp: SourceApp;
  fileName: string;
  status: 'committing' | 'done' | 'undone' | 'failed';
  saved: number;
  skipped: number;
  failed: number;
  processed: number;
  total: number;
  createdAt: string;
  createdByName: string | null;
}

/** Every status except draft, newest first, 50 at most. */
export async function listRuns(ctx: ServiceCtx, section?: SectionKey): Promise<RunSummary[]> {
  const rows = await queryRows<{
    id: string;
    section: SectionKey;
    source_app: SourceApp;
    file_name: string;
    status: RunSummary['status'];
    cursor: number;
    counts: Partial<Counts>;
    created_at: Date;
    created_by_name: string | null;
  }>(
    `SELECT r.id, r.section, r.source_app, r.file_name, r.status, r.cursor, r.counts, r.created_at,
            u.name AS created_by_name
       FROM import_runs r
       LEFT JOIN users u ON u.id = r.created_by AND u.business_id = r.business_id
      WHERE r.business_id = $1 AND r.status <> 'draft' AND ($2::text IS NULL OR r.section = $2)
      ORDER BY r.created_at DESC
      LIMIT ${HISTORY_LIMIT}`,
    [ctx.businessId, section ?? null]
  );
  return rows.map((r) => ({
    id: r.id,
    section: r.section,
    sourceApp: r.source_app,
    fileName: r.file_name,
    status: r.status,
    saved: r.counts?.saved ?? 0,
    skipped: r.counts?.skipped ?? 0,
    failed: r.counts?.failed ?? 0,
    processed: r.cursor,
    total: r.counts?.total ?? 0,
    createdAt: new Date(r.created_at).toISOString(),
    createdByName: r.created_by_name,
  }));
}

function csvCell(value: string): string {
  const safe = csvSafeText(value);
  return /[",\r\n]|^\s|\s$/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** The user's headers plus Row and Reason, one line per row that was not imported. */
export async function problemRowsCsv(ctx: ServiceCtx, runId: string): Promise<string> {
  const run = await loadRun(ctx, runId);
  const problems = await queryRows<ProblemRow>(
    `SELECT row_number, status, reasons, cells FROM import_run_problems
      WHERE run_id = $1 AND business_id = $2 ORDER BY row_number`,
    [run.id, ctx.businessId]
  );
  const lines = [[...run.headers, 'Row', 'Reason']];
  for (const p of problems) {
    lines.push([
      ...run.headers.map((_, i) => String(p.cells?.[i] ?? '')),
      String(p.row_number),
      (p.reasons ?? []).join('; '),
    ]);
  }
  return lines.map((cells) => cells.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
