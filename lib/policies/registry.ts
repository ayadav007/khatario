/**
 * Policy Registry
 * 
 * Central registry for all policies.
 * Policies are organized by resource and action.
 */

import { Policy } from './types';
import { getInvoicePolicies } from './resources/invoices';
import { getInventoryAdjustmentPolicies } from './resources/inventory-adjustments';
import { getWarehousePolicies } from './resources/warehouses';
import { getWarehouseTransferPolicies } from './resources/warehouse-transfers';
import { getJournalPolicies } from './resources/journals';
import { getAccountingPeriodPolicies } from './resources/accounting-periods';
import { getReportPolicies } from './resources/reports';
import { getCustomerPolicies } from './resources/customers';
import { getItemPolicies } from './resources/items';
import { getPurchasePolicies } from './resources/purchases';
import { getPaymentPolicies } from './resources/payments';
import { getExpensePolicies } from './resources/expenses';
import { getCreditNotePolicies } from './resources/credit-notes';
import { getSupplierPolicies } from './resources/suppliers';
import { getHrPolicies } from './resources/hr';
import { getWhatsAppPolicies } from './resources/whatsapp';
import { getToolsPolicies } from './resources/tools';
import { getWorkOrderPolicies } from './resources/work-orders';
import { getDashboardPolicies } from './resources/dashboard';

class PolicyRegistry {
  private policies: Map<string, Policy[]> = new Map();

  constructor() {
    this.registerPolicies();
  }

  /**
   * Register all policies
   */
  private registerPolicies() {
    // Helper to safely register policies from a function
    const safeRegister = (getPoliciesFn: () => Policy[], moduleName: string) => {
      try {
        const policies = getPoliciesFn();
        if (Array.isArray(policies)) {
          policies.forEach(policy => {
            this.registerPolicy(policy);
          });
          console.log(`[PBAC] Registered ${policies.length} ${moduleName} policies`);
        } else {
          console.warn(`[PBAC] ${moduleName} did not return an array`);
        }
      } catch (error: any) {
        console.error(`[PBAC] Error loading ${moduleName} policies:`, error.message);
        // Continue with other policies
      }
    };

    try {
      // Register invoice policies
      safeRegister(() => getInvoicePolicies(), 'invoice');

      // Register inventory adjustment policies
      safeRegister(() => getInventoryAdjustmentPolicies(), 'inventory adjustment');

      // Register warehouse policies
      safeRegister(() => getWarehousePolicies(), 'warehouse');

      // Register warehouse transfer policies
      safeRegister(() => getWarehouseTransferPolicies(), 'warehouse transfer');

      // Register journal policies
      safeRegister(() => getJournalPolicies(), 'journal');

      // Register accounting period policies
      safeRegister(() => getAccountingPeriodPolicies(), 'accounting period');

      // Register report policies
      safeRegister(() => getReportPolicies(), 'report');

      // Register customer policies
      safeRegister(() => getCustomerPolicies(), 'customer');

      // Register item policies
      safeRegister(() => getItemPolicies(), 'item');

      // Register purchase policies
      safeRegister(() => getPurchasePolicies(), 'purchase');

      // Register supplier policies
      safeRegister(() => getSupplierPolicies(), 'supplier');

      // Register payment policies
      safeRegister(() => getPaymentPolicies(), 'payment');

      // Register expense policies
      safeRegister(() => getExpensePolicies(), 'expense');

      // Register credit note policies
      safeRegister(() => getCreditNotePolicies(), 'credit note');

      // Register HR policies
      safeRegister(() => getHrPolicies(), 'HR');

      // Register WhatsApp policies
      safeRegister(() => getWhatsAppPolicies(), 'WhatsApp');

      // Register Tools policies (includes settings)
      safeRegister(() => getToolsPolicies(), 'tools/settings');

      // Register Dashboard policies
      safeRegister(() => getDashboardPolicies(), 'dashboard');

      // Register Work Order policies
      safeRegister(() => getWorkOrderPolicies(), 'work orders');

      console.log('[PBAC] Policy registration complete');
    } catch (error) {
      console.error('[PBAC] Critical error registering policies:', error);
      // Continue without policies (graceful degradation)
    }
  }

  /**
   * Register a policy
   */
  private registerPolicy(policy: Policy) {
    const key = `${policy.resource}:${policy.action}`;
    if (!this.policies.has(key)) {
      this.policies.set(key, []);
    }
    const policies = this.policies.get(key)!;
    
    // Insert in priority order (higher priority number = evaluated first)
    // Priority 20 (bootstrap) should come before priority 10 (normal)
    const priority = policy.priority || 100;
    policies.push(policy);
    
    // Sort by priority descending (higher numbers first)
    // Bootstrap policy (20) will be evaluated before normal policy (10)
    policies.sort((a, b) => (b.priority || 100) - (a.priority || 100));
  }

  /**
   * Get policies for a resource and action
   */
  getPolicies(resource: string, action: string): Policy[] {
    const key = `${resource}:${action}`;
    return this.policies.get(key) || [];
  }

  /**
   * Get all policies
   */
  getAllPolicies(): Policy[] {
    const all: Policy[] = [];
    this.policies.forEach(policies => {
      all.push(...policies);
    });
    return all;
  }
}

// Singleton instance
let registryInstance: PolicyRegistry | null = null;

/**
 * Get the policy registry instance
 */
export function getPolicyRegistry(): PolicyRegistry {
  if (!registryInstance) {
    registryInstance = new PolicyRegistry();
  }
  return registryInstance;
}
