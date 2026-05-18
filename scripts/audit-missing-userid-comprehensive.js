/**
 * Comprehensive Audit Script: Missing user_id/created_by/updated_by in Frontend API Calls
 * 
 * Scans all API endpoints that require user_id for authorization
 * and checks if the frontend is sending it in API calls.
 * 
 * Generates a detailed report of all missing cases.
 */

const fs = require('fs');
const path = require('path');

// Directories
const API_DIR = path.join(__dirname, '..', 'app', 'api');
const FRONTEND_DIR = path.join(__dirname, '..', 'app');
const COMPONENTS_DIR = path.join(__dirname, '..', 'components');

// Track findings
const findings = {
  apis_requiring_userid: [], // All APIs that require user_id
  frontend_calls: [], // All frontend API calls found
  missing_userid: [], // APIs called without required user_id
  report: []
};

/**
 * Extract route path from file path
 */
function getRoutePath(filePath) {
  const match = filePath.match(/api[\/\\](.+?)[\/\\]route\.(ts|js)$/);
  if (match) {
    return '/' + match[1].replace(/\\/g, '/');
  }
  return null;
}

/**
 * Scan API routes for user_id requirements
 */
function scanAPIRoutes(dir, basePath = '') {
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
      scanAPIRoutes(fullPath, relativePath);
    } else if (file.name === 'route.ts' || file.name === 'route.js') {
      try {
        const content = fs.readFileSync(fullPath, 'utf-8');
        const routePath = getRoutePath(fullPath);
        
        if (!routePath) continue;
        
        // Check each HTTP method
        const methods = [];
        if (content.includes('export async function GET')) methods.push('GET');
        if (content.includes('export async function POST')) methods.push('POST');
        if (content.includes('export async function PATCH')) methods.push('PATCH');
        if (content.includes('export async function PUT')) methods.push('PUT');
        if (content.includes('export async function DELETE')) methods.push('DELETE');
        
        for (const method of methods) {
          // Determine what user_id field is expected
          let expectedField = null;
          let checkPattern = null;
          
          if (method === 'GET') {
            // GET requests usually expect user_id in query params
            if (content.includes('user_id') || content.includes('userId')) {
              expectedField = 'user_id (query param)';
              checkPattern = /searchParams\.get\(['"]user_id['"]\)|searchParams\.get\(['"]userId['"]\)/;
            }
          } else if (method === 'POST') {
            // POST requests expect created_by or created_by_user_id in body
            if (content.includes('created_by') && (content.includes('required') || content.includes('authorize'))) {
              expectedField = 'created_by (body)';
              checkPattern = /created_by|created_by_user_id/;
            } else if (content.includes('user_id') && (content.includes('required') || content.includes('authorize'))) {
              expectedField = 'user_id (body)';
              checkPattern = /user_id|userId/;
            }
          } else if (method === 'PATCH' || method === 'PUT') {
            // PATCH/PUT requests expect updated_by, updated_by_user_id, or user_id in body
            if (content.includes('updated_by') && (content.includes('required') || content.includes('authorize'))) {
              expectedField = 'updated_by (body)';
              checkPattern = /updated_by|updated_by_user_id/;
            } else if (content.includes('user_id') && (content.includes('required') || content.includes('authorize'))) {
              expectedField = 'user_id (body)';
              checkPattern = /user_id|userId/;
            }
          }
          
          // Check if authorization is used
          const usesAuth = content.includes('authorize(') || 
                          content.includes('REQUIRED for authorization') ||
                          content.includes('required for authorization');
          
          if (usesAuth && expectedField) {
            findings.apis_requiring_userid.push({
              file: path.relative(path.join(__dirname, '..'), fullPath),
              route: routePath,
              method,
              expectedField,
              checkPattern: checkPattern ? checkPattern.toString() : null,
              lineMatch: content.split('\n').findIndex(line => line.includes('required for authorization') || line.includes('authorize('))
            });
          }
        }
      } catch (error) {
        console.error(`Error reading ${fullPath}:`, error.message);
      }
    }
  }
}

