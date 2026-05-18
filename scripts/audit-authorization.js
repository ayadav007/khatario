#!/usr/bin/env node
/**
 * Authorization Audit Script
 * 
 * Scans all API routes and identifies:
 * - Routes missing authorize() calls
 * - Routes with incomplete authorization
 * - Frontend pages missing permission checks
 */

const fs = require('fs');
const path = require('path');
const { glob } = require('glob');

// Known public endpoints that don't need authorization
const PUBLIC_ENDPOINTS = [
  '/api/auth/login',
  '/api/auth/signup',
  '/api/auth/verify-otp',
  '/api/admin/login',
  '/api/admin/auth',
  '/api/permissions', // Public for permission listing
  '/api/notifications', // Has its own checks
];

// Known endpoints that have alternative authorization (admin, etc.)
const ALTERNATIVE_AUTH = [
  '/api/admin/',
  '/api/policies', // Platform admin only
];

async function findApiRoutes() {
  const routeFiles = await glob('app/api/**/route.ts', {
    cwd: process.cwd(),
    absolute: true,
  });
  return routeFiles;
}

async function findFrontendPages() {
  const pageFiles = await glob('app/**/page.tsx', {
    cwd: process.cwd(),
    absolute: true,
    ignore: ['**/admin/**', '**/login/**', '**/signup/**'],
  });
  return pageFiles;
}

function isPublicEndpoint(filePath) {
  const relativePath = path.relative(path.join(process.cwd(), 'app/api'), filePath);
  const route = '/' + relativePath.replace(/\/route\.ts$/, '').replace(/\\/g, '/');
  
  return PUBLIC_ENDPOINTS.some(pub => route.startsWith(pub)) ||
         ALTERNATIVE_AUTH.some(alt => route.startsWith(alt));
}

function analyzeRoute(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const route = path.relative(path.join(process.cwd(), 'app/api'), filePath)
    .replace(/\/route\.ts$/, '')
    .replace(/\\/g, '/');
  
  const issues = [];
  const methods = [];
  
  // Check for HTTP methods
  if (content.includes('export async function GET')) methods.push('GET');
  if (content.includes('export async function POST')) methods.push('POST');
  if (content.includes('export async function PUT')) methods.push('PUT');
  if (content.includes('export async function PATCH')) methods.push('PATCH');
  if (content.includes('export async function DELETE')) methods.push('DELETE');
  
  // Check for authorization
  const hasAuthorize = content.includes('authorize(') || content.includes('await authorize(');
  const hasCheckPermission = content.includes('checkUserPermission');
  const hasAdminAuth = content.includes('requirePlatformAdmin') || content.includes('getPlatformAdmin');
  const hasBasicAuth = content.includes('Unauthorized') || content.includes('401');
  
  // Determine if write operation
  const isWrite = methods.some(m => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(m));
  
  if (isPublicEndpoint(filePath)) {
    return { route, methods, hasAuth: true, authType: 'public', issues: [] };
  }
  
  if (hasAdminAuth) {
    return { route, methods, hasAuth: true, authType: 'admin', issues: [] };
  }
  
  // Check for missing authorization
  if (!hasAuthorize && !hasCheckPermission && !hasAdminAuth && !hasBasicAuth && methods.length > 0) {
    issues.push({
      severity: isWrite ? 'CRITICAL' : 'HIGH',
      message: `Missing authorization check for ${methods.join(', ')}`,
    });
  }
  
  // Check if user_id is being extracted but not used
  if (content.includes('userId') || content.includes('user_id') || content.includes('created_by')) {
    if (!hasAuthorize && !hasCheckPermission) {
      issues.push({
        severity: 'MEDIUM',
        message: 'User ID extracted but not used for authorization',
      });
    }
  }
  
  return {
    route: '/' + route,
    methods,
    hasAuth: hasAuthorize || hasCheckPermission || hasAdminAuth,
    authType: hasAdminAuth ? 'admin' : (hasAuthorize ? 'authorize' : (hasCheckPermission ? 'permission' : 'none')),
    issues,
    isWrite,
  };
}

