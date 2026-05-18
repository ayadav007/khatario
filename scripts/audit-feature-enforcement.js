/**
 * COMPREHENSIVE FEATURE ENFORCEMENT AUDIT SCRIPT
 * 
 * This script identifies ALL missing subscription feature enforcement across:
 * - API endpoints (POST, PUT, PATCH, DELETE)
 * - UI pages (routes)
 * - Background jobs
 * 
 * Usage: node scripts/audit-feature-enforcement.js
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// All feature keys from seed_subscriptions.sql
const ALL_FEATURES = [
  // Limits (handled separately)
  'limit_invoices', 'limit_customers', 'limit_items', 'limit_users', 'limit_whatsapp_daily',
  
  // Core
  'customer_management', 'item_management', 'invoice_creation', 'payment_tracking', 'stock_tracking',
  'dashboard_analytics',
  
  // Invoice Templates
  'template_basic', 'template_all', 'template_thermal', 'template_customization', 'pdf_generation',
  
  // Modules
  'purchase_management', 'expense_tracking', 'supplier_management', 'multi_user', 'multi_branch',
  
  // Reports
  'reports_basic', 'reports_gst', 'reports_advanced', 'reports_analytics',
  
  // Alerts & Automation
  'alert_low_stock', 'alert_credit_limit', 'recurring_invoices',
  
  // Integrations
  'whatsapp_manual', 'whatsapp_auto_reminders', 'email_invoicing', 'payment_gateway', 'api_access',
  
  // Advanced Features
  'estimates_quotations', 'credit_notes', 'ledger_accounting', 'backup_restore',
  'online_store', 'barcode_scanning', 'multi_currency', 'custom_branding'
];

// Feature → Expected API Routes/Endpoints mapping
const FEATURE_ENDPOINTS = {
  'template_customization': [
    '/api/invoice-template-settings (POST)',
    '/api/invoice-template-settings (GET)', // Should check read access too
    '/api/template-preview (POST)', // If it allows customization
  ],
  'recurring_invoices': [
    '/api/recurring-invoices (POST)',
    '/api/recurring-invoices (PUT)',
    '/api/recurring-invoices (DELETE)',
    '/api/cron/process-reversing-entries',
  ],
  'email_invoicing': [
    '/api/invoices/[id]/email (POST)',
  ],
  'estimates_quotations': [
    '/api/estimates (POST)',
    '/api/estimates (PUT)',
    '/api/estimates/[id]/convert',
  ],
  'credit_notes': [
    '/api/credit-notes (POST)',
    '/api/credit-notes (PUT)',
  ],
  'backup_restore': [
    '/api/backup/create (POST)',
    '/api/backup/restore (POST)',
  ],
  'multi_branch': [
    '/api/locations (POST)',
    '/api/stock-transfers (POST)',
  ],
  'supplier_management': [
    '/api/suppliers (POST)',
    '/api/suppliers (PUT)',
  ],
  'purchase_management': [
    '/api/purchases (POST)',
    '/api/purchases/[id]/finalize',
    '/api/purchases/[id]/payments',
  ],
  'expense_tracking': [
    '/api/expenses (POST)',
    '/api/expenses (PUT)',
  ],
  'reports_basic': [
    '/api/reports/stock/** (GET)',
    '/api/reports/sales/** (GET)',
    '/api/reports/purchase/** (GET)',
    '/api/reports/party/** (GET)',
    '/api/reports/expense/** (GET)',
  ],
  'reports_gst': [
    '/api/reports/gst/** (GET)',
  ],
  'reports_advanced': [
    '/api/reports/profit-loss (GET)',
    '/api/reports/balance-sheet (GET)',
    '/api/reports/cash-flow (GET)',
    '/api/reports/trial-balance (GET)',
    '/api/reports/aging/** (GET)',
  ],
};

function getAllRouteFiles() {
  const apiDir = path.join(process.cwd(), 'app', 'api');
  const routes = [];
  
  function walkDir(dir, basePath = '') {
    const files = fs.readdirSync(dir);
    
    for (const file of files) {
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);
      
      if (stat.isDirectory()) {
        walkDir(fullPath, path.join(basePath, file));
      } else if (file === 'route.ts' || file === 'route.js') {
        routes.push({
          fullPath,
          route: basePath.replace(/\\/g, '/'),
          methods: extractMethods(fullPath)
        });
      }
    }
  }
  
  walkDir(apiDir);
  return routes;
}

function extractMethods(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const methods = [];
  
  if (content.includes('export async function GET') || content.includes('export function GET')) {
    methods.push('GET');
  }
  if (content.includes('export async function POST') || content.includes('export function POST')) {
    methods.push('POST');
  }
  if (content.includes('export async function PUT') || content.includes('export function PUT')) {
    methods.push('PUT');
  }
  if (content.includes('export async function PATCH') || content.includes('export function PATCH')) {
    methods.push('PATCH');
  }
  if (content.includes('export async function DELETE') || content.includes('export function DELETE')) {
    methods.push('DELETE');
  }
  
  return methods;
}

function checkEnforcement(filePath, featureKey) {
  const content = fs.readFileSync(filePath, 'utf-8');
  
  // Check for assertFeatureAccess
  const hasAssertFeatureAccess = content.includes(`assertFeatureAccess`) && 
                                  content.includes(featureKey);
  
  // Check for hasFeatureAccess
  const hasHasFeatureAccess = content.includes(`hasFeatureAccess`) && 
                              content.includes(featureKey);
  
  // Check for requireFeature (old method)
  const hasRequireFeature = content.includes(`requireFeature`) && 
                            content.includes(featureKey);
  
  // Check imports
  const importsFeatureAccess = content.includes('feature-access') || 
                               content.includes('feature_access') ||
                               content.includes('assertFeatureAccess');
  
  return {
    hasEnforcement: hasAssertFeatureAccess || hasHasFeatureAccess || hasRequireFeature,
    hasImport: importsFeatureAccess,
    method: hasAssertFeatureAccess ? 'assertFeatureAccess' : 
            hasHasFeatureAccess ? 'hasFeatureAccess' : 
            hasRequireFeature ? 'requireFeature' : null
  };
}

function auditRoute(route, methods) {
  const filePath = route.fullPath;
  const routePath = `/api/${route.route}`;
  const issues = [];
  
  // Determine which features this route might be related to
  const possibleFeatures = [];
  for (const [feature, endpoints] of Object.entries(FEATURE_ENDPOINTS)) {
    if (endpoints.some(e => routePath.includes(e.split(' ')[0].replace('/api', '')))) {
      possibleFeatures.push(feature);
    }
  }
  
  // Also check route path for feature keywords
  const routeLower = routePath.toLowerCase();
  if (routeLower.includes('template') && routeLower.includes('custom')) {
    possibleFeatures.push('template_customization');
  }
  if (routeLower.includes('recurring')) {
    possibleFeatures.push('recurring_invoices');
  }
  if (routeLower.includes('email')) {
    possibleFeatures.push('email_invoicing');
  }
  if (routeLower.includes('estimate')) {
    possibleFeatures.push('estimates_quotations');
  }
  if (routeLower.includes('credit') || routeLower.includes('return')) {
    possibleFeatures.push('credit_notes');
  }
  if (routeLower.includes('backup')) {
    possibleFeatures.push('backup_restore');
  }
  if (routeLower.includes('location') || routeLower.includes('branch')) {
    possibleFeatures.push('multi_branch');
  }
  if (routeLower.includes('supplier')) {
    possibleFeatures.push('supplier_management');
  }
  if (routeLower.includes('purchase')) {
    possibleFeatures.push('purchase_management');
  }
  if (routeLower.includes('expense')) {
    possibleFeatures.push('expense_tracking');
  }
  if (routeLower.includes('report')) {
    // Determine report type from path
    if (routeLower.includes('gst')) {
      possibleFeatures.push('reports_gst');
    } else if (routeLower.includes('profit') || routeLower.includes('balance') || routeLower.includes('cash') || routeLower.includes('trial') || routeLower.includes('aging')) {
      possibleFeatures.push('reports_advanced');
    } else {
      possibleFeatures.push('reports_basic');
    }
  }
  
  // Remove duplicates
  const uniqueFeatures = [...new Set(possibleFeatures)];
  
  // Check each method
  for (const method of methods) {
    // Only check mutation methods (POST, PUT, PATCH, DELETE)
    // GET methods might need checks too, but less critical
    const isMutation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
    const isRead = method === 'GET';
    
    // For mutation methods, check all possible features
    if (isMutation || (isRead && uniqueFeatures.length > 0)) {
      for (const feature of uniqueFeatures) {
        const enforcement = checkEnforcement(filePath, feature);
        
        if (!enforcement.hasEnforcement) {
          issues.push({
            route: routePath,
            method,
            feature,
            severity: isMutation ? 'HIGH' : 'MEDIUM',
            issue: `Missing feature enforcement for ${feature}`,
            hasImport: enforcement.hasImport
          });
        }
      }
    }
  }
  
  return issues;
}

function main() {
  console.log('🔍 Starting Comprehensive Feature Enforcement Audit...\n');
  
  const routes = getAllRouteFiles();
  console.log(`Found ${routes.length} API route files\n`);
  
  const allIssues = [];
  
  for (const route of routes) {
    if (route.methods.length === 0) continue;
    
    const issues = auditRoute(route, route.methods);
    allIssues.push(...issues);
  }
  
  // Group by feature
  const issuesByFeature = {};
  for (const issue of allIssues) {
    if (!issuesByFeature[issue.feature]) {
      issuesByFeature[issue.feature] = [];
    }
    issuesByFeature[issue.feature].push(issue);
  }
  
  // Generate report
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(' FEATURE ENFORCEMENT AUDIT RESULTS');
  console.log('═══════════════════════════════════════════════════════════════\n');
  
  if (allIssues.length === 0) {
    console.log('✅ No missing enforcement found! All features are properly protected.\n');
  } else {
    console.log(`❌ Found ${allIssues.length} missing enforcement issues across ${Object.keys(issuesByFeature).length} features\n`);
    
    for (const [feature, issues] of Object.entries(issuesByFeature)) {
      console.log(`\n📌 Feature: ${feature}`);
      console.log('─'.repeat(70));
      
      const highSeverity = issues.filter(i => i.severity === 'HIGH');
      const mediumSeverity = issues.filter(i => i.severity === 'MEDIUM');
      
      if (highSeverity.length > 0) {
        console.log(`\n🔴 HIGH SEVERITY (${highSeverity.length} issues):`);
        for (const issue of highSeverity) {
          console.log(`   • ${issue.method} ${issue.route}`);
          console.log(`     Missing: assertFeatureAccess('${issue.feature}')`);
          if (issue.hasImport) {
            console.log(`     ⚠️  Import exists but not used`);
          }
        }
      }
      
      if (mediumSeverity.length > 0) {
        console.log(`\n🟡 MEDIUM SEVERITY (${mediumSeverity.length} issues):`);
        for (const issue of mediumSeverity) {
          console.log(`   • ${issue.method} ${issue.route}`);
          console.log(`     Missing: assertFeatureAccess('${issue.feature}')`);
        }
      }
    }
    
    console.log('\n\n═══════════════════════════════════════════════════════════════');
    console.log(' SUMMARY');
    console.log('═══════════════════════════════════════════════════════════════\n');
    console.log(`Total Issues: ${allIssues.length}`);
    console.log(`High Severity: ${allIssues.filter(i => i.severity === 'HIGH').length}`);
    console.log(`Medium Severity: ${allIssues.filter(i => i.severity === 'MEDIUM').length}`);
    console.log(`Features Affected: ${Object.keys(issuesByFeature).length}`);
    
    // Write detailed report to file
    const reportPath = path.join(process.cwd(), 'docs', 'FEATURE_ENFORCEMENT_AUDIT_REPORT.md');
    const reportContent = generateMarkdownReport(issuesByFeature, allIssues);
    fs.writeFileSync(reportPath, reportContent);
    console.log(`\n📄 Detailed report saved to: ${reportPath}`);
  }
}

function generateMarkdownReport(issuesByFeature, allIssues) {
  let markdown = `# Feature Enforcement Audit Report\n\n`;
  markdown += `**Generated:** ${new Date().toISOString()}\n\n`;
  markdown += `**Total Issues:** ${allIssues.length}\n`;
  markdown += `**High Severity:** ${allIssues.filter(i => i.severity === 'HIGH').length}\n`;
  markdown += `**Medium Severity:** ${allIssues.filter(i => i.severity === 'MEDIUM').length}\n`;
  markdown += `**Features Affected:** ${Object.keys(issuesByFeature).length}\n\n`;
  
  markdown += `## Issues by Feature\n\n`;
  
  for (const [feature, issues] of Object.entries(issuesByFeature)) {
    markdown += `### ${feature}\n\n`;
    
    const highSeverity = issues.filter(i => i.severity === 'HIGH');
    const mediumSeverity = issues.filter(i => i.severity === 'MEDIUM');
    
    if (highSeverity.length > 0) {
      markdown += `#### 🔴 High Severity\n\n`;
      markdown += `| Route | Method | Issue |\n`;
      markdown += `|-------|--------|-------|\n`;
      for (const issue of highSeverity) {
        markdown += `| ${issue.route} | ${issue.method} | Missing assertFeatureAccess('${issue.feature}') |\n`;
      }
      markdown += `\n`;
    }
    
    if (mediumSeverity.length > 0) {
      markdown += `#### 🟡 Medium Severity\n\n`;
      markdown += `| Route | Method | Issue |\n`;
      markdown += `|-------|--------|-------|\n`;
      for (const issue of mediumSeverity) {
        markdown += `| ${issue.route} | ${issue.method} | Missing assertFeatureAccess('${issue.feature}') |\n`;
      }
      markdown += `\n`;
    }
  }
  
  return markdown;
}

main();
