/**
 * Manual Audit Script: Missing user_id in Frontend API Calls
 * 
 * More thorough checking by examining actual API calls and their parameters
 */

const fs = require('fs');
const path = require('path');

const API_DIR = path.join(__dirname, '..', 'app', 'api');
const FRONTEND_DIR = path.join(__dirname, '..', 'app');

const issues = [];

/**
 * Normalize API endpoint path
 */
function normalizeEndpoint(filePath) {
  // Convert app/api/invoices/route.ts -> /api/invoices
  // Convert app/api/purchases/[id]/route.ts -> /api/purchases/[id]
  const relativePath = path.relative(path.join(__dirname, '..', 'app', 'api'), filePath);
  const endpoint = '/' + relativePath.replace(/\\/g, '/').replace(/\/route\.ts?$/, '');
  return endpoint.replace(/\[id\]/g, '[id]').replace(/\[filingId\]/g, '[filingId]');
}

/**
 * Extract API endpoint from fetch URL
 */
function extractEndpoint(url) {
  // Remove protocol, domain, query params, etc.
  let endpoint = url.replace(/^.*?\/api/, '/api').split('?')[0];
  // Normalize dynamic segments
  endpoint = endpoint.replace(/\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gi, '/[id]');
  return endpoint;
}

/**
 * Check if a fetch call includes user_id
 */
