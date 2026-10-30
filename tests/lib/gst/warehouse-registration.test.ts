import {
  findWarehouseStateMismatch,
  warehouseStateCode,
  warehouseStateMismatchMessage,
} from '@/lib/gst/warehouse-registration';

const GSTIN_KA = '29AABCU9603R1ZM';
const GSTIN_TN = '33ADVFS4469F1ZJ';

function fakeDb(rows: Array<{ id: string; name: string; state: string | null; gstin: string | null }>) {
  const calls: unknown[][] = [];
  return {
    calls,
    query: async (_sql: string, params?: unknown[]) => {
      calls.push(params ?? []);
      const ids = (params?.[0] as string[]) ?? [];
      return { rows: rows.filter((r) => ids.includes(r.id)) as any[] };
    },
  };
}

describe('warehouseStateCode', () => {
  it('prefers the godown GSTIN over its address state', () => {
    expect(warehouseStateCode({ gstin: GSTIN_TN, state: 'Karnataka' })).toBe('33');
  });
  it('falls back to the address state', () => {
    expect(warehouseStateCode({ gstin: null, state: 'Tamil Nadu' })).toBe('33');
  });
  it('unknown when nothing is recorded', () => {
    expect(warehouseStateCode({ gstin: '', state: '' })).toBeNull();
  });
});

describe('findWarehouseStateMismatch', () => {
  const db = fakeDb([
    { id: 'blr', name: 'Bangalore Main', state: 'Karnataka', gstin: null },
    { id: 'hosur', name: 'Hosur Godown', state: 'Tamil Nadu', gstin: null },
    { id: 'virtual', name: 'Damaged', state: null, gstin: null },
  ]);

  it('passes a godown in the registration state', async () => {
    await expect(
      findWarehouseStateMismatch(db, 'biz', { stateCode: '29', gstin: GSTIN_KA }, ['blr', 'virtual']),
    ).resolves.toBeNull();
  });

  it('flags a Tamil Nadu godown under a Karnataka GSTIN', async () => {
    const m = await findWarehouseStateMismatch(db, 'biz', { stateCode: '29', gstin: GSTIN_KA }, ['blr', 'hosur']);
    expect(m).toMatchObject({ warehouseId: 'hosur', warehouseStateCode: '33', registrationStateCode: '29' });
    expect(warehouseStateMismatchMessage(m!)).toMatch(/Hosur Godown.*Tamil Nadu.*Karnataka GSTIN \(29AABCU9603R1ZM\)/);
  });

  it('passes the same godown under its own Tamil Nadu branch', async () => {
    await expect(
      findWarehouseStateMismatch(db, 'biz', { stateCode: '33', gstin: GSTIN_TN }, ['hosur']),
    ).resolves.toBeNull();
  });

  it('skips the lookup when there is no godown or no registration state', async () => {
    const quiet = fakeDb([]);
    await findWarehouseStateMismatch(quiet, 'biz', { stateCode: '29', gstin: GSTIN_KA }, [null, undefined]);
    await findWarehouseStateMismatch(quiet, 'biz', { stateCode: null, gstin: null }, ['hosur']);
    expect(quiet.calls).toHaveLength(0);
  });
});
