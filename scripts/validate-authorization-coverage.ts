#!/usr/bin/env ts-node

/**
 * Authorization Coverage Validator
 * 
 * Scans all API routes and verifies that authorization is enforced.
 * Fails if a route mutates data without authorize() call.
 * 
 * Usage: npx ts-node scripts/validate-authorization-coverage.ts
 */

import * as fs from 'fs';
import * as path from 'path';

interface RouteInfo {
  file: string;
  method: string;
  hasAuthorization: boolean;
  line?: number;
}

const API_DIR = path.join(process.cwd(), 'app/api');
const routes: RouteInfo[] = [];

// Methods that mutate data (require authorization)
const MUTATING_METHODS = ['POST', 'PATCH', 'PUT', 'DELETE'];

// Methods that read data (should have authorization but not critical)
const READING_METHODS = ['GET'];

// Files to exclude from validation
const EXCLUDED_PATTERNS = [
  /\/api\/auth\//,
  /\/api\/cron\//,
  /\/api\/webhooks\//,
  /\/api\/public\//,
];

function scanDirectory(dir: string, basePath: string = '') {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.join(basePath, entry.name);

    if (entry.isDirectory()) {
      scanDirectory(fullPath, relativePath);
    } else if (entry.isFile() && entry.name === 'route.ts') {
      const fileContent = fs.readFileSync(fullPath, 'utf-8');
      analyzeRoute(fullPath, fileContent, relativePath);
    }
  }
}

function analyzeRoute(filePath: string, content: string, relativePath: string) {
  // Skip excluded patterns
  if (EXCLUDED_PATTERNS.some(pattern => pattern.test(filePath))) {
    return;
  }

  // Check for export async function GET/POST/PATCH/PUT/DELETE
  const methodRegex = /export\s+async\s+function\s+(GET|POST|PATCH|PUT|DELETE)/g;
  let match;

  while ((match = methodRegex.exec(content)) !== null) {
    const method = match[1];
    const methodStart = match.index;
    
    // Find the function body
    const functionBody = extractFunctionBody(content, methodStart);
    
    // Check if authorize() is called in this function
    const hasAuthorization = checkForAuthorization(functionBody);
    
    // Find line number
    const lineNumber = content.substring(0, methodStart).split('\n').length;

    routes.push({
      file: relativePath,
      method,
      hasAuthorization,
      line: lineNumber,
    });
  }
}

function extractFunctionBody(content: string, startIndex: number): string {
  let braceCount = 0;
  let inFunction = false;
  let bodyStart = startIndex;

  // Find the opening brace
  for (let i = startIndex; i < content.length; i++) {
    if (content[i] === '{') {
      bodyStart = i;
      inFunction = true;
      braceCount = 1;
      break;
    }
  }

  if (!inFunction) return '';

  // Find the matching closing brace
  for (let i = bodyStart + 1; i < content.length; i++) {
    if (content[i] === '{') braceCount++;
    if (content[i] === '}') {
      braceCount--;
      if (braceCount === 0) {
        return content.substring(bodyStart, i + 1);
      }
    }
  }

  return content.substring(bodyStart);
}

function checkForAuthorization(functionBody: string): boolean {
  // Check for authorize() call
  const authorizePatterns = [
    /await\s+authorize\(/,
    /authorize\(/,
    /AuthorizationError/,
  ];

  return authorizePatterns.some(pattern => pattern.test(functionBody));
}

function generateReport() {
  console.log('\n🔍 Authorization Coverage Report\n');
  console.log('=' .repeat(80));

  const mutatingRoutes = routes.filter(r => MUTATING_METHODS.includes(r.method));
  const readingRoutes = routes.filter(r => READING_METHODS.includes(r.method));

  const unprotectedMutating = mutatingRoutes.filter(r => !r.hasAuthorization);
  const unprotectedReading = readingRoutes.filter(r => !r.hasAuthorization);

  console.log(`\n📊 Summary:`);
  console.log(`   Total Routes: ${routes.length}`);
  console.log(`   Mutating Routes: ${mutatingRoutes.length}`);
  console.log(`   Reading Routes: ${readingRoutes.length}`);
  console.log(`   ⚠️  Unprotected Mutating Routes: ${unprotectedMutating.length}`);
  console.log(`   ⚠️  Unprotected Reading Routes: ${unprotectedReading.length}`);

  if (unprotectedMutating.length > 0) {
    console.log(`\n❌ CRITICAL: Unprotected Mutating Routes (REQUIRE AUTHORIZATION):`);
    unprotectedMutating.forEach(route => {
      console.log(`   ${route.method.padEnd(6)} ${route.file.padEnd(50)} Line ${route.line}`);
    });
  }

  if (unprotectedReading.length > 0) {
    console.log(`\n⚠️  WARNING: Unprotected Reading Routes (SHOULD HAVE AUTHORIZATION):`);
    unprotectedReading.forEach(route => {
      console.log(`   ${route.method.padEnd(6)} ${route.file.padEnd(50)} Line ${route.line}`);
    });
  }

  if (unprotectedMutating.length === 0 && unprotectedReading.length === 0) {
    console.log(`\n✅ All routes are protected!`);
  }

  console.log('\n' + '='.repeat(80) + '\n');

  // Exit with error code if unprotected mutating routes found
  if (unprotectedMutating.length > 0) {
    process.exit(1);
  }
}

// Main execution
if (require.main === module) {
  if (!fs.existsSync(API_DIR)) {
    console.error(`❌ API directory not found: ${API_DIR}`);
    process.exit(1);
  }

  console.log('🔍 Scanning API routes...');
  scanDirectory(API_DIR);
  generateReport();
}

export { scanDirectory, analyzeRoute, checkForAuthorization };
