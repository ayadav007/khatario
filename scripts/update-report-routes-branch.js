/**
 * Script to identify report routes that need resolveBranchId() update
 * 
 * This script scans all report API routes and identifies which ones:
 * 1. Get branchId from searchParams
 * 2. Don't use resolveBranchId()
 * 3. Need to be updated
 */

const fs = require('fs');
const path = require('path');

const REPORTS_DIR = path.join(process.cwd(), 'app', 'api', 'reports');

function findReportRoutes(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  
  files.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    
    if (stat.isDirectory()) {
      findReportRoutes(filePath, fileList);
    } else if (file === 'route.ts') {
      fileList.push(filePath);
    }
  });
  
  return fileList;
}

function checkRoute(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const relativePath = path.relative(process.cwd(), filePath);
  
  // Check if it gets branchId from searchParams
  const hasBranchId = /branchId.*searchParams|branch_id.*searchParams/i.test(content);
  
  // Check if it uses resolveBranchId
  const usesResolveBranchId = /resolveBranchId/i.test(content);
  
  // Check if it has authorization with branchId
  const hasAuthorize = /authorize.*branchId/i.test(content);
  
  return {
    file: relativePath,
    hasBranchId,
    usesResolveBranchId,
    hasAuthorize,
    needsUpdate: hasBranchId && !usesResolveBranchId
  };
}

const routes = findReportRoutes(REPORTS_DIR);
const results = routes.map(checkRoute).filter(r => r.needsUpdate);

console.log(`\n📋 Report Routes Analysis\n`);
console.log(`Total report routes: ${routes.length}`);
console.log(`Routes needing update: ${results.length}\n`);
console.log('='.repeat(60));

results.forEach((result, index) => {
  console.log(`${index + 1}. ${result.file}`);
});

console.log('\n' + '='.repeat(60));
console.log(`\n✅ Routes already using resolveBranchId: ${routes.length - results.length}`);
console.log(`⚠️  Routes needing update: ${results.length}\n`);
