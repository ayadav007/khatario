/**
 * Tenant delete: ON DELETE RESTRICT blockers inside the tenant are cleared and retried; blockers that
 * would need another tenant's rows deleted stop the purge instead.
 */
jest.mock('@/lib/db', () => ({ getPool: jest.fn(), query: jest.fn(), queryOne: jest.fn(), queryRows: jest.fn() }));
jest.mock('@/lib/subscription', () => ({ clearSubscriptionCache: jest.fn() }));
jest.mock('@/lib/platform-auth', () => ({ logAdminAction: jest.fn() }));
jest.mock('@/lib/subscription/lifecycle', () => ({ logSubscriptionEvent: jest.fn() }));
jest.mock('@/lib/platform-email', () => ({ getBusinessPlatformRecipient: jest.fn(), notifyAdminsSubscriptionChange: jest.fn() }));
jest.mock('@/lib/platform-billing', () => ({ recordUpgradeBilling: jest.fn() }));

import { purgeTenantRows } from '@/lib/admin-business-ops';

const BIZ = 'b1';
const fkRow = {
  child: 'stock_transfer_items',
  child_col: 'item_id',
  parent: 'items',
  parent_col: 'id',
  ncols: 1,
  parent_has_bid: true,
  child_has_bid: false,
};
const fkError = Object.assign(new Error('fk'), { code: '23503', constraint: 'stock_transfer_items_item_id_fkey', table: 'stock_transfer_items' });

function fakeClient(deleteResults: Array<Error | null>, fk = fkRow) {
  const deletes: string[] = [];
  const query = jest.fn(async (sql: string) => {
    if (sql.startsWith('DELETE')) {
      deletes.push(sql);
      const r = deleteResults.shift();
      if (r) throw r;
      return { rows: [] };
    }
    if (sql.includes('pg_constraint')) return { rows: [fk] };
    return { rows: [] };
  });
  return { client: { query } as never, deletes };
}

it('deletes the blocking child rows for this tenant, then retries the business delete', async () => {
  const { client, deletes } = fakeClient([fkError, null, null]);
  await purgeTenantRows(client, BIZ, { table: 'businesses', where: 'id = $1' });
  expect(deletes).toEqual([
    'DELETE FROM businesses WHERE id = $1',
    'DELETE FROM stock_transfer_items WHERE item_id IN (SELECT id FROM items WHERE business_id = $1)',
    'DELETE FROM businesses WHERE id = $1',
  ]);
});

it('scopes child deletes to this business when the child has business_id', async () => {
  const { client, deletes } = fakeClient([fkError, null, null], { ...fkRow, child_has_bid: true });
  await purgeTenantRows(client, BIZ, { table: 'businesses', where: 'id = $1' });
  expect(deletes[1]).toMatch(/AND business_id = \$1$/);
});

it('stops when the same blocker remains (rows owned by another tenant)', async () => {
  const { client } = fakeClient([fkError, null, fkError]);
  await expect(purgeTenantRows(client, BIZ, { table: 'businesses', where: 'id = $1' })).rejects.toBe(fkError);
});

it('rethrows non-FK errors untouched', async () => {
  const boom = Object.assign(new Error('boom'), { code: '42P01' });
  const { client } = fakeClient([boom]);
  await expect(purgeTenantRows(client, BIZ, { table: 'businesses', where: 'id = $1' })).rejects.toBe(boom);
});