function analyzeFrontendPage(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const page = path.relative(path.join(process.cwd(), 'app'), filePath)
    .replace(/\/page\.tsx$/, '')
    .replace(/\\/g, '/');
  
  const issues = [];
  
  // Check for permission hooks
  const hasUsePermissions = content.includes('usePermissions');
  const hasCanAdd = content.includes('canAdd');
  const hasCanView = content.includes('canView');
  const hasHasPermission = content.includes('hasPermission');
  const hasPermissionCheck = hasUsePermissions && (hasCanAdd || hasCanView || hasHasPermission);
  
  // Determine page type from route
  const isNewPage = page.includes('/new');
  const isDetailPage = /\/(\[id\]|\[.*\])/.test(page);
  const isListPage = !isNewPage && !isDetailPage;
  
  // Critical pages that should check permissions
  const criticalPages = [
    'invoices', 'purchases', 'customers', 'items', 'suppliers',
    'employees', 'attendance', 'leave', 'payroll', 'expenses',
    'payments', 'credit-notes', 'warehouses', 'journal-entries',
  ];
  
  const isCritical = criticalPages.some(cp => page.includes(cp));
  
  if (isCritical && !hasPermissionCheck) {
    const requiredCheck = isNewPage ? 'canAdd' : (isDetailPage ? 'canView' : 'canView');
    issues.push({
      severity: isNewPage ? 'CRITICAL' : 'HIGH',
      message: `Missing permission check (should check ${requiredCheck})`,
    });
  }
  
  // Check if page redirects on permission failure
  const hasRedirect = content.includes('router.push') || content.includes('redirect');
  const hasEarlyReturn = content.includes('return null') || content.includes('return <');
  
  if (isCritical && hasPermissionCheck && !hasRedirect && !hasEarlyReturn) {
    issues.push({
      severity: 'MEDIUM',
      message: 'Has permission check but no redirect/early return on failure',
    });
  }
  
  return {
    page: '/' + page,
    hasPermissionCheck,
    issues,
    isCritical,
  };
}

async function main() {
  console.log('🔍 Starting Authorization Audit...\n');
  
  // Audit API routes
  console.log('📁 Auditing API Routes...\n');
  const apiRoutes = await findApiRoutes();
  const routeResults = apiRoutes.map(analyzeRoute);
  
  const missingAuth = routeResults.filter(r => !r.hasAuth && r.methods.length > 0 && r.issues.length > 0);
  const writeWithoutAuth = routeResults.filter(r => r.isWrite && !r.hasAuth);
  
  console.log(`Total API routes: ${routeResults.length}`);
  console.log(`Routes with authorization: ${routeResults.filter(r => r.hasAuth).length}`);
  console.log(`Routes missing authorization: ${missingAuth.length}`);
  console.log(`Write routes without authorization: ${writeWithoutAuth.length}\n`);
  
  if (writeWithoutAuth.length > 0) {
    console.log('❌ CRITICAL: Write routes missing authorization:\n');
    writeWithoutAuth.forEach(r => {
      console.log(`  ${r.route}`);
      console.log(`    Methods: ${r.methods.join(', ')}`);
      r.issues.forEach(i => console.log(`    ⚠️  ${i.severity}: ${i.message}`));
      console.log('');
    });
  }
  
  if (missingAuth.length > 0 && missingAuth.length <= 50) {
    console.log('⚠️  Routes missing authorization:\n');
    missingAuth.slice(0, 30).forEach(r => {
      console.log(`  ${r.route} (${r.methods.join(', ')})`);
    });
    if (missingAuth.length > 30) {
      console.log(`  ... and ${missingAuth.length - 30} more\n`);
    }
  }
  
  // Audit frontend pages
  console.log('\n📄 Auditing Frontend Pages...\n');
  const frontendPages = await findFrontendPages();
  const pageResults = frontendPages.map(analyzeFrontendPage);
  
  const missingPermissionChecks = pageResults.filter(p => p.isCritical && !p.hasPermissionCheck);
  
  console.log(`Total frontend pages: ${pageResults.length}`);
  console.log(`Pages with permission checks: ${pageResults.filter(p => p.hasPermissionCheck).length}`);
  console.log(`Critical pages missing permission checks: ${missingPermissionChecks.length}\n`);
  
  if (missingPermissionChecks.length > 0) {
    console.log('❌ CRITICAL/HIGH: Frontend pages missing permission checks:\n');
    missingPermissionChecks.forEach(p => {
      console.log(`  ${p.page}`);
      p.issues.forEach(i => console.log(`    ⚠️  ${i.severity}: ${i.message}`));
      console.log('');
    });
  }
  
  // Summary
  console.log('\n📊 Summary:\n');
  console.log(`API Routes:`);
  console.log(`  ✅ Authorized: ${routeResults.filter(r => r.hasAuth).length}`);
  console.log(`  ❌ Missing Auth: ${missingAuth.length}`);
  console.log(`  🔴 Write without Auth: ${writeWithoutAuth.length}`);
  console.log(`\nFrontend Pages:`);
  console.log(`  ✅ Has Permission Checks: ${pageResults.filter(p => p.hasPermissionCheck).length}`);
  console.log(`  ❌ Missing Permission Checks: ${missingPermissionChecks.length}`);
  
  // Exit with error code if critical issues found
  if (writeWithoutAuth.length > 0 || missingPermissionChecks.length > 0) {
    console.log('\n❌ CRITICAL ISSUES FOUND - Security vulnerabilities detected!');
    process.exit(1);
  } else {
    console.log('\n✅ No critical authorization issues found.');
    process.exit(0);
  }
}

main().catch(console.error);
