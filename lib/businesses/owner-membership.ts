import type { PoolClient } from 'pg';

type PgClient = Pick<PoolClient, 'query'>;

/** Same login, owner of this company. Safe to call again. */
export async function attachUserAsOwner(
  client: PgClient,
  userId: string,
  businessId: string,
): Promise<void> {
  await client.query(
    `INSERT INTO user_businesses (user_id, business_id, role)
     VALUES ($1, $2, 'owner')
     ON CONFLICT (user_id, business_id) DO NOTHING`,
    [userId, businessId],
  );
}

/** Let this user open the company's default branch. Uses a savepoint so a missing column does not abort the transaction. */
export async function grantOwnerBranchAccess(
  client: PgClient,
  userId: string,
  branchId: string,
): Promise<void> {
  await client.query('SAVEPOINT sp_owner_branch');
  try {
    await client.query(
      `INSERT INTO user_branches (user_id, branch_id, can_view, can_edit, can_delete, can_create_transactions)
       VALUES ($1, $2, true, true, true, true)
       ON CONFLICT (user_id, branch_id) DO NOTHING`,
      [userId, branchId],
    );
    await client.query('RELEASE SAVEPOINT sp_owner_branch');
  } catch (error) {
    await client.query('ROLLBACK TO SAVEPOINT sp_owner_branch');
    const err = error as { code?: string; message?: string };
    if (err?.code === '42703' || String(err?.message || '').includes('can_create_transactions')) {
      await client.query(
        `INSERT INTO user_branches (user_id, branch_id, can_view, can_edit, can_delete)
         VALUES ($1, $2, true, true, true)
         ON CONFLICT (user_id, branch_id) DO NOTHING`,
        [userId, branchId],
      );
      return;
    }
    throw error;
  }
}
