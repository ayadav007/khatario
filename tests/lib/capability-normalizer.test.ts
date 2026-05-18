/**
 * Unit tests for capability-normalizer.ts
 * 
 * Tests all key normalization logic to ensure consistent capability checks
 * across offline snapshots, API responses, and UI components.
 */

import {
  normalizeModule,
  normalizeFeature,
  normalizeAction,
  isValidModule,
  isValidFeature,
  isValidAction,
  getModuleAliases,
  getFeatureAliases,
  PERMISSION_MODULES,
  FEATURE_REGISTRY_IDS,
  MODULE_ALIAS_MAP,
  FEATURE_ALIAS_MAP,
  ACTION_ALIAS_MAP,
} from '@/lib/capability-normalizer';

describe('capability-normalizer', () => {
  describe('normalizeModule', () => {
    it('should return canonical module when already canonical', () => {
      expect(normalizeModule('invoices')).toBe('invoices');
      expect(normalizeModule('customers')).toBe('customers');
      expect(normalizeModule('employees')).toBe('employees');
      expect(normalizeModule('leaves')).toBe('leaves');
    });

    it('should map leave_requests to leaves', () => {
      expect(normalizeModule('leave_requests')).toBe('leaves');
    });

    it('should map payroll to employees', () => {
      expect(normalizeModule('payroll')).toBe('employees');
    });

    it('should map hr to employees', () => {
      expect(normalizeModule('hr')).toBe('employees');
    });

    it('should map report aliases to reports', () => {
      expect(normalizeModule('report')).toBe('reports');
      expect(normalizeModule('report.financial')).toBe('reports');
      expect(normalizeModule('report.gst')).toBe('reports');
      expect(normalizeModule('report.inventory')).toBe('reports');
    });

    it('should map non-existent modules to existing ones', () => {
      expect(normalizeModule('purchase_orders')).toBe('purchases');
      expect(normalizeModule('journal')).toBe('settings');
      expect(normalizeModule('inventory_adjustments')).toBe('items');
      expect(normalizeModule('warehouse_transfer')).toBe('warehouses');
      expect(normalizeModule('debit_notes')).toBe('invoices');
      expect(normalizeModule('sales_sales_orders')).toBe('invoices');
    });

    it('should warn for unknown modules', () => {
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
      const result = normalizeModule('unknown_module');
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Unknown permission module: "unknown_module"')
      );
      consoleWarnSpy.mockRestore();
    });
  });

  describe('normalizeFeature', () => {
    it('should return registry ID when already a registry ID', () => {
      expect(normalizeFeature('sales_invoices')).toBe('sales_invoices');
      expect(normalizeFeature('sales_estimates')).toBe('sales_estimates');
      expect(normalizeFeature('integration_whatsapp_bot')).toBe('integration_whatsapp_bot');
      expect(normalizeFeature('tools_todo')).toBe('tools_todo');
    });

    it('should map canonical keys to registry IDs', () => {
      expect(normalizeFeature('invoice_creation')).toBe('sales_invoices');
      expect(normalizeFeature('estimates_quotations')).toBe('sales_estimates');
      expect(normalizeFeature('supplier_management')).toBe('purchase_suppliers');
      expect(normalizeFeature('expense_tracking')).toBe('purchase_expenses');
      expect(normalizeFeature('multi_user')).toBe('settings_multi_user');
      expect(normalizeFeature('multi_branch')).toBe('settings_multi_branch');
      expect(normalizeFeature('multi_warehouse')).toBe('settings_multi_warehouse');
      expect(normalizeFeature('backup_restore')).toBe('settings_backup');
      expect(normalizeFeature('whatsapp_bot')).toBe('integration_whatsapp_bot');
      expect(normalizeFeature('todo')).toBe('tools_todo');
    });

    it('should map legacy aliases to registry IDs', () => {
      expect(normalizeFeature('quotations')).toBe('sales_estimates');
      expect(normalizeFeature('estimates')).toBe('sales_estimates');
    });

    it('should warn for unknown features', () => {
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
      const result = normalizeFeature('unknown_feature');
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Unknown feature key: "unknown_feature"')
      );
      consoleWarnSpy.mockRestore();
    });
  });

  describe('normalizeAction', () => {
    it('should return canonical action when already canonical', () => {
      expect(normalizeAction('read')).toBe('read');
      expect(normalizeAction('create')).toBe('create');
      expect(normalizeAction('update')).toBe('update');
      expect(normalizeAction('delete')).toBe('delete');
      expect(normalizeAction('export')).toBe('export');
    });

    it('should map UI action aliases to canonical actions', () => {
      expect(normalizeAction('view')).toBe('read');
      expect(normalizeAction('add')).toBe('create');
      expect(normalizeAction('modify')).toBe('update');
      expect(normalizeAction('share')).toBe('export');
      expect(normalizeAction('finalize')).toBe('update');
      expect(normalizeAction('cancel')).toBe('update');
    });

    it('should warn and default to read for unknown actions', () => {
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
      const result = normalizeAction('unknown_action');
      expect(result).toBe('read');
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Unknown action: "unknown_action"')
      );
      consoleWarnSpy.mockRestore();
    });
  });

  describe('validation helpers', () => {
    describe('isValidModule', () => {
      it('should return true for valid canonical modules', () => {
        expect(isValidModule('invoices')).toBe(true);
        expect(isValidModule('customers')).toBe(true);
        expect(isValidModule('employees')).toBe(true);
      });

      it('should return false for aliases', () => {
        expect(isValidModule('leave_requests')).toBe(false);
        expect(isValidModule('payroll')).toBe(false);
      });

      it('should return false for invalid modules', () => {
        expect(isValidModule('unknown')).toBe(false);
      });
    });

    describe('isValidFeature', () => {
      it('should return true for valid registry IDs', () => {
        expect(isValidFeature('sales_invoices')).toBe(true);
        expect(isValidFeature('sales_estimates')).toBe(true);
        expect(isValidFeature('integration_whatsapp_bot')).toBe(true);
      });

      it('should return false for canonical keys', () => {
        expect(isValidFeature('invoice_creation')).toBe(false);
        expect(isValidFeature('estimates_quotations')).toBe(false);
      });

      it('should return false for invalid features', () => {
        expect(isValidFeature('unknown')).toBe(false);
      });
    });

    describe('isValidAction', () => {
      it('should return true for valid canonical actions', () => {
        expect(isValidAction('read')).toBe(true);
        expect(isValidAction('create')).toBe(true);
        expect(isValidAction('update')).toBe(true);
      });

      it('should return false for UI aliases', () => {
        expect(isValidAction('view')).toBe(false);
        expect(isValidAction('add')).toBe(false);
      });

      it('should return false for invalid actions', () => {
        expect(isValidAction('unknown')).toBe(false);
      });
    });
  });

  describe('alias lookup helpers', () => {
    describe('getModuleAliases', () => {
      it('should return all aliases for a canonical module', () => {
        const employeesAliases = getModuleAliases('employees');
        expect(employeesAliases).toContain('payroll');
        expect(employeesAliases).toContain('hr');

        const leavesAliases = getModuleAliases('leaves');
        expect(leavesAliases).toContain('leave_requests');

        const reportsAliases = getModuleAliases('reports');
        expect(reportsAliases).toContain('report');
        expect(reportsAliases).toContain('report.financial');
        expect(reportsAliases).toContain('report.gst');
        expect(reportsAliases).toContain('report.inventory');
      });

      it('should return empty array for modules with no aliases', () => {
        expect(getModuleAliases('customers')).toEqual([]);
      });
    });

    describe('getFeatureAliases', () => {
      it('should return all aliases for a registry ID', () => {
        const estimatesAliases = getFeatureAliases('sales_estimates');
        expect(estimatesAliases).toContain('estimates_quotations');
        expect(estimatesAliases).toContain('quotations');
        expect(estimatesAliases).toContain('estimates');

        const whatsappAliases = getFeatureAliases('integration_whatsapp_bot');
        expect(whatsappAliases).toContain('whatsapp_bot');
        expect(whatsappAliases).toContain('integration_whatsapp_bot');
      });

      it('should return empty array for features with no aliases', () => {
        expect(getFeatureAliases('customer_management')).toEqual([]);
      });
    });
  });

  describe('comprehensive alias coverage', () => {
    it('should have all MODULE_ALIAS_MAP entries pointing to valid modules', () => {
      Object.values(MODULE_ALIAS_MAP).forEach((canonical) => {
        expect(PERMISSION_MODULES).toContain(canonical);
      });
    });

    it('should have all FEATURE_ALIAS_MAP entries pointing to valid registry IDs', () => {
      Object.values(FEATURE_ALIAS_MAP).forEach((registryId) => {
        expect(FEATURE_REGISTRY_IDS).toContain(registryId);
      });
    });

    it('should have all ACTION_ALIAS_MAP entries pointing to valid actions', () => {
      Object.values(ACTION_ALIAS_MAP).forEach((canonical) => {
        expect(['read', 'create', 'update', 'delete', 'export']).toContain(canonical);
      });
    });
  });

  describe('real-world usage patterns', () => {
    it('should handle customers.create check', () => {
      const module = normalizeModule('customers');
      const action = normalizeAction('create');
      expect(module).toBe('customers');
      expect(action).toBe('create');
    });

    it('should handle sales_estimates feature check', () => {
      const feature = normalizeFeature('sales_estimates');
      expect(feature).toBe('sales_estimates');
    });

    it('should handle payroll alias with view action', () => {
      const module = normalizeModule('payroll');
      const action = normalizeAction('view');
      expect(module).toBe('employees');
      expect(action).toBe('read');
    });

    it('should handle leave_requests alias with add action', () => {
      const module = normalizeModule('leave_requests');
      const action = normalizeAction('add');
      expect(module).toBe('leaves');
      expect(action).toBe('create');
    });

    it('should handle canonical estimates_quotations to registry ID', () => {
      const feature = normalizeFeature('estimates_quotations');
      expect(feature).toBe('sales_estimates');
    });

    it('should handle legacy quotations alias', () => {
      const feature = normalizeFeature('quotations');
      expect(feature).toBe('sales_estimates');
    });

    it('should handle multi_warehouse canonical to registry ID', () => {
      const feature = normalizeFeature('multi_warehouse');
      expect(feature).toBe('settings_multi_warehouse');
    });

    it('should handle whatsapp_bot canonical to registry ID', () => {
      const feature = normalizeFeature('whatsapp_bot');
      expect(feature).toBe('integration_whatsapp_bot');
    });

    it('should handle todo canonical to registry ID', () => {
      const feature = normalizeFeature('todo');
      expect(feature).toBe('tools_todo');
    });
  });
});
