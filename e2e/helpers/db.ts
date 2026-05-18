/**
 * Direct Postgres access for E2E assertions and cleanup (not used by the Next app).
 * Uses DATABASE_URL or DB_* from .env (same as lib/db.ts).
 */
import { Client } from 'pg';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });
config({ path: resolve(process.cwd(), '.env') });

function stripQuotes(s: string): string {
  const t = String(s || '').trim();
  if ((t.startsWith("'") && t.endsWith("'")) || (t.startsWith('"') && t.endsWith('"'))) {
    return t.slice(1, -1);
  }
  return t;
}

export function getPgConfig(): ConstructorParameters<typeof Client>[0] {
  if (process.env.DATABASE_URL) {
    return { connectionString: process.env.DATABASE_URL };
  }
  return {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME || 'khatario',
    user: process.env.DB_USER || 'postgres',
    password: stripQuotes(process.env.DB_PASSWORD || ''),
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  };
}

export function hasDbConfig(): boolean {
  return Boolean(process.env.DATABASE_URL || process.env.DB_NAME);
}

export async function withDbClient<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const client = new Client(getPgConfig());
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end().catch(() => {});
  }
}

/** First matching active plan id from the ordered preference list. */
export async function pickActivePlanId(preferred: string[]): Promise<string | null> {
  return withDbClient(async (c) => {
    const res = await c.query<{ id: string }>(
      `SELECT id FROM subscription_plans WHERE is_active = true AND id = ANY($1::text[])`,
      [preferred]
    );
    const set = new Set(res.rows.map((r) => r.id));
    for (const id of preferred) {
      if (set.has(id)) return id;
    }
    return null;
  });
}

/** Any active plan id (for E2E target when preference list misses). Excludes trial — not selectable via upgrade API. */
export async function pickAnyActivePlanId(): Promise<string | null> {
  return withDbClient(async (c) => {
    const r = await c.query<{ id: string }>(
      `SELECT id FROM subscription_plans WHERE is_active = true AND id <> 'trial' ORDER BY sort_order NULLS LAST, id LIMIT 1`
    );
    return r.rows[0]?.id ?? null;
  });
}

/**
 * Ensures registry rows exist so branch + warehouse APIs pass assertFeatureAccess.
 * Safe for local/dev DBs where subscription_plan_features may be incomplete.
 */
export async function ensureMultiBranchWarehouseForPlan(planId: string): Promise<void> {
  await withDbClient(async (c) => {
    for (const featureId of ['settings_multi_branch', 'settings_multi_warehouse']) {
      await c.query(
        `INSERT INTO subscription_plan_features (plan_id, feature_id, enabled)
         VALUES ($1, $2, true)
         ON CONFLICT (plan_id, feature_id) DO UPDATE SET enabled = true`,
        [planId, featureId]
      );
    }
  });
}

export async function deleteBusinessCascade(businessId: string): Promise<void> {
  await withDbClient(async (c) => {
    await c.query('DELETE FROM businesses WHERE id = $1', [businessId]);
  });
}

/** Minimal customer row for invoice E2E (avoids API/schema drift on older DBs). */
export async function insertMinimalCustomer(
  businessId: string,
  name: string,
  stateCode: string
): Promise<string> {
  return withDbClient(async (c) => {
    const r = await c.query<{ id: string }>(
      `INSERT INTO customers (business_id, name, city, state, state_code, is_active)
       VALUES ($1, $2, 'Bengaluru', 'Karnataka', $3, true)
       RETURNING id`,
      [businessId, name, stateCode]
    );
    const id = r.rows[0]?.id;
    if (!id) throw new Error('insertMinimalCustomer: no id returned');
    return id;
  });
}

