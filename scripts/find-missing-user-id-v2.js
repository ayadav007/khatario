const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('\n🔍 Searching for API endpoints that require user_id...\n');

// Find all API routes that require user_id
const apiFiles = execSync('grep -r "user_id is required for authorization" app/api --files-with-matches', {
  encoding: 'utf-8',
  cwd: process.cwd()
}).trim().split('\n').filter(Boolean);

console.log(`Found ${apiFiles.length} API endpoints requiring user_id:\n`);

// Extract the API endpoint from the file path
const requiredApis = apiFiles.map(file => {
  // Convert file path to API endpoint
  // e.g., app/api/invoices/route.ts -> /api/invoices
  const apiPath = file
    .replace(/\\/g, '/')
    .replace('app/api/', '/api/')
    .replace('/route.ts', '')
    .replace(/\/\[id\].*/, ''); // Remove dynamic segments
  
  return {
    file,
    endpoint: apiPath
  };
});

requiredApis.forEach(api => {
  console.log(`  ${api.endpoint}`);
});

console.log(`\n\n🔍 Searching for frontend calls to these APIs WITHOUT user_id...\n`);

const issues = [];

// Search for fetch calls to these APIs in frontend code
requiredApis.forEach(api => {
  const endpoint = api.endpoint.replace('/api/', '');
  
  try {
    // Search for fetch calls to this endpoint without user_id
    const searchPattern = `fetch.*${endpoint}.*business_id`;
    const grepCommand = `grep -r "${searchPattern}" "app/(app)" --include="*.tsx" -n`;
    
    try {
      const results = execSync(grepCommand, {
        encoding: 'utf-8',
        cwd: process.cwd()
      }).trim();
      
      if (results) {
        const lines = results.split('\n');
        lines.forEach(line => {
          // Check if this line also includes user_id
          if (!line.includes('user_id')) {
            const [filePath, ...rest] = line.split(':');
            const lineContent = rest.join(':');
            
            issues.push({
              api: api.endpoint,
              file: filePath,
              line: lineContent.trim()
            });
          }
        });
      }
    } catch (e) {
      // No matches found for this API
    }
  } catch (error) {
    // Skip if grep fails
  }
});

if (issues.length > 0) {
  console.log(`❌ Found ${issues.length} potential issues:\n`);
  
  issues.forEach(issue => {
    console.log(`\n  API: ${issue.api}`);
    console.log(`  File: ${issue.file}`);
    console.log(`  Code: ${issue.line.substring(0, 100)}...`);
  });
} else {
  console.log('✅ No obvious issues found! All APIs seem to be called correctly.\n');
}

console.log('\n📝 Note: This is a heuristic search. Please manually verify the results.\n');
