// Server-only. D33/D34: the store's first live engine theme is its migrated design. `runStoreThemeMigration` runs
// the migration for many stores (scripts/migrate-store-themes.mjs).
// It never writes business_settings (store_engine, store_theme): only store_themes rows of the business being migrated.
import { getPool, query } from '@/lib/db';
import { migrateStoreTheme } from './migrate';
import { migrationInputFor } from './migration-input';
import { insertMigratedLiveLocked, lockBusinessThemes } from './themes-repo';
import { PREVIEW_TTL, signThemePreview } from './preview-token';
// M4 7: the input reader lives in migration-input.ts; re-exported so the script and its tests keep this import.
export { migrationInputFor, type MigrationInput } from './migration-input';
// Calls to `currentDatabaseName` go through the module's own exports so a test can stub the database name.
import * as self from './migrate-runner';

export const MIGRATION_DATABASE = 'kh_phase2_test';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ERROR_MAX = 500;

export class MigrationRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MigrationRefusedError';
  }
}

/** The test database always; any other only when `allow` names it exactly. */
export function migrationDatabaseAllowed(actual: string, allow: string | null): boolean {
  if (!actual) return false;
  if (actual === MIGRATION_DATABASE) return true;
  return typeof allow === 'string' && allow !== '' && allow === actual;
}

/** `SELECT current_database()`: the runner's first query. */
export async function currentDatabaseName(): Promise<string> {
  const res = await query<{ name: string }>(`SELECT current_database() AS name`);
  return String(res.rows[0]?.name ?? '');
}

export interface MigrationOptions {
  businessIds?: string[];
  all?: boolean;
  dryRun?: boolean;
  allowDatabase?: string | null;
  previewLinks?: boolean;
}

export interface MigrationReportRow {
  business_id: string;
  subdomain: string | null;
  status: 'migrated' | 'skipped_live' | 'would_migrate' | 'failed' | 'not_found';
  preset?: string;
  theme_id?: string;
  warnings: string[];
  preview_path?: string;
  error?: string;
}

/**
 * The script's exit code for a finished run: 1 when any business failed, or when ids were given explicitly
 * (`--business`) and one names no business (a mistyped uuid must not look like success); else 0.
 */
export function migrationExitCode(rows: Array<Pick<MigrationReportRow, 'status'>>, explicitIds: boolean): 0 | 1 {
  return rows.some((r) => r.status === 'failed' || (explicitIds && r.status === 'not_found')) ? 1 : 0;
}

function errorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.slice(0, ERROR_MAX);
}

function previewSecretConfigured(): boolean {
  return Boolean(process.env.JWT_SECRET || process.env.NEXTAUTH_SECRET);
}

async function targetsFor(opts: MigrationOptions): Promise<Array<{ business_id: string; subdomain: string | null; found: boolean }>> {
  if (opts.all) {
    const res = await query<{ business_id: string; subdomain: string }>(
      `SELECT b.id AS business_id, btrim(bs.store_subdomain) AS subdomain
         FROM businesses b
         JOIN business_settings bs ON bs.business_id = b.id
        WHERE btrim(coalesce(bs.store_subdomain, '')) <> ''
        ORDER BY btrim(bs.store_subdomain), b.id`,
    );
    return res.rows.map((r) => ({ business_id: r.business_id, subdomain: r.subdomain, found: true }));
  }
  const ids = Array.from(new Set((opts.businessIds ?? []).map((id) => id.toLowerCase())));
  const res = await query<{ business_id: string; subdomain: string | null }>(
    `SELECT b.id AS business_id, nullif(btrim(bs.store_subdomain), '') AS subdomain
       FROM businesses b
       LEFT JOIN business_settings bs ON bs.business_id = b.id
      WHERE b.id = ANY($1::uuid[])`,
    [ids],
  );
  const found = new Map(res.rows.map((r) => [String(r.business_id).toLowerCase(), r.subdomain]));
  return ids.map((id) => ({ business_id: id, subdomain: found.get(id) ?? null, found: found.has(id) }));
}

/** One business, in its own transaction under the business advisory lock. */
async function migrateOne(
  target: { business_id: string; subdomain: string | null },
  opts: MigrationOptions,
): Promise<MigrationReportRow> {
  const base = { business_id: target.business_id, subdomain: target.subdomain };
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await lockBusinessThemes(client, target.business_id);
    const live = await client.query(`SELECT 1 FROM store_themes WHERE business_id = $1 AND role = 'live'`, [target.business_id]);
    let row: MigrationReportRow;
    if (live.rows.length > 0) {
      row = { ...base, status: 'skipped_live', warnings: [] };
    } else {
      const input = await migrationInputFor(target.business_id, client);
      if (!input) {
        row = { ...base, status: 'not_found', warnings: [] };
      } else if (opts.dryRun) {
        const result = migrateStoreTheme(input.raw, input.ctx);
        row = { ...base, status: 'would_migrate', preset: result.preset, warnings: result.warnings };
      } else {
        const inserted = await insertMigratedLiveLocked(client, target.business_id, null, input);
        if (!inserted) {
          row = { ...base, status: 'failed', warnings: [], error: 'The store already has the most themes allowed (limit).' };
        } else {
          row = {
            ...base,
            status: 'migrated',
            preset: inserted.theme.preset,
            theme_id: inserted.theme.id,
            warnings: inserted.warnings,
          };
          if (opts.previewLinks && previewSecretConfigured()) {
            const pt = signThemePreview(target.business_id, inserted.theme.id, PREVIEW_TTL.share);
            row.preview_path = `/?preview_theme=${encodeURIComponent(inserted.theme.id)}&pt=${encodeURIComponent(pt)}`;
          }
        }
      }
    }
    await client.query(opts.dryRun ? 'ROLLBACK' : 'COMMIT');
    return row;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // the original error matters more than a failed rollback
    }
    return { ...base, status: 'failed', warnings: [], error: errorMessage(err) };
  } finally {
    client.release();
  }
}

/**
 * D34. Refuses (MigrationRefusedError) before any other query unless the database is kh_phase2_test or exactly
 * `allowDatabase`; then migrates each chosen business that has no live theme. One failure does not stop the others.
 */
export async function runStoreThemeMigration(
  opts: MigrationOptions,
): Promise<{ database: string; dryRun: boolean; rows: MigrationReportRow[] }> {
  const database = await self.currentDatabaseName();
  if (!migrationDatabaseAllowed(database, opts.allowDatabase ?? null)) {
    throw new MigrationRefusedError(
      `Refusing to run on ${database || '(unknown database)'}: only ${MIGRATION_DATABASE}, or the database named exactly by --allow-database.`,
    );
  }
  const ids = opts.businessIds ?? [];
  const hasIds = ids.length > 0;
  if (Boolean(opts.all) === hasIds) {
    throw new MigrationRefusedError('Choose exactly one of --all or --business <uuid>.');
  }
  const bad = ids.find((id) => typeof id !== 'string' || !UUID_RE.test(id));
  if (bad !== undefined) throw new MigrationRefusedError('Every --business must be a uuid.');

  const dryRun = Boolean(opts.dryRun);
  const rows: MigrationReportRow[] = [];
  for (const target of await targetsFor(opts)) {
    if (!target.found) {
      rows.push({ business_id: target.business_id, subdomain: null, status: 'not_found', warnings: [] });
      continue;
    }
    rows.push(await migrateOne(target, { ...opts, dryRun }));
  }
  return { database, dryRun, rows };
}
