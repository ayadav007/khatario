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

  describe('role permissions decide access; the plan can only remove it', () => {
    const ALL_FEATURES = [
      'sales_invoices',
      'sales_credit_notes',
      'sales_debit_notes',
      'sales_estimates',
      'purchase_management',
      'purchase_orders',
      'item_management',
      'purchase_inventory_adjustments',
      'reports_basic',
      'payment_tracking',
      'settings_multi_user',
      'tools_todo',
    ];
    const flags = (v: boolean, a = false, m = false, d = false, s = false) => ({
      can_view: v,
      can_add: a,
      can_modify: m,
      can_delete: d,
      can_share: s,
    });

    const evalFor = (
      permissions: Record<string, ReturnType<typeof flags>>,
      resource: string,
      action = 'view',
      enabledFeatures: string[] = ALL_FEATURES
    ) => {
      loadSnapshot.mockReturnValue({
        permissions,
        isPrimaryAdmin: false,
        enabledFeatures,
      } as any);
      return evaluateCapabilityAccess({
        resource,
        action,
        businessId: 'b1',
        userId: 'u1',
        sessionIsPrimaryAdmin: false,
        sessionPermissions: null,
      });
    };

    const invoiceViewer = { invoices: flags(true) };
    const sales = {
      dashboard: flags(true),
      invoices: flags(true, true, true, false, true),
      credit_notes: flags(true, true),
      customers: flags(true, true, true),
      items: flags(true),
      payments: flags(true, true),
      warehouses: flags(true),
    };

    it('custom invoice viewer: invoices view only, even with every feature in the plan', () => {
      expect(evalFor(invoiceViewer, 'invoices', 'view').allowed).toBe(true);
      expect(evalFor(invoiceViewer, 'invoices', 'read').allowed).toBe(true);
      for (const [resource, action] of [
        ['invoices', 'create'],
        ['invoices', 'update'],
        ['invoices', 'delete'],
        ['invoices', 'export'],
        ['purchases', 'view'],
        ['credit_notes', 'view'],
        ['debit_notes', 'view'],
        ['customers', 'view'],
        ['items', 'view'],
        ['warehouses', 'view'],
        ['reports', 'view'],
        ['settings', 'view'],
      ]) {
        const result = evalFor(invoiceViewer, resource, action);
        expect({ resource, action, ...result }).toEqual({
          resource,
          action,
          allowed: false,
          denialReason: 'PERMISSION_DENIED',
        });
      }
    });

    it('sales: can create invoices but cannot see purchases, reports or settings', () => {
      expect(evalFor(sales, 'invoices', 'create').allowed).toBe(true);
      expect(evalFor(sales, 'invoices', 'add').allowed).toBe(true);
      expect(evalFor(sales, 'invoices', 'delete').allowed).toBe(false);
      expect(evalFor(sales, 'purchases', 'view').allowed).toBe(false);
      expect(evalFor(sales, 'purchases', 'create').allowed).toBe(false);
      expect(evalFor(sales, 'purchase_orders', 'view').allowed).toBe(false);
      expect(evalFor(sales, 'reports', 'view').allowed).toBe(false);
      expect(evalFor(sales, 'settings', 'view').allowed).toBe(false);
    });

    it('a settings view grant allows settings view', () => {
      expect(evalFor({ settings: flags(true) }, 'settings', 'view').allowed).toBe(true);
      expect(evalFor({ settings: flags(true) }, 'settings', 'create').allowed).toBe(false);
    });

    it('a role grant is denied as FEATURE_NOT_IN_PLAN when the plan lacks the feature', () => {
      const result = evalFor(invoiceViewer, 'invoices', 'view', ['purchase_management']);
      expect(result).toEqual({ allowed: false, denialReason: 'FEATURE_NOT_IN_PLAN' });
    });

    it('a missing role grant reports PERMISSION_DENIED even when the plan also lacks the feature', () => {
      const result = evalFor(invoiceViewer, 'purchases', 'view', []);
      expect(result).toEqual({ allowed: false, denialReason: 'PERMISSION_DENIED' });
    });

    it('resolves alias modules the same way as the server', () => {
      expect(evalFor({ items: flags(true, true) }, 'inventory_adjustments', 'create').allowed).toBe(true);
      expect(evalFor({ warehouse_transfer: flags(true) }, 'warehouse_transfer', 'view').allowed).toBe(true);
      expect(evalFor({ journal: flags(true) }, 'journal', 'view').allowed).toBe(true);
      expect(evalFor({ purchases: flags(true) }, 'purchase_orders', 'view').allowed).toBe(true);
    });

    it('accepts legacy can_read style flags', () => {
      loadSnapshot.mockReturnValue({
        permissions: { invoices: { can_read: true } },
        isPrimaryAdmin: false,
        enabledFeatures: ALL_FEATURES,
      } as any);
      expect(
        evaluateCapabilityAccess({
          resource: 'invoices',
          action: 'view',
          businessId: 'b1',
          userId: 'u1',
          sessionIsPrimaryAdmin: false,
          sessionPermissions: null,
        }).allowed
      ).toBe(true);
    });

    it('plan-only feature keys still follow the plan', () => {
      expect(evalFor({}, 'todo', 'view').allowed).toBe(true);
      expect(evalFor({}, 'estimates_quotations', 'view').allowed).toBe(true);
      expect(evalFor({}, 'todo', 'view', []).allowed).toBe(false);
      expect(evalFor({}, 'estimates_quotations', 'view', []).denialReason).toBe('FEATURE_NOT_IN_PLAN');
    });
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
