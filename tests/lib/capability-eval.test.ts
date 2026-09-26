import { evaluateCapabilityAccess } from '@/lib/capability-eval';
import { loadCapabilitySnapshot } from '@/lib/capability-snapshot';

jest.mock('@/lib/capability-snapshot', () => ({
  loadCapabilitySnapshot: jest.fn(() => null),
}));

const loadSnapshot = loadCapabilitySnapshot as jest.MockedFunction<typeof loadCapabilitySnapshot>;

describe('evaluateCapabilityAccess', () => {
  beforeEach(() => {
    loadSnapshot.mockReturnValue(null);
  });

  it('does not treat missing session ids as a permission deny', () => {
    const result = evaluateCapabilityAccess({
      resource: 'items',
      action: 'update',
      businessId: '',
      userId: '',
      sessionIsPrimaryAdmin: false,
      sessionPermissions: null,
    });
    expect(result.indeterminate).toBe(true);
    expect(result.allowed).toBe(false);
    expect(result.denialReason).toBeUndefined();
  });

  it('is indeterminate before any snapshot or session permissions exist', () => {
    const result = evaluateCapabilityAccess({
      resource: 'items',
      action: 'update',
      businessId: 'b1',
      userId: 'u1',
      sessionIsPrimaryAdmin: false,
      sessionPermissions: null,
    });
    expect(result.indeterminate).toBe(true);
    expect(result.denialReason).toBeUndefined();
  });

  it('allows primary admin without waiting for module permissions', () => {
    const result = evaluateCapabilityAccess({
      resource: 'items',
      action: 'update',
      businessId: 'b1',
      userId: 'u1',
      sessionIsPrimaryAdmin: true,
      sessionPermissions: null,
    });
    expect(result.allowed).toBe(true);
    expect(result.indeterminate).toBeUndefined();
  });
});
