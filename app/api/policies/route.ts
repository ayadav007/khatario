import { NextRequest, NextResponse } from 'next/server';
import { getPolicyRegistry } from '@/lib/policies/registry';
import { requirePlatformRequest } from '@/lib/platform-request-auth';

/**
 * GET /api/policies
 * Get all registered PBAC policies (admin-only, read-only)
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requirePlatformRequest(request, 'viewer');
    if (!auth.ok) return auth.response;

    // Get all policies from registry
    const registry = getPolicyRegistry();
    const allPolicies = registry.getAllPolicies();

    // Transform policies for display (remove functions, add human-readable info)
    const policiesForDisplay = allPolicies.map(policy => {
      // Format conditions for display
      const conditionsDisplay = policy.conditions.map(condition => ({
        id: condition.id,
        description: condition.description,
        errorMessage: condition.errorMessage,
        errorCode: condition.errorCode,
        // Note: evaluate function is not included (it's a function)
      }));

      // Determine module name from resource
      const moduleName = getModuleName(policy.resource);

      return {
        resource: policy.resource,
        action: policy.action,
        requiresPermission: policy.requiresPermission,
        conditions: conditionsDisplay,
        conditionCount: policy.conditions.length,
        priority: policy.priority || 100,
        module: moduleName,
      };
    });

    // Sort by module, then resource, then action
    policiesForDisplay.sort((a, b) => {
      if (a.module !== b.module) {
        return a.module.localeCompare(b.module);
      }
      if (a.resource !== b.resource) {
        return a.resource.localeCompare(b.resource);
      }
      return a.action.localeCompare(b.action);
    });

    return NextResponse.json({
      policies: policiesForDisplay,
      total: policiesForDisplay.length,
      modules: [...new Set(policiesForDisplay.map(p => p.module))].sort(),
    });
  } catch (error: any) {
    console.error('Error fetching policies:', error);
    return NextResponse.json(
      { error: 'Failed to fetch policies', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * Helper to determine module name from resource
 */
function getModuleName(resource: string): string {
  const resourceLower = resource.toLowerCase();

  // Financial modules
  if (resourceLower.includes('invoice')) return 'Sales';
  if (resourceLower.includes('purchase')) return 'Purchases';
  if (resourceLower.includes('payment')) return 'Payments';
  if (resourceLower.includes('expense')) return 'Expenses';
  if (resourceLower.includes('credit_note') || resourceLower.includes('credit-note')) return 'Sales';

  // Inventory modules
  if (resourceLower.includes('warehouse') || resourceLower.includes('stock')) return 'Inventory';
  if (resourceLower.includes('item')) return 'Products';
  if (resourceLower.includes('inventory_adjustment')) return 'Inventory';

  // Accounting modules
  if (resourceLower.includes('journal')) return 'Accounting';
  if (resourceLower.includes('accounting_period') || resourceLower.includes('period')) return 'Accounting';

  // Reporting
  if (resourceLower.includes('report')) return 'Reports';

  // HR modules
  if (resourceLower.includes('employee')) return 'HR';
  if (resourceLower.includes('attendance')) return 'HR';
  if (resourceLower.includes('payroll') || resourceLower.includes('salary')) return 'HR';
  if (resourceLower.includes('leave')) return 'HR';

  // WhatsApp
  if (resourceLower.includes('whatsapp')) return 'WhatsApp';

  // Settings/Tools
  if (resourceLower.includes('tools')) return 'Settings';
  if (resourceLower.includes('settings')) return 'Settings';
  if (resourceLower.includes('customer')) return 'Sales';

  // Default
  return 'Other';
}
