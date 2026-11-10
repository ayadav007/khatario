import { query, queryOne, queryRows } from '@/lib/db';
import type { ServiceCtx } from '@/lib/import/types';

export type MasterTable = 'customers' | 'suppliers' | 'items';
const MASTER_TABLES: MasterTable[] = ['customers', 'suppliers', 'items'];

/** Tables never counted as a use: Task 8's run log points at imported records by design. */
const IGNORED_TABLES = new Set(['import_run_records']);

/** One foreign key as read from pg_constraint, columns in key order. */
export interface ForeignKeyRow {
  table_schema: string;
  table_name: string;
  ref_schema: string;
  ref_table: string;
  columns: string[];
  ref_columns: string[];
}

export interface ReferencingTable {
  schema: string;
  table: string;
  /** Columns holding the record's id; a row with any of them set to the id is a use. */
  columns: string[];
}

/**
 * Keeps foreign keys that point at public.customers, public.suppliers or public.items and,
 * for each, the column paired with the referenced `id` (so composite keys work). Keys from a
 * table to itself and from ignored tables are left out; keys from one table are merged.
 */
export function referenceColumnsFrom(rows: ForeignKeyRow[]): Record<MasterTable, ReferencingTable[]> {
  const result: Record<MasterTable, ReferencingTable[]> = { customers: [], suppliers: [], items: [] };
  for (const row of rows) {
    if (row.ref_schema !== 'public') continue;
    const target = MASTER_TABLES.find((t) => t === row.ref_table);
    if (!target) continue;
    if (row.table_schema === 'public' && row.table_name === target) continue;
    if (IGNORED_TABLES.has(row.table_name)) continue;
    const idAt = row.ref_columns.indexOf('id');
    const column = idAt >= 0 ? row.columns[idAt] : undefined;
    if (!column) continue;
    const list = result[target];
    const existing = list.find((r) => r.schema === row.table_schema && r.table === row.table_name);
    if (existing) {
      if (!existing.columns.includes(column)) existing.columns.push(column);
    } else {
      list.push({ schema: row.table_schema, table: row.table_name, columns: [column] });
    }
  }
  for (const list of Object.values(result)) list.sort((a, b) => a.table.localeCompare(b.table));
  return result;
}

let cached: Promise<Record<MasterTable, ReferencingTable[]>> | null = null;

/** Read once per process, so tables added by later migrations are covered without a list. */
function referencingTables(): Promise<Record<MasterTable, ReferencingTable[]>> {
  if (!cached) {
    cached = queryRows<ForeignKeyRow>(
      `SELECT tn.nspname AS table_schema, t.relname AS table_name,
              rn.nspname AS ref_schema, r.relname AS ref_table,
              ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(attnum, ord)
                      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
                     ORDER BY k.ord) AS columns,
              ARRAY(SELECT a.attname::text FROM unnest(c.confkey) WITH ORDINALITY k(attnum, ord)
                      JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.attnum
                     ORDER BY k.ord) AS ref_columns
         FROM pg_constraint c
         JOIN pg_class t ON t.oid = c.conrelid
         JOIN pg_namespace tn ON tn.oid = t.relnamespace
         JOIN pg_class r ON r.oid = c.confrelid
         JOIN pg_namespace rn ON rn.oid = r.relnamespace
        WHERE c.contype = 'f' AND r.relname = ANY($1::text[])`,
      [MASTER_TABLES]
    )
      .then(referenceColumnsFrom)
      .catch((e) => {
        cached = null;
        throw e;
      });
  }
  return cached;
}

const ident = (name: string) => `"${name.replace(/"/g, '""')}"`;

/**
 * Names of the tables (alphabetical) holding at least one row that points to the record.
 * Not scoped by business: any reference at all means the record is in use.
 */
export async function findReferences(table: MasterTable, id: string): Promise<string[]> {
  const tables = (await referencingTables())[table];
  if (tables.length === 0) return [];
  const parts = tables.map((t, i) => {
    const where = t.columns.map((c) => `${ident(c)} = $1`).join(' OR ');
    return `SELECT ${i} AS i WHERE EXISTS (SELECT 1 FROM ${ident(t.schema)}.${ident(t.table)} WHERE ${where})`;
  });
  const rows = await queryRows<{ i: number }>(parts.join(' UNION ALL '), [id]);
  return rows.map((r) => tables[r.i].table).sort();
}

/**
 * Undo for one imported record: kept when anything points to it, otherwise soft-deleted with
 * the statement the DELETE handlers use. A record already deleted counts as undone.
 */
export async function removeIfUnused(
  table: MasterTable,
  ctx: ServiceCtx,
  id: string
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const row = await queryOne<{ deleted_at: Date | null }>(
    `SELECT deleted_at FROM ${table} WHERE id = $1 AND business_id = $2`,
    [id, ctx.businessId]
  );
  if (!row) return { ok: false, reason: 'Not found' };
  if (row.deleted_at) return { ok: true };
  const used = await findReferences(table, id);
  if (used.length > 0) return { ok: false, reason: `Used in ${used[0].replace(/_/g, ' ')}` };
  await query(
    `UPDATE ${table} SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL`,
    [id, ctx.businessId]
  );
  return { ok: true };
}