/**
 * Scan frontend files for API calls
 */
function scanFrontendFiles(dir, basePath = '') {
  if (!fs.existsSync(dir)) return;
  
  const files = fs.readdirSync(dir, { withFileTypes: true });
  
  for (const file of files) {
    // Skip node_modules, .next, etc.
    if (file.name.startsWith('.') || 
        file.name === 'node_modules' || 
        file.name === '.next' ||
        file.name === 'api') { // Skip API routes themselves
      continue;
    }
    
    const fullPath = path.join(dir, file.name);
    const relativePath = path.join(basePath, file.name);
    
    if (file.isDirectory()) {
      scanFrontendFiles(fullPath, relativePath);
    } else if (file.name.endsWith('.tsx') || file.name.endsWith('.ts') || file.name.endsWith('.jsx') || file.name.endsWith('.js')) {
      try {
        const content = fs.readFileSync(fullPath, 'utf-8');
        
        // Find all fetch calls to API endpoints
        const fetchPattern = /fetch\s*\(\s*['"`]([^'"`]*\/api\/[^'"`]+)['"`]/gi;
        let match;
        
        while ((match = fetchPattern.exec(content)) !== null) {
          const apiUrl = match[1];
          const fetchCall = match[0];
          
          // Extract method from content (look for method: 'POST', etc.)
          const methodMatch = content.substring(match.index, match.index + 500).match(/method\s*:\s*['"](GET|POST|PATCH|PUT|DELETE)['"]/i);
          const method = methodMatch ? methodMatch[1].toUpperCase() : 'GET'; // Default to GET
          
          // Extract route path from URL
          const routeMatch = apiUrl.match(/\/api\/(.+?)(\?|$)/);
          const routePath = routeMatch ? '/' + routeMatch[1] : apiUrl;
          
          // Check if body is being sent (for POST/PATCH/PUT)
          const hasBody = ['POST', 'PATCH', 'PUT'].includes(method);
          let bodyContent = null;
          let hasUserId = false;
          let userIdField = null;
          
          if (hasBody) {
            // Find the body in JSON.stringify or the fetch options
            const bodyMatch = content.substring(match.index, Math.min(match.index + 2000, content.length))
              .match(/body\s*:\s*JSON\.stringify\s*\(([\s\S]*?)\)/);
            
            if (bodyMatch) {
              bodyContent = bodyMatch[1].trim();
              
              // Check for user_id fields in body
              if (bodyContent.includes('created_by') || bodyContent.includes('created_by_user_id')) {
                hasUserId = true;
                userIdField = 'created_by';
              } else if (bodyContent.includes('updated_by') || bodyContent.includes('updated_by_user_id')) {
                hasUserId = true;
                userIdField = 'updated_by';
              } else if (bodyContent.includes('user_id') || bodyContent.includes('userId') || bodyContent.includes('user?.id') || bodyContent.includes('user.id')) {
                hasUserId = true;
                userIdField = 'user_id';
              }
            }
          } else {
            // For GET requests, check query params
            const urlMatch = content.substring(match.index, Math.min(match.index + 500, content.length))
              .match(/['"`][^'"`]*\/api\/[^'"`]+['"`]/);
            
            if (urlMatch) {
              const urlString = urlMatch[0];
              if (urlString.includes('user_id') || urlString.includes('userId')) {
                hasUserId = true;
                userIdField = 'user_id (query)';
              }
            }
            
            // Also check for URLSearchParams
            const paramsMatch = content.substring(match.index, Math.min(match.index + 1000, content.length))
              .match(/URLSearchParams|searchParams/);
            if (paramsMatch) {
              const paramsContent = content.substring(Math.max(0, match.index - 500), match.index + 1000);
              if (paramsContent.includes('append') && (paramsContent.includes('user_id') || paramsContent.includes('userId'))) {
                hasUserId = true;
                userIdField = 'user_id (query)';
              }
            }
          }
          
          // Find line number
          const lines = content.substring(0, match.index).split('\n');
          const lineNumber = lines.length;
          
          findings.frontend_calls.push({
            file: path.relative(path.join(__dirname, '..'), fullPath),
            route: routePath,
            method,
            apiUrl,
            lineNumber,
            hasBody,
            hasUserId,
            userIdField,
            bodyContent: bodyContent ? bodyContent.substring(0, 200) : null
          });
        }
      } catch (error) {
        console.error(`Error reading ${fullPath}:`, error.message);
      }
    }
  }
}

/**
 * Match frontend calls with API requirements
 */
function matchCallsWithRequirements() {
  for (const apiReq of findings.apis_requiring_userid) {
    // Find matching frontend calls
    const matchingCalls = findings.frontend_calls.filter(call => 
      call.route === apiReq.route && call.method === apiReq.method
    );
    
    if (matchingCalls.length === 0) {
      // API exists but no frontend calls found (might be used differently)
      findings.report.push({
        type: 'no_frontend_call',
        api: apiReq,
        severity: 'low'
      });
    } else {
      for (const call of matchingCalls) {
        // Check if the expected field is present
        let isMissing = false;
        
        if (apiReq.expectedField.includes('created_by') && apiReq.method === 'POST') {
          isMissing = !call.hasUserId || !call.userIdField || 
                     (!call.userIdField.includes('created_by') && !call.userIdField.includes('user_id'));
        } else if (apiReq.expectedField.includes('updated_by') && (apiReq.method === 'PATCH' || apiReq.method === 'PUT')) {
          isMissing = !call.hasUserId || !call.userIdField || 
                     (!call.userIdField.includes('updated_by') && !call.userIdField.includes('user_id'));
        } else if (apiReq.expectedField.includes('user_id') && apiReq.method === 'GET') {
          isMissing = !call.hasUserId || !call.userIdField || !call.userIdField.includes('user_id');
        } else {
          // Generic check
          isMissing = !call.hasUserId;
        }
        
        if (isMissing) {
          findings.missing_userid.push({
            api: apiReq,
            frontend: call,
            severity: 'high'
          });
        }
      }
    }
  }
}

/**
 * Generate report
 */
function generateReport() {
  const report = [];
  
  report.push('# Missing user_id/created_by/updated_by Audit Report\n');
  report.push(`Generated: ${new Date().toISOString()}\n`);
  report.push(`Total APIs requiring user_id: ${findings.apis_requiring_userid.length}`);
  report.push(`Total frontend API calls found: ${findings.frontend_calls.length}`);
  report.push(`Missing user_id cases: ${findings.missing_userid.length}\n`);
  report.push('---\n');
  
  // Group by severity and route
  const highPriority = findings.missing_userid.filter(f => f.severity === 'high');
  const byRoute = {};
  
  for (const finding of highPriority) {
    const route = finding.api.route;
    if (!byRoute[route]) {
      byRoute[route] = [];
    }
    byRoute[route].push(finding);
  }
  
  report.push('## 🔴 HIGH PRIORITY - Missing user_id (Breaking Issues)\n');
  
  for (const [route, routeFindings] of Object.entries(byRoute)) {
    report.push(`### ${route}\n`);
    
    for (const finding of routeFindings) {
      report.push(`**API Endpoint:** \`${finding.api.method} ${finding.api.route}\``);
      report.push(`**Expected Field:** ${finding.api.expectedField}`);
      report.push(`**API File:** \`${finding.api.file}\``);
      report.push(`**Frontend File:** \`${finding.frontend.file}\` (Line ${finding.frontend.lineNumber})`);
      report.push(`**Frontend Method:** ${finding.frontend.method}`);
      report.push(`**Current Status:** ❌ Missing ${finding.api.expectedField}\n`);
      
      if (finding.frontend.bodyContent) {
        report.push(`**Current Body:**`);
        report.push(`\`\`\`typescript`);
        report.push(finding.frontend.bodyContent.substring(0, 300));
        report.push(`\`\`\`\n`);
      }
      
      report.push(`**Fix Required:**`);
      if (finding.api.expectedField.includes('created_by')) {
        report.push(`Add \`created_by: user?.id\` to the request body.`);
      } else if (finding.api.expectedField.includes('updated_by')) {
        report.push(`Add \`updated_by: user?.id\` or \`updated_by_user_id: user?.id\` to the request body.`);
      } else {
        report.push(`Add \`user_id\` parameter (${finding.api.expectedField.includes('query') ? 'as query param' : 'to body'}).`);
      }
      report.push('');
    }
  }
  
  // Summary by file
  report.push('## 📊 Summary by Frontend File\n');
  const byFile = {};
  for (const finding of highPriority) {
    const file = finding.frontend.file;
    if (!byFile[file]) {
      byFile[file] = [];
    }
    byFile[file].push(finding);
  }
  
  for (const [file, fileFindings] of Object.entries(byFile)) {
    report.push(`### ${file}`);
    report.push(`**Missing Cases:** ${fileFindings.length}`);
    for (const finding of fileFindings) {
      report.push(`- ${finding.api.method} ${finding.api.route} - Missing ${finding.api.expectedField}`);
    }
    report.push('');
  }
  
  // Quick fix checklist
  report.push('## ✅ Quick Fix Checklist\n');
  report.push('For each missing case above, add the required field:\n');
  report.push('```typescript');
  report.push('// For POST requests:');
  report.push('body: JSON.stringify({');
  report.push('  ...formData,');
  report.push('  business_id: business.id,');
  report.push('  created_by: user?.id,  // ✅ Add this');
  report.push('  // ... other fields');
  report.push('})');
  report.push('');
  report.push('// For PATCH/PUT requests:');
  report.push('body: JSON.stringify({');
  report.push('  ...formData,');
  report.push('  updated_by: user?.id,  // ✅ Add this');
  report.push('  // ... other fields');
  report.push('})');
  report.push('');
  report.push('// For GET requests:');
  report.push('const params = new URLSearchParams();');
  report.push('params.append(\'business_id\', business.id);');
  report.push('params.append(\'user_id\', user.id);  // ✅ Add this');
  report.push('```\n');
  
  return report.join('\n');
}

/**
 * Main execution
 */
console.log('🔍 Scanning API routes...');
scanAPIRoutes(API_DIR);
console.log(`   Found ${findings.apis_requiring_userid.length} APIs requiring user_id`);

console.log('🔍 Scanning frontend files...');
scanFrontendFiles(FRONTEND_DIR);
scanFrontendFiles(COMPONENTS_DIR);
console.log(`   Found ${findings.frontend_calls.length} frontend API calls`);

console.log('🔍 Matching calls with requirements...');
matchCallsWithRequirements();
console.log(`   Found ${findings.missing_userid.length} missing user_id cases`);

console.log('📝 Generating report...');
const report = generateReport();

// Write report
const reportPath = path.join(__dirname, '..', 'MISSING_USERID_AUDIT_REPORT.md');
fs.writeFileSync(reportPath, report, 'utf-8');

console.log(`\n✅ Report generated: ${reportPath}`);
console.log(`\n📊 Summary:`);
console.log(`   - APIs requiring user_id: ${findings.apis_requiring_userid.length}`);
console.log(`   - Frontend API calls: ${findings.frontend_calls.length}`);
console.log(`   - Missing user_id cases: ${findings.missing_userid.length}`);

if (findings.missing_userid.length > 0) {
  console.log(`\n⚠️  ${findings.missing_userid.length} critical issues found!`);
  console.log(`   Review ${reportPath} for details.`);
}
