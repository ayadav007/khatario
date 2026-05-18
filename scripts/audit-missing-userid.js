/**
 * Audit Script: Missing user_id in Frontend API Calls
 * 
 * Finds all API endpoints that require user_id for authorization
 * and checks if the frontend is sending it.
 */

const fs = require('fs');
const path = require('path');

// API routes directory
const API_DIR = path.join(__dirname, '..', 'app', 'api');
// Frontend pages/components directory
const FRONTEND_DIR = path.join(__dirname, '..', 'app');

// Track findings
const findings = {
  apis_requiring_userid: [],
  frontend_calls: new Map(), // endpoint -> [calling files]
  missing_userid: []
};

/**
 * Scan API routes for user_id requirements
 */
function scanAPIRoutes(dir) {
  const files = fs.readdirSync(dir, { withFileTypes: true });
  
  for (const file of files) {
    const fullPath = path.join(dir, file.name);
    
    if (file.isDirectory()) {
      scanAPIRoutes(fullPath);
    } else if (file.name === 'route.ts' || file.name === 'route.js') {
      const content = fs.readFileSync(fullPath, 'utf-8');
      const relativePath = path.relative(path.join(__dirname, '..'), fullPath);
      
      // Check if API requires user_id
      const requiresUserId = 
        content.includes('user_id') && (
          content.includes('user_id is required') ||
          content.includes('userId is required') ||
          content.includes('user_id.*required') ||
          content.includes('REQUIRED for authorization') ||
          content.match(/authorize\([^,]*user_id|authorize\(userId/) ||
          content.includes('searchParams.get(\'user_id\')') ||
          content.includes('searchParams.get("user_id")')
        );
      
      if (requiresUserId) {
        // Extract HTTP method and route path
        const routeMatch = relativePath.match(/api\/(.+?)\/route\.ts?/);
        const routePath = routeMatch ? routeMatch[1] : relativePath;
        
        // Extract method from content
        const methods = [];
        if (content.includes('export async function GET')) methods.push('GET');
        if (content.includes('export async function POST')) methods.push('POST');
        if (content.includes('export async function PATCH')) methods.push('PATCH');
        if (content.includes('export async function PUT')) methods.push('PUT');
        if (content.includes('export async function DELETE')) methods.push('DELETE');
        
        for (const method of methods) {
          findings.apis_requiring_userid.push({
            file: relativePath,
            method,
            route: `/${routePath}`,
            path: relativePath
          });
        }
      }
    }
  }
}

/**
 * Scan frontend for API calls
 */
function scanFrontend(dir, basePath = '') {
  if (!fs.existsSync(dir)) return;
  
  const files = fs.readdirSync(dir, { withFileTypes: true });
  
  for (const file of files) {
    // Skip node_modules, .next, etc.
    if (file.name.startsWith('.') || file.name === 'node_modules' || file.name === '.next') {
      continue;
    }
    
    const fullPath = path.join(dir, file.name);
    const relativePath = path.join(basePath, file.name);
    
    if (file.isDirectory()) {
      scanFrontend(fullPath, relativePath);
    } else if (file.name.endsWith('.tsx') || file.name.endsWith('.ts') || file.name.endsWith('.jsx') || file.name.endsWith('.js')) {
      try {
        const content = fs.readFileSync(fullPath, 'utf-8');
        
        // Find API calls
        const apiCallPattern = /fetch\(['"`]([^'"`]+api\/[^'"`]+)['"`]/gi;
        const paramsPattern = /fetch\(['"`]([^'"`]+api\/[^'"`]+)\?([^'"`]+)['"`]/gi;
        
        let match;
        
        // Check URLSearchParams pattern
        const urlParamsPattern = /new URLSearchParams\(\)|URLSearchParams\(\)/g;
        if (urlParamsPattern.test(content)) {
          // Find fetch calls that use URLSearchParams
          const fetchMatches = content.matchAll(/fetch\([^)]+\)/g);
          for (const fetchMatch of fetchMatches) {
            const fetchCall = fetchMatch[0];
            if (fetchCall.includes('/api/')) {
              // Extract endpoint
              const endpointMatch = fetchCall.match(/['"`]([^'"`]*\/api\/[^'"`]+)['"`]/);
              if (endpointMatch) {
                const endpoint = endpointMatch[1].split('?')[0]; // Remove query params
                
                // Check if user_id is being appended
                const hasUserId = 
                  fetchCall.includes('user_id') ||
                  fetchCall.includes('userId') ||
                  fetchCall.includes('user.id') ||
                  fetchCall.includes('user?.id') ||
                  content.includes('params.append(\'user_id\'');

                if (!findings.frontend_calls.has(endpoint)) {
                  findings.frontend_calls.set(endpoint, []);
                }
                
                findings.frontend_calls.get(endpoint).push({
                  file: relativePath,
                  hasUserId,
                  line: content.substring(0, fetchMatch.index).split('\n').length
                });
              }
            }
          }
        }
        
        // Check direct fetch with query string
        while ((match = apiCallPattern.exec(content)) !== null) {
          const url = match[1];
          if (url.includes('/api/')) {
            const endpoint = url.split('?')[0];
            const queryString = url.includes('?') ? url.split('?')[1] : '';
            const hasUserId = queryString.includes('user_id') || queryString.includes('userId');
            
            if (!findings.frontend_calls.has(endpoint)) {
              findings.frontend_calls.set(endpoint, []);
            }
            
            findings.frontend_calls.get(endpoint).push({
              file: relativePath,
              hasUserId,
              line: content.substring(0, match.index).split('\n').length
            });
          }
        }
      } catch (err) {
        // Skip files that can't be read
      }
    }
  }
}

/**
 * Compare API requirements with frontend calls
 */
function compareFindings() {
  for (const api of findings.apis_requiring_userid) {
    const endpoint = api.route;
    const calls = findings.frontend_calls.get(endpoint) || [];
    
    // Check if any call is missing user_id
    const missingUserId = calls.filter(call => !call.hasUserId);
    
    if (missingUserId.length > 0) {
      findings.missing_userid.push({
        endpoint,
        method: api.method,
        apiFile: api.file,
        frontendFiles: missingUserId.map(c => ({
          file: c.file,
          line: c.line
        })),
        allCalls: calls.length
      });
    }
  }
}

/**
 * Main execution
 */
console.log('🔍 Scanning API routes...');
scanAPIRoutes(API_DIR);

console.log(`📋 Found ${findings.apis_requiring_userid.length} API endpoints requiring user_id`);

console.log('🔍 Scanning frontend for API calls...');
scanFrontend(FRONTEND_DIR);

console.log(`📋 Found ${findings.frontend_calls.size} unique API endpoints called from frontend`);

console.log('🔍 Comparing findings...');
compareFindings();

// Generate report
console.log('\n' + '='.repeat(80));
console.log('AUDIT REPORT: Missing user_id in Frontend API Calls');
console.log('='.repeat(80));

if (findings.missing_userid.length === 0) {
  console.log('\n✅ No issues found! All frontend calls include user_id where required.');
} else {
  console.log(`\n❌ Found ${findings.missing_userid.length} endpoints with missing user_id:\n`);
  
  findings.missing_userid.forEach((finding, index) => {
    console.log(`${index + 1}. ${finding.method} ${finding.endpoint}`);
    console.log(`   API File: ${finding.apiFile}`);
    console.log(`   Frontend Files Missing user_id:`);
    finding.frontendFiles.forEach(f => {
      console.log(`     - ${f.file} (line ~${f.line})`);
    });
    console.log(`   Total calls: ${finding.allCalls} (${finding.frontendFiles.length} missing user_id)`);
    console.log('');
  });
}

// Save detailed report to file
const reportPath = path.join(__dirname, '..', 'MISSING_USERID_AUDIT_REPORT.md');
const report = `# Missing user_id Audit Report

Generated: ${new Date().toISOString()}

## Summary

- **APIs Requiring user_id**: ${findings.apis_requiring_userid.length}
- **Frontend Calls Found**: ${findings.frontend_calls.size}
- **Issues Found**: ${findings.missing_userid.length}

## APIs Requiring user_id

${findings.apis_requiring_userid.map(api => `- \`${api.method}\` ${api.route} (${api.file})`).join('\n')}

## Missing user_id Issues

${findings.missing_userid.length === 0 
  ? '✅ No issues found!' 
  : findings.missing_userid.map((finding, index) => `
### ${index + 1}. ${finding.method} ${finding.endpoint}

- **API File**: \`${finding.apiFile}\`
- **Frontend Files Missing user_id**:
${finding.frontendFiles.map(f => `  - \`${f.file}\` (line ~${f.line})`).join('\n')}
- **Total Calls**: ${finding.allCalls} (${finding.frontendFiles.length} missing user_id)

**Fix Required**: Add \`user_id\` parameter to the API call in the frontend files listed above.
`).join('\n')}
`;

fs.writeFileSync(reportPath, report);
console.log(`\n📄 Detailed report saved to: ${reportPath}`);

// Exit with error code if issues found
process.exit(findings.missing_userid.length > 0 ? 1 : 0);
