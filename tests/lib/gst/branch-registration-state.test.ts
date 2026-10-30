import { branchOutsideRegistrationState } from '@/lib/gst/registration';

const GSTIN_TN = '33ADVFS4469F1ZJ';
const business = { gstin: GSTIN_TN, state: 'Tamil Nadu', state_code: '33' };

describe('branchOutsideRegistrationState', () => {
  it('a branch with no GSTIN in the business state is fine', () => {
    expect(branchOutsideRegistrationState({ state: 'Tamil Nadu' }, business)).toBeNull();
  });

  it('a branch with no GSTIN in another state must get its own GSTIN', () => {
    const msg = branchOutsideRegistrationState({ state: 'Karnataka', state_code: '29' }, business);
    expect(msg).toMatch(/in Karnataka.*no GSTIN of its own.*registered in Tamil Nadu/);
  });

  it('a branch repeating the business GSTIN counts as having none', () => {
    expect(branchOutsideRegistrationState({ gstin: GSTIN_TN, state: 'Kerala' }, business)).not.toBeNull();
  });

  it('a branch with its own GSTIN is judged by that GSTIN elsewhere, not here', () => {
    expect(branchOutsideRegistrationState({ gstin: '29AAAAA0000A1Z5', state: 'Karnataka' }, business)).toBeNull();
  });

  it('an unregistered business or unknown state is not judged', () => {
    expect(branchOutsideRegistrationState({ state: 'Karnataka' }, { gstin: null, state: 'Tamil Nadu' })).toBeNull();
    expect(branchOutsideRegistrationState({ state: '' }, business)).toBeNull();
  });
});