/** Minimal service item for invoice line (avoids stock / warehouse on draft). */
export async function insertMinimalServiceItem(
  businessId: string,
  name: string,
  sellingPrice: number,
  taxRate: number
): Promise<string> {
  return withDbClient(async (c) => {
    const r = await c.query<{ id: string }>(
      `INSERT INTO items (
         business_id, name, unit, selling_price, purchase_price, tax_rate,
         item_type, opening_stock, current_stock, min_stock
       )
       VALUES ($1, $2, 'UNT', $3, 0, $4, 'service', 0, 0, 0)
       RETURNING id`,
      [businessId, name, sellingPrice, taxRate]
    );
    const id = r.rows[0]?.id;
    if (!id) throw new Error('insertMinimalServiceItem: no id returned');
    return id;
  });
}

async function tableColumns(c: Client, table: string): Promise<Set<string>> {
  const r = await c.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1`,
    [table]
  );
  return new Set(r.rows.map((x) => x.column_name));
}

/**
 * Draft invoice + one line using only columns that exist (fallback when invoice API
 * expects newer schema e.g. billing_address).
 */
export async function insertMinimalDraftInvoiceWithLine(args: {
  businessId: string;
  branchId: string;
  customerId: string;
  itemId: string;
  itemName: string;
  createdBy: string;
  invoiceNumber: string;
  invoiceDate: string;
}): Promise<{ invoiceId: string; invoiceNumber: string; branchId: string }> {
  const subtotal = 500;
  const taxTotal = 90;
  const grandTotal = 590;
  return withDbClient(async (c) => {
    const invCols = await tableColumns(c, 'invoices');
    const row: Record<string, unknown> = {
      business_id: args.businessId,
      customer_id: args.customerId,
      invoice_number: args.invoiceNumber,
      invoice_date: args.invoiceDate,
      due_date: null,
      status: 'draft',
      payment_status: 'unpaid',
      subtotal,
      discount_total: 0,
      additional_charges: 0,
      tax_total: taxTotal,
      cgst_total: 0,
      sgst_total: 0,
      igst_total: taxTotal,
      round_off: 0,
      grand_total: grandTotal,
      paid_amount: 0,
      balance_amount: grandTotal,
      place_of_supply_state_code: '24',
      is_editable: true,
      document_type: invCols.has('document_type') ? 'regular' : undefined,
      created_by: args.createdBy,
    };
    if (invCols.has('branch_id')) {
      row.branch_id = args.branchId;
    }

    const keys = Object.keys(row).filter((k) => row[k] !== undefined && invCols.has(k));
    const vals = keys.map((k) => row[k]);
    const ph = keys.map((_, i) => `$${i + 1}`).join(', ');
    const ins = await c.query<{ id: string; invoice_number: string; branch_id: string | null }>(
      `INSERT INTO invoices (${keys.join(', ')}) VALUES (${ph}) RETURNING id, invoice_number, branch_id`,
      vals as unknown[]
    );
    const invoiceId = ins.rows[0]?.id;
    const invoiceNumber = ins.rows[0]?.invoice_number ?? args.invoiceNumber;
    if (!invoiceId) throw new Error('insertMinimalDraftInvoiceWithLine: no invoice id');

    const lineCols = await tableColumns(c, 'invoice_items');
    const lineRow: Record<string, unknown> = {
      invoice_id: invoiceId,
      item_id: args.itemId,
      item_name: args.itemName,
      quantity: 1,
      unit: 'UNT',
      unit_price: subtotal,
      discount_percent: 0,
      discount_amount: 0,
      tax_rate: 18,
      tax_amount: taxTotal,
      taxable_value: subtotal,
      cgst_amount: 0,
      sgst_amount: 0,
      igst_amount: taxTotal,
      line_total: grandTotal,
      sort_order: 0,
    };
    const lk = Object.keys(lineRow).filter((k) => lineRow[k] !== undefined && lineCols.has(k));
    const lv = lk.map((k) => lineRow[k]);
    const lph = lk.map((_, i) => `$${i + 1}`).join(', ');
    await c.query(`INSERT INTO invoice_items (${lk.join(', ')}) VALUES (${lph})`, lv as unknown[]);

    return {
      invoiceId,
      invoiceNumber,
      branchId: ins.rows[0]?.branch_id ?? args.branchId,
    };
  });
}
