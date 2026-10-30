import { checkBranchPlace, checkWarehousePlace, placeOutsideRegistration } from '@/lib/gst/registration';

const GJ_GSTIN = '24AAPFU0939F1Z1';
const MH_GSTIN = '27AAPFU0939F1ZV';

/** Fake db: answers the registration lookup with the head office in Gujarat and an optional branch row. */
function fakeDb(branch?: { gstin: string | null; state: string | null; state_code: string | null }) {
  return {
    query: async (_text: string, params?: unknown[]) => ({
      rows: [{
        b_gstin: GJ_GSTIN, b_state: 'Gujarat', b_state_code: '24',
        b_address: null, b_address2: null, b_city: null, b_pincode: null, b_phone: null, b_email: null,
        br_gstin: params?.[1] && branch ? branch.gstin : null,
        br_state: params?.[1] && branch ? branch.state : null,
        br_state_code: params?.[1] && branch ? branch.state_code : null,
        br_address1: null, br_address2: null, br_city: null, br_pincode: null, br_phone: null, br_email: null,
      }],
    }),
  } as any;
}

describe('placeOutsideRegistration', () => {
  const gujarat = { gstin: GJ_GSTIN, stateCode: '24' };

  it('allows a place in the same state as the registration', () => {
    expect(placeOutsideRegistration('branch', { state: 'Gujarat' }, gujarat)).toBeNull();
    expect(placeOutsideRegistration('warehouse', { stateCode: '24' }, gujarat)).toBeNull();
  });

  it('rejects a branch in another state trading under the head-office GSTIN', () => {
    const r = placeOutsideRegistration('branch', { state: 'Maharashtra' }, gujarat);
    expect(r?.code).toBe('BRANCH_NEEDS_STATE_GSTIN');
    expect(r?.error).toMatch(/Maharashtra/);
    expect(r?.error).toMatch(/Gujarat/);
  });

  it('rejects a godown in another state than its registration', () => {
    expect(placeOutsideRegistration('warehouse', { stateCode: '27' }, gujarat)?.code).toBe('WAREHOUSE_OUTSIDE_REGISTRATION_STATE');
  });

  it('skips the check when the business is not GST registered or the state is unknown', () => {
    expect(placeOutsideRegistration('branch', { state: 'Maharashtra' }, { gstin: null, stateCode: '24' })).toBeNull();
    expect(placeOutsideRegistration('branch', { state: '' }, gujarat)).toBeNull();
    expect(placeOutsideRegistration('warehouse', { state: 'Dubai' }, gujarat)).toBeNull();
  });
});

describe('checkBranchPlace', () => {
  it('rejects an out-of-state branch with no GSTIN of its own', async () => {
    const r = await checkBranchPlace(fakeDb(), 'biz', { gstin: null, state: 'Maharashtra' });
    expect(r?.code).toBe('BRANCH_NEEDS_STATE_GSTIN');
  });

  it('rejects an out-of-state branch that reuses the head-office GSTIN', async () => {
    const r = await checkBranchPlace(fakeDb(), 'biz', { gstin: GJ_GSTIN.toLowerCase(), state: 'Maharashtra' });
    expect(r?.code).toBe('BRANCH_NEEDS_STATE_GSTIN');
  });

  it('allows an out-of-state branch with its own GSTIN for that state', async () => {
    expect(await checkBranchPlace(fakeDb(), 'biz', { gstin: MH_GSTIN, state: 'Maharashtra' })).toBeNull();
  });

  it('rejects a branch whose own GSTIN is from a different state than its address', async () => {
    const r = await checkBranchPlace(fakeDb(), 'biz', { gstin: MH_GSTIN, state: 'Karnataka' });
    expect(r?.code).toBe('GSTIN_STATE_MISMATCH');
  });

  it('allows a same-state branch under the head-office GSTIN (additional place of business)', async () => {
    expect(await checkBranchPlace(fakeDb(), 'biz', { gstin: '', state: 'Gujarat' })).toBeNull();
  });
});

describe('checkWarehousePlace', () => {
  it('checks a godown against its branch registration', async () => {
    const db = fakeDb({ gstin: MH_GSTIN, state: 'Maharashtra', state_code: '27' });
    expect(await checkWarehousePlace(db, 'biz', 'br-mh', { state: 'Maharashtra' })).toBeNull();
    expect((await checkWarehousePlace(db, 'biz', 'br-mh', { state: 'Gujarat' }))?.code).toBe('WAREHOUSE_OUTSIDE_REGISTRATION_STATE');
  });

  it('checks a godown without a branch against the head office', async () => {
    expect((await checkWarehousePlace(fakeDb(), 'biz', null, { state: 'Maharashtra' }))?.code).toBe('WAREHOUSE_OUTSIDE_REGISTRATION_STATE');
    expect(await checkWarehousePlace(fakeDb(), 'biz', null, { state: 'Gujarat' })).toBeNull();
  });
});
