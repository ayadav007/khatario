import type { PoolClient } from 'pg';
import { getPool, queryRows } from '@/lib/db';
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
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Callers pass at most 200 ids per call; anything above this is a programming error. */
export const MAX_UNDO_BATCH = 500;

/** A pool or a transaction's client: anything with pg's query. */
type Queryable = Pick<PoolClient, 'query'>;

/**
 * For each record that something points to (keyed by lower-case id), the first referencing
 * table (alphabetical, raw name). One query per referencing table and column. Not scoped by business: any reference at
 * all means the record is in use.
 */
export async function findReferencesMany(
  table: MasterTable,
  ids: string[],
  client: Queryable = getPool()
): Promise<Map<string, string>> {
  const used = new Map<string, string>();
  const wanted = [...new Set(ids.filter((id) => UUID.test(id)).map((id) => id.toLowerCase()))];
  if (wanted.length === 0) return used;
  // Sorted by table name, so the first table to claim an id is the alphabetical first.
  for (const t of (await referencingTables())[table]) {
    for (const column of t.columns) {
      const rows = await client.query<{ id: string }>(
        `SELECT DISTINCT ${ident(column)} AS id FROM ${ident(t.schema)}.${ident(t.table)}
          WHERE ${ident(column)} = ANY($1::uuid[])`,
        [wanted]
      );
      for (const row of rows.rows) if (!used.has(row.id)) used.set(row.id, t.table);
    }
  }
  return used;
}

/** The first table (alphabetical) holding a row that points to the record, or none. */
export async function findReferences(table: MasterTable, id: string): Promise<string[]> {
  const first = (await findReferencesMany(table, [id])).get(id.toLowerCase());
  return first ? [first] : [];
}

export type UndoResult = { id: string; ok: true } | { id: string; ok: false; reason: string };

/**
 * Undo for a batch of imported records, in one transaction with the rows locked: an id outside
 * the business is 'Not found', one already deleted counts as undone, one `keep` names is kept
 * with its reason, one anything points to is kept as 'Used in ...', the rest are soft-deleted
 * (customers and suppliers are also made inactive, see below). One result per input id, in input order.
 */
export async function removeUnused(
  table: MasterTable,
  ctx: ServiceCtx,
  ids: string[],
  keep?: (client: Queryable, ids: string[]) => Promise<Map<string, string>>
): Promise<UndoResult[]> {
  if (ids.length > MAX_UNDO_BATCH) {
    throw new Error(`Undo takes at most ${MAX_UNDO_BATCH} records per call (got ${ids.length})`);
  }
  const reasons = new Map<string, string | null>(); // null: undone
  const wanted = [...new Set(ids.filter((id) => UUID.test(id)))];
  if (wanted.length > 0) {
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const locked = await client.query<{ id: string; deleted_at: Date | null }>(
        `SELECT id, deleted_at FROM ${table} WHERE id = ANY($1::uuid[]) AND business_id = $2 FOR UPDATE`,
        [wanted, ctx.businessId]
      );
      let live: string[] = [];
      for (const row of locked.rows) {
        if (row.deleted_at) reasons.set(row.id, null);
        else live.push(row.id);
      }
      if (keep && live.length > 0) {
        const kept = await keep(client, live);
        for (const [id, reason] of kept) reasons.set(id, reason);
        live = live.filter((id) => !kept.has(id));
      }
      const used = live.length > 0 ? await findReferencesMany(table, live, client) : new Map<string, string>();
      for (const [id, t] of used) reasons.set(id, `Used in ${t.replace(/_/g, ' ')}`);
      const unused = live.filter((id) => !used.has(id));
      if (unused.length > 0) {
        // Customers' phone and email unique indexes (migration 157) are partial on is_active, so
        // an undone customer must also be inactive or it keeps holding them. Suppliers and items
        // have no index partial on is_active, and supplier Restore clears only deleted_at, so they
        // keep is_active.
        const inactive = table === 'customers' ? ', is_active = false' : '';
        await client.query(
          `UPDATE ${table} SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP${inactive}
            WHERE id = ANY($1::uuid[]) AND business_id = $2 AND deleted_at IS NULL`,
          [unused, ctx.businessId]
        );
        for (const id of unused) reasons.set(id, null);
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }
  return ids.map((id) => {
    const key = UUID.test(id) ? id.toLowerCase() : id;
    if (!reasons.has(key)) return { id, ok: false, reason: 'Not found' };
    const reason = reasons.get(key);
    return reason ? { id, ok: false, reason } : { id, ok: true };
  });
}
