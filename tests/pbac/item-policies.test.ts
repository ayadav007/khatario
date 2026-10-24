import { getItemPolicies } from '../../lib/policies/resources/items';
import { evaluatePolicy } from '../../lib/policies/engine';
import { PolicyContext, PolicyUser } from '../../lib/policies/types';

const branchAccessMocks = {
  checkUserBranchPermission: jest.fn(),
};

jest.mock('../../lib/branch-access', () => branchAccessMocks);

describe('Item policies', () => {
  const inventoryManager: PolicyUser = {
    id: 'user-inv',
    business_id: 'business-1',
    role_id: 'role-inventory-manager',
    branch_ids: ['branch-1'],
  };

  const item = { id: 'item-1', business_id: 'business-1', name: 'Widget' };
  const foreignItem = { id: 'item-2', business_id: 'business-2', name: 'Other' };

  beforeEach(() => {
    jest.clearAllMocks();
    branchAccessMocks.checkUserBranchPermission.mockResolvedValue(false);
  });

  it.each(['read', 'update', 'delete'])(
    'allows %s on an item in the same business without a branch',
    async (action) => {
      const policy = getItemPolicies().find((p) => p.action === action)!;
      const context: PolicyContext = { resource: item, action, businessId: 'business-1' } as PolicyContext;
      const result = await evaluatePolicy(policy, inventoryManager, context);
      expect(result.allowed).toBe(true);
      expect(branchAccessMocks.checkUserBranchPermission).not.toHaveBeenCalled();
    }
  );

  it.each(['read', 'update', 'delete'])(
    'denies %s on an item from another business',
    async (action) => {
      const policy = getItemPolicies().find((p) => p.action === action)!;
      const context: PolicyContext = { resource: foreignItem, action, businessId: 'business-1' } as PolicyContext;
      const result = await evaluatePolicy(policy, inventoryManager, context);
      expect(result.allowed).toBe(false);
    }
  );

  it('allows create when the caller business matches', async () => {
    const policy = getItemPolicies().find((p) => p.action === 'create')!;
    const context = { resource: {}, action: 'create', businessId: 'business-1' } as PolicyContext;
    const result = await evaluatePolicy(policy, inventoryManager, context);
    expect(result.allowed).toBe(true);
  });
});
