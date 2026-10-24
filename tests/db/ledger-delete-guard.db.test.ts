/**
 * Real-PostgreSQL test for migration 323 (ledger delete guard) and the app helpers.
 * Runs only when LEDGER_GUARD_TEST_DATABASE_URL points at a disposable database; each run
 * works in its own schema and drops it afterwards.
 */
import fs from 'fs';
import path from 'path';
import { Pool, type PoolClient } from 'pg';
import { withLedgerDelete } from '@/lib/accounting/ledger-delete-guard';
import { deleteVoucher } from '@/lib/accounting/voucher-posting';

const url = process.env.LEDGER_GUARD_TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

const B1 = '00000000-0000-0000-0000-0000000000b1';
const B2 = '00000000-0000-0000-0000-0000000000b2';
const BR1 = '00000000-0000-0000-0000-00000000b1b1';
const BR2 = '00000000-0000-0000-0000-00000000b2b2';
const U1 = '00000000-0000-0000-0000-0000000000a1';
const A11 = '00000000-0000-0000-0000-000000000c11';
const A12 = '00000000-0000-0000-0000-000000000c12';
const A21 = '00000000-0000-0000-0000-000000000c21';
const A22 = '00000000-0000-0000-0000-000000000c22';
const OPEN_VOUCHER = '00000000-0000-0000-0000-00000000f001';
const LOCKED_VOUCHER = '00000000-0000-0000-0000-00000000f002';
const OTHER_TENANT_VOUCHER = '00000000-0000-0000-0000-00000000f003';

const migrationSql = fs.readFileSync(
  path.join(__dirname, '../../database/migrations/323_ledger_delete_guard.sql'),
  'utf8'
);
const baseSql = fs.readFileSync(path.join(__dirname, 'fixtures/ledger-guard-base-schema.sql'), 'utf8');