function checkFetchCallHasUserId(fileContent, fetchCallStart, fetchCallEnd) {
  // Get context around the fetch call
  const contextBefore = fileContent.substring(Math.max(0, fetchCallStart - 500), fetchCallStart);
  const contextAfter = fileContent.substring(fetchCallEnd, Math.min(fileContent.length, fetchCallEnd + 200));
  const fullContext = contextBefore + contextAfter;
  
  // Check various patterns
  const patterns = [
    /user_id.*user\.id|user_id.*user\?\.id|params\.append\(['"]user_id|params\.append\(["']user_id|'user_id':\s*user|"user_id":\s*user|user_id:\s*user/,
    /user_id.*=.*user|userId.*=.*user|user_id.*user\.id|userId.*user\.id/,
  ];
  
  return patterns.some(pattern => pattern.test(fullContext));
}

/**
 * Scan APIs
 */
const apisRequiringUserId = new Map();

function scanAPIs(dir) {
  const files = fs.readdirSync(dir, { withFileTypes: true });
  
  for (const file of files) {
    const fullPath = path.join(dir, file.name);
    
    if (file.isDirectory()) {
      scanAPIs(fullPath);
    } else if (file.name === 'route.ts' || file.name === 'route.js') {
      const content = fs.readFileSync(fullPath, 'utf-8');
      
      // Check if requires user_id for authorization
      const requiresUserId = 
        (content.includes('user_id is required') || 
         content.includes('userId is required') ||
         content.includes('REQUIRED for authorization')) &&
        (content.includes('authorize(') || content.includes('searchParams.get(\'user_id\')') || content.includes('searchParams.get("user_id")'));
      
      if (requiresUserId) {
        const endpoint = normalizeEndpoint(fullPath);
        
        // Extract methods
        const methods = [];
        if (content.includes('export async function GET')) methods.push('GET');
        if (content.includes('export async function POST')) methods.push('POST');
        if (content.includes('export async function PATCH')) methods.push('PATCH');
        if (content.includes('export async function PUT')) methods.push('PUT');
        if (content.includes('export async function DELETE')) methods.push('DELETE');
        
        methods.forEach(method => {
          const key = `${method} ${endpoint}`;
          if (!apisRequiringUserId.has(key)) {
            apisRequiringUserId.set(key, {
              file: path.relative(path.join(__dirname, '..'), fullPath),
              method,
              endpoint
            });
          }
        });
      }
    }
  }
}

/**
 * Scan frontend for API calls
 */
const frontendCalls = new Map();

function scanFrontend(dir, basePath = '') {
  if (!fs.existsSync(dir)) return;
  
  const files = fs.readdirSync(dir, { withFileTypes: true });
  
  for (const file of files) {
    if (file.name.startsWith('.') || file.name === 'node_modules' || file.name === '.next') {
      continue;
    }
    
    const fullPath = path.join(dir, file.name);
    const relativePath = path.join(basePath, file.name);
    
    if (file.isDirectory()) {
      scanFrontend(fullPath, relativePath);
    } else if (file.name.endsWith('.tsx') || file.name.endsWith('.ts')) {
      try {
        const content = fs.readFileSync(fullPath, 'utf-8');
        
        // Find all fetch calls
        const fetchRegex = /fetch\s*\(\s*[`'"]([^`'"]*\/api\/[^`'"]+)[`'"]/gi;
        let match;
        
        while ((match = fetchRegex.exec(content)) !== null) {
          const url = match[1];
          const endpoint = extractEndpoint(url);
          const matchStart = match.index;
          const matchEnd = match.index + match[0].length;
          
          // Check if this fetch call has user_id
          const hasUserId = checkFetchCallHasUserId(content, matchStart, matchEnd);
          
          // Also check if URLSearchParams is used and user_id is appended
          const urlParamsContext = content.substring(Math.max(0, matchStart - 1000), matchStart);
          const hasUrlParamsUserId = /params\.append\(['"]user_id|params\.append\(["']user_id|URLSearchParams.*user_id/.test(urlParamsContext);
          
          const finalHasUserId = hasUserId || hasUrlParamsUserId || url.includes('user_id') || url.includes('userId');
          
          const key = `GET ${endpoint}`; // Default to GET, could be improved
          
          if (!frontendCalls.has(key)) {
            frontendCalls.set(key, []);
          }
          
          frontendCalls.get(key).push({
            file: relativePath,
            hasUserId: finalHasUserId,
            line: content.substring(0, matchStart).split('\n').length,
            url: url.substring(0, 100) // First 100 chars
          });
        }
      } catch (err) {
        // Skip
      }
    }
  }
}

// Run scan
console.log('🔍 Scanning APIs...');
scanAPIs(API_DIR);
console.log(`Found ${apisRequiringUserId.size} API endpoints requiring user_id`);

console.log('🔍 Scanning frontend...');
scanFrontend(FRONTEND_DIR);
console.log(`Found ${frontendCalls.size} unique API endpoints called from frontend`);

// Compare
console.log('🔍 Comparing...\n');

apisRequiringUserId.forEach((apiInfo, apiKey) => {
  // Try different method combinations
  const possibleKeys = [
    apiKey,
    apiKey.replace(/^GET /, ''),
    apiKey.replace(/^POST /, ''),
    apiKey.replace(/^PATCH /, ''),
    apiKey.replace(/^PUT /, ''),
    apiKey.replace(/^DELETE /, ''),
  ];
  
  const calls = [];
  possibleKeys.forEach(key => {
    if (frontendCalls.has(key)) {
      calls.push(...frontendCalls.get(key));
    }
  });
  
  if (calls.length > 0) {
    const missingUserId = calls.filter(c => !c.hasUserId);
    if (missingUserId.length > 0) {
      issues.push({
        ...apiInfo,
        frontendFiles: missingUserId,
        allCalls: calls.length
      });
    }
  }
});

// Report
console.log('='.repeat(80));
console.log('AUDIT RESULTS');
console.log('='.repeat(80));

if (issues.length === 0) {
  console.log('\n✅ No issues found!');
} else {
  console.log(`\n❌ Found ${issues.length} endpoints with missing user_id:\n`);
  
  issues.forEach((issue, i) => {
    console.log(`${i + 1}. ${issue.method} ${issue.endpoint}`);
    console.log(`   API: ${issue.file}`);
    console.log(`   Frontend files missing user_id:`);
    issue.frontendFiles.forEach(f => {
      console.log(`     - ${f.file} (line ~${f.line})`);
    });
    console.log('');
  });
}

// Save report
const report = `# Missing user_id Audit Report (Manual)

Generated: ${new Date().toISOString()}

## Issues Found: ${issues.length}

${issues.length === 0 ? '✅ No issues found!' : issues.map((issue, i) => `
### ${i + 1}. ${issue.method} ${issue.endpoint}

- **API File**: \`${issue.file}\`
- **Frontend Files Missing user_id**:
${issue.frontendFiles.map(f => `  - \`${f.file}\` (line ~${f.line})`).join('\n')}
- **Total Calls**: ${issue.allCalls} (${issue.frontendFiles.length} missing user_id)
`).join('\n')}
`;

fs.writeFileSync(path.join(__dirname, '..', 'MISSING_USERID_MANUAL_AUDIT.md'), report);
console.log('\n📄 Report saved to MISSING_USERID_MANUAL_AUDIT.md');

process.exit(issues.length > 0 ? 1 : 0);
