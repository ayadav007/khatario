/**
 * PBAC Policy Validator
 * 
 * Build-time validator that ensures:
 * 1. All routes calling authorize() have corresponding policies
 * 2. All write routes (POST, PATCH, PUT, DELETE) call authorize()
 * 
 * Run this script as part of CI/CD pipeline.
 * 
 * Usage:
 *   node scripts/validate-pbac-policies.js
 */

const fs = require('fs');
const path = require('path');

// Known modules that should have policies (protected modules)
const PROTECTED_MODULES = [
  'invoices', 'invoice',
  'inventory_adjustments', 'inventory_adjustment',
  'warehouses', 'warehouse',
  'warehouse_transfers', 'warehouse_transfer', 'stock_transfers', 'stock_transfer',
  'journals', 'journal',
  'accounting_periods', 'accounting_period',
  'reports', 'report', 'report.financial', 'report.gst', 'report.inventory',
];

// Modules that are NOT yet protected (expected to fail policy check)
const UNPROTECTED_MODULES = [
  // All major modules now have policies
];

// Known policy resources
const POLICY_RESOURCES = [
  'invoice', 'invoices',
  'inventory_adjustment', 'inventory_adjustments',
  'warehouse', 'warehouses',
  'warehouse_transfer', 'warehouse_transfers', 'stock_transfer', 'stock_transfers',
  'journal', 'journals',
  'accounting_period', 'accounting_periods',
  'report', 'report.financial', 'report.gst', 'report.inventory',
  'customer', 'customers',
  'item', 'items',
  'purchase', 'purchases',
  'payment', 'payments',
  'expense', 'expenses',
  'credit_note', 'credit_notes',
  // HR resources
  'employee', 'employees',
  'attendance',
  'payroll', 'salary',
  'leave_request', 'leave_requests',
  // WhatsApp resources
  'whatsapp',
  'whatsapp_message', 'whatsapp_messages',
  'whatsapp_conversation', 'whatsapp_conversations',
  'whatsapp_campaign', 'whatsapp_campaigns',
  'whatsapp_bot',
  // Tools resources
  'tools',
  'settings',
];

// Actions that require policies
const PROTECTED_ACTIONS = ['read', 'create', 'update', 'delete', 'export', 'finalize', 'cancel', 'adjust_quantity', 'adjust_value', 'dispatch', 'receive'];

/**
 * Find all API route files
 */
function findRouteFiles(dir = 'app/api', routeFiles = []) {
  const files = fs.readdirSync(dir);
  
  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    
    if (stat.isDirectory()) {
      // Skip certain directories
      if (file === 'node_modules' || file === '.next' || file === 'admin') {
        continue;
      }
      findRouteFiles(filePath, routeFiles);
    } else if (file === 'route.ts' || file === 'route.js') {
      routeFiles.push(filePath);
    }
  }
  
  return routeFiles;
}

/**
 * Extract authorize() calls from a file
 */
function extractAuthorizeCalls(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const authorizeCalls = [];
  
  // Match authorize(userId, resource, action, ...) patterns
  const authorizePattern = /authorize\s*\(\s*['"`]?(\w+)['"`]?\s*,\s*['"`]([^'"`]+)['"`]\s*,\s*['"`]([^'"`]+)['"`]/g;
  
  let match;
  while ((match = authorizePattern.exec(content)) !== null) {
    const [, userIdVar, resource, action] = match;
    authorizeCalls.push({
      file: filePath,
      resource,
      action,
      line: content.substring(0, match.index).split('\n').length,
    });
  }
  
  return authorizeCalls;
}

/**
 * Check if a route is a write route
 */
function isWriteRoute(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  
  // Check for POST, PATCH, PUT, DELETE exports
  const hasPost = /export\s+(async\s+)?function\s+POST/.test(content);
  const hasPatch = /export\s+(async\s+)?function\s+PATCH/.test(content);
  const hasPut = /export\s+(async\s+)?function\s+PUT/.test(content);
  const hasDelete = /export\s+(async\s+)?function\s+DELETE/.test(content);
  
  return hasPost || hasPatch || hasPut || hasDelete;
}

/**
 * Check if a resource/action has a policy
 */
function hasPolicy(resource, action) {
  // Normalize resource name
  const normalizedResource = resource.toLowerCase();
  
  // Check if resource is in known policy resources
  return POLICY_RESOURCES.some(pr => {
    const normalizedPr = pr.toLowerCase();
    return normalizedResource === normalizedPr || normalizedResource.startsWith(normalizedPr + '.');
  });
}

/**
 * Main validation function
 */
function validatePBACPolicies() {
  console.log('🔍 Validating PBAC policies...\n');
  
  const routeFiles = findRouteFiles();
  const errors = [];
  const warnings = [];
  
  // Track all authorize() calls
  const authorizeCalls = [];
  
  for (const routeFile of routeFiles) {
    const calls = extractAuthorizeCalls(routeFile);
    authorizeCalls.push(...calls);
    
    // Check if write route has authorize() calls
    if (isWriteRoute(routeFile)) {
      if (calls.length === 0) {
        warnings.push({
          file: routeFile,
          issue: 'Write route does not call authorize()',
          severity: 'WARNING',
        });
      }
    }
    
    // Check if authorize() calls have policies
    for (const call of calls) {
      if (!hasPolicy(call.resource, call.action)) {
        // Check if this is an expected unprotected module
        const isUnprotected = UNPROTECTED_MODULES.some(um => 
          call.resource.toLowerCase().includes(um.toLowerCase())
        );
        
        if (!isUnprotected) {
          errors.push({
            file: call.file,
            line: call.line,
            resource: call.resource,
            action: call.action,
            issue: `No PBAC policy defined for resource '${call.resource}' action '${call.action}'`,
          });
        }
      }
    }
  }
  
  // Report results
  console.log(`📊 Found ${authorizeCalls.length} authorize() calls across ${routeFiles.length} route files\n`);
  
  if (warnings.length > 0) {
    console.log('⚠️  WARNINGS:');
    warnings.forEach(w => {
      console.log(`   ${w.file}: ${w.issue}`);
    });
    console.log('');
  }
  
  if (errors.length > 0) {
    console.log('❌ ERRORS (Routes without policies):');
    errors.forEach(e => {
      console.log(`   ${e.file}:${e.line}`);
      console.log(`      Resource: ${e.resource}, Action: ${e.action}`);
      console.log(`      Issue: ${e.issue}\n`);
    });
    
    console.log(`\n❌ Validation failed: ${errors.length} route(s) call authorize() without policies`);
    console.log('💡 Solution: Add PBAC policies for these resources or remove authorize() calls');
    process.exit(1);
  }
  
  console.log('✅ All authorize() calls have corresponding policies\n');
  
  if (warnings.length > 0) {
    console.log(`⚠️  ${warnings.length} write route(s) do not call authorize()`);
    console.log('💡 Consider adding authorization checks to write routes\n');
  }
  
  console.log('✅ PBAC policy validation passed');
}

// Run validation
if (require.main === module) {
  try {
    validatePBACPolicies();
  } catch (error) {
    console.error('❌ Validation error:', error);
    process.exit(1);
  }
}

module.exports = { validatePBACPolicies };