d('ledger delete guard (migration 323, real DB)', () => {
  const schema = `ledger_guard_${process.pid}_${Date.now()}`;
  let admin: Pool;
  let pool: Pool;

  async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const out = await fn(c);
      await c.query('COMMIT');
      return out;
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }

  async function hintOf(p: Promise<unknown>): Promise<string | undefined> {
    try {
      await p;
    } catch (e) {
      return (e as { hint?: string }).hint ?? `error without hint: ${(e as Error).message}`;
    }
    return undefined;
  }

  const count = async (sql: string, params: unknown[] = []) =>
    Number((await pool.query<{ n: string }>(`SELECT count(*) AS n FROM (${sql}) s`, params)).rows[0].n);

  beforeAll(async () => {
    admin = new Pool({ connectionString: url, max: 1 });
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString: url, max: 4, options: `-c search_path=${schema},public` });
    await pool.query(baseSql);
    await tx((c) => c.query(migrationSql));

    await pool.query(`INSERT INTO businesses (id, name) VALUES ($1, 'B1'), ($2, 'B2')`, [B1, B2]);
    await pool.query(`INSERT INTO branches (id, business_id) VALUES ($1, $2), ($3, $4)`, [BR1, B1, BR2, B2]);
    await pool.query(`INSERT INTO users (id, business_id) VALUES ($1, $2)`, [U1, B1]);
    await pool.query(
      `INSERT INTO accounts (id, business_id) VALUES ($1, $5), ($2, $5), ($3, $6), ($4, $6)`,
      [A11, A12, A21, A22, B1, B2]
    );
    const line = (biz: string, br: string, v: string, type: string, acc: string, date: string, dr: number, cr: number) =>
      pool.query(
        `INSERT INTO ledger_entry_lines (business_id, branch_id, voucher_id, voucher_type, account_id, entry_date, debit, credit)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [biz, br, v, type, acc, date, dr, cr]
      );
    await line(B1, BR1, OPEN_VOUCHER, 'expense', A11, '2026-04-10', 100, 0);
    await line(B1, BR1, OPEN_VOUCHER, 'expense', A12, '2026-04-10', 0, 100);
    await line(B1, BR1, LOCKED_VOUCHER, 'journal', A11, '2025-01-10', 50, 0);
    await line(B1, BR1, LOCKED_VOUCHER, 'journal', A12, '2025-01-10', 0, 50);
    await line(B2, BR2, OTHER_TENANT_VOUCHER, 'invoice', A21, '2025-01-10', 70, 0);
    await line(B2, BR2, OTHER_TENANT_VOUCHER, 'invoice', A22, '2025-01-10', 0, 70);
    await pool.query(
      `INSERT INTO period_locks (business_id, branch_id, period_start, period_end)
       VALUES ($1, NULL, '2025-01-01', '2025-03-31'), ($2, NULL, '2025-01-01', '2025-03-31')`,
      [B1, B2]
    );
  }, 30000);

  afterAll(async () => {
    await pool?.end();
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await admin.end();
    }
  });

  it('migration re-runs cleanly and drops the history cascade FK', async () => {
    await tx((c) => c.query(migrationSql));
    const fk = await count(
      `SELECT 1 FROM pg_constraint WHERE conrelid = 'ledger_entry_history'::regclass
         AND confrelid = 'ledger_entry_lines'::regclass AND contype = 'f'`
    );
    expect(fk).toBe(0);
  });

  it('refuses an undeclared delete', async () => {
    const hint = await hintOf(tx((c) => c.query(`DELETE FROM ledger_entry_lines WHERE voucher_id = $1`, [OPEN_VOUCHER])));
    expect(hint).toBe('LEDGER_DELETE_FORBIDDEN');
  });

  it('refuses a declared delete issued outside a transaction', async () => {
    const c = await pool.connect();
    try {
      const hint = await hintOf(deleteVoucher(c, B1, OPEN_VOUCHER, 'expense', 'regenerate:opening_balance', U1));
      expect(hint).toBe('LEDGER_DELETE_FORBIDDEN');
    } finally {
      c.release();
    }
    expect(await count(`SELECT 1 FROM ledger_entry_lines WHERE voucher_id = $1`, [OPEN_VOUCHER])).toBe(2);
  });

  it('clears the reason once the helper returns', async () => {
    const hint = await hintOf(
      tx(async (c) => {
        await withLedgerDelete(c, 'regenerate:opening_balance', U1, async () => undefined);
        await c.query(`DELETE FROM ledger_entry_lines WHERE voucher_id = $1`, [OPEN_VOUCHER]);
      })
    );
    expect(hint).toBe('LEDGER_DELETE_FORBIDDEN');
  });

  it('refuses deleting lines in a locked period even with a reason', async () => {
    const hint = await hintOf(
      tx((c) => deleteVoucher(c, B1, LOCKED_VOUCHER, 'journal', 'regenerate:year_close', U1))
    );
    expect(hint).toBe('LEDGER_PERIOD_LOCKED');
    expect(await count(`SELECT 1 FROM ledger_entry_lines WHERE voucher_id = $1`, [LOCKED_VOUCHER])).toBe(2);
  });

  it('archives a declared delete with reason, actor and full snapshot, keeping history', async () => {
    await tx((c) => deleteVoucher(c, B1, OPEN_VOUCHER, 'expense', 'regenerate:opening_balance', U1));

    expect(await count(`SELECT 1 FROM ledger_entry_lines WHERE voucher_id = $1`, [OPEN_VOUCHER])).toBe(0);
    const archived = await pool.query(
      `SELECT reason, deleted_by, debit, credit, line_snapshot FROM ledger_entry_deletions
        WHERE voucher_id = $1 ORDER BY debit DESC`,
      [OPEN_VOUCHER]
    );
    expect(archived.rows).toHaveLength(2);
    expect(archived.rows.map((r) => r.reason)).toEqual(['regenerate:opening_balance', 'regenerate:opening_balance']);
    expect(archived.rows.every((r) => r.deleted_by === U1)).toBe(true);
    expect(Number(archived.rows[0].debit)).toBe(100);
    expect(archived.rows[0].line_snapshot.voucher_type).toBe('expense');
    expect(
      await count(
        `SELECT 1 FROM ledger_entry_history h JOIN ledger_entry_deletions d USING (ledger_entry_line_id)
          WHERE d.voucher_id = $1 AND h.action IN ('created', 'deleted')`,
        [OPEN_VOUCHER]
      )
    ).toBe(4);
  });

  it('keeps the archive and history append-only', async () => {
    expect(await hintOf(pool.query(`UPDATE ledger_entry_deletions SET reason = 'x'`))).toBe('LEDGER_DELETE_FORBIDDEN');
    expect(await hintOf(pool.query(`DELETE FROM ledger_entry_deletions`))).toBe('LEDGER_DELETE_FORBIDDEN');
    expect(await hintOf(pool.query(`UPDATE ledger_entry_history SET reason = 'x'`))).toBe('LEDGER_DELETE_FORBIDDEN');
    expect(await hintOf(pool.query(`DELETE FROM ledger_entry_history`))).toBe('LEDGER_DELETE_FORBIDDEN');
    expect(
      await hintOf(tx((c) => withLedgerDelete(c, 'regenerate:opening_balance', null, () => c.query(`DELETE FROM ledger_entry_deletions`))))
    ).toBe('LEDGER_DELETE_FORBIDDEN');
  });

  it('refuses TRUNCATE of the ledger', async () => {
    expect(await hintOf(pool.query(`TRUNCATE ledger_entry_lines CASCADE`))).toBe('LEDGER_DELETE_FORBIDDEN');
  });

  it('still lets a user be deleted (history.action_by is nulled)', async () => {
    await pool.query(`DELETE FROM users WHERE id = $1`, [U1]);
    expect(await count(`SELECT 1 FROM ledger_entry_history WHERE action = 'deleted' AND action_by IS NULL`)).toBe(2);
  });

  it('accepts tenant_purge only while the business itself is deleted', async () => {
    const early = await hintOf(
      tx((c) => withLedgerDelete(c, 'tenant_purge', null, () => c.query(`DELETE FROM ledger_entry_lines WHERE business_id = $1`, [B2])))
    );
    expect(early).toBe('LEDGER_DELETE_FORBIDDEN');

    await expect(pool.query(`DELETE FROM businesses WHERE id = $1`, [B2])).rejects.toThrow();

    await tx((c) =>
      withLedgerDelete(c, 'tenant_purge', null, async () => {
        await c.query(`DELETE FROM ledger_entry_deletions WHERE business_id = $1`, [B2]);
        await c.query(`DELETE FROM businesses WHERE id = $1`, [B2]);
      })
    );
    expect(await count(`SELECT 1 FROM ledger_entry_lines WHERE business_id = $1`, [B2])).toBe(0);
    expect(
      await count(`SELECT 1 FROM ledger_entry_history WHERE new_value ->> 'voucher_id' = $1`, [OTHER_TENANT_VOUCHER])
    ).toBe(0);
    expect(await count(`SELECT 1 FROM ledger_entry_lines WHERE business_id = $1`, [B1])).toBe(2);
  });
});
