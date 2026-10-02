export interface Queryable {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;
}

/** Document series numbered as `<prefix>-NNN`, unique per business. */
export interface SeriesSpec {
  /** `branch_document_prefixes.document_type`, also the advisory-lock key. */
  documentType: string;
  table: string;
  column: string;
  defaultPrefix: string;
}

export const DELIVERY_CHALLAN_SERIES: SeriesSpec = {
  documentType: 'delivery_challan',
  table: 'delivery_challans',
  column: 'challan_number',
  defaultPrefix: 'DC',
};

export const WORK_ORDER_SERIES: SeriesSpec = {
  documentType: 'work_order',
  table: 'work_orders',
  column: 'work_order_number',
  defaultPrefix: 'WO',
};

/** The requested branch if it belongs to the business, else the default active branch. */
export async function resolveDocumentBranchId(
  db: Queryable,
  businessId: string,
  branchId?: string | null
): Promise<string | null> {
  if (branchId) {
    const r = await db.query('SELECT id FROM branches WHERE id = $1 AND business_id = $2', [branchId, businessId]);
    if (r.rows[0]) return r.rows[0].id;
  }
  const d = await db.query(
    `SELECT id FROM branches WHERE business_id = $1 AND is_active = true ORDER BY is_default DESC, created_at ASC LIMIT 1`,
    [businessId]
  );
  return d.rows[0]?.id ?? null;
}

async function resolvePrefix(db: Queryable, spec: SeriesSpec, branchId: string | null): Promise<string> {
  if (!branchId) return spec.defaultPrefix;
  try {
    const r = await db.query(
      `SELECT prefix FROM branch_document_prefixes WHERE branch_id = $1 AND document_type = $2`,
      [branchId, spec.documentType]
    );
    if (r.rows[0]?.prefix) return String(r.rows[0].prefix);
  } catch (error: unknown) {
    if ((error as { code?: string }).code !== '42P01') throw error;
  }
  return spec.defaultPrefix;
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function nextNumberFor(db: Queryable, spec: SeriesSpec, businessId: string, prefix: string): Promise<string> {
  const r = await db.query(
    `SELECT COALESCE(MAX(SUBSTRING(${spec.column} FROM '(\\d+)$')::bigint), 0) AS max_used
       FROM ${spec.table}
      WHERE business_id = $1 AND ${spec.column} ~ $2`,
    [businessId, `^${escapeRegex(prefix)}-?\\d+$`]
  );
  const next = Number(r.rows[0]?.max_used || 0) + 1;
  return `${prefix}-${String(next).padStart(3, '0')}`;
}

/** Number the next document would get, without reserving it. */
export async function peekSeriesNumber(
  db: Queryable,
  spec: SeriesSpec,
  businessId: string,
  branchId?: string | null
): Promise<{ number: string; branchId: string | null }> {
  const branch = await resolveDocumentBranchId(db, businessId, branchId);
  const prefix = await resolvePrefix(db, spec, branch);
  return { number: await nextNumberFor(db, spec, businessId, prefix), branchId: branch };
}

/**
 * Issue the next number inside the caller's transaction. The advisory lock serialises
 * numbering per business so two users saving at once get different numbers.
 */
export async function issueSeriesNumber(
  client: Queryable,
  spec: SeriesSpec,
  businessId: string,
  branchId: string | null
): Promise<string> {
  await client.query(`SELECT pg_advisory_xact_lock(hashtext($1 || ':' || $2::text))`, [spec.documentType, businessId]);
  const prefix = await resolvePrefix(client, spec, branchId);
  return nextNumberFor(client, spec, businessId, prefix);
}
