const fs = require('fs');
const path = require('path');

// Files to scan
const filesToCheck = [
  'app/(app)/estimates/page.tsx',
  'app/(app)/reports/page.tsx',
  'app/(app)/expenses/page.tsx',
  'app/(app)/purchases/page.tsx',
  'app/(app)/customers/page.tsx',
  'app/(app)/suppliers/page.tsx',
  'app/(app)/items/page.tsx',
  'app/(app)/sales-orders/page.tsx',
  'app/(app)/purchase-orders/page.tsx',
  'app/(app)/employees/page.tsx',
  'app/(app)/stock-transfers/page.tsx',
  'app/(app)/credit-notes/page.tsx',
  'app/(app)/debit-notes/page.tsx',
  'app/(app)/purchase-returns/page.tsx',
  'app/(app)/inventory-adjustments/page.tsx',
  'app/(app)/payments/in/page.tsx',
  'app/(app)/payments/out/page.tsx',
];

const issues = [];

filesToCheck.forEach(file => {
  const filePath = path.join(process.cwd(), file);
  
  if (!fs.existsSync(filePath)) {
    console.log(`⚠️  File not found: ${file}`);
    return;
  }
  
  const content = fs.readFileSync(filePath, 'utf-8');
  
  // Check for fetch calls to /api/ endpoints
  const fetchPattern = /fetch\([`'"]\/api\/([^`'"]+)[`'"]\)/g;
  const fetchWithParamsPattern = /fetch\([`']\/api\/[^`']+\$\{[^}]+\}[`']\)/g;
  const buildApiUrlPattern = /buildApiUrl\([^)]+\)/g;
  
  // Look for URLSearchParams without user_id
  const urlSearchParamsBlocks = content.split('new URLSearchParams()');
  
  if (urlSearchParamsBlocks.length > 1) {
    urlSearchParamsBlocks.slice(1).forEach((block, idx) => {
      // Get next 500 characters after URLSearchParams
      const snippet = block.substring(0, 500);
      
      // Check if user_id is appended
      if (!snippet.includes('user_id') && !snippet.includes('buildApiUrl')) {
        // Find the line number
        const beforeText = content.substring(0, content.indexOf(block));
        const lineNumber = (beforeText.match(/\n/g) || []).length + 1;
        
        issues.push({
          file,
          lineNumber,
          issue: 'URLSearchParams without user_id',
          snippet: snippet.substring(0, 150).replace(/\n/g, ' ')
        });
      }
    });
  }
});

console.log('\n📊 Analysis Complete\n');
console.log(`Total files checked: ${filesToCheck.length}`);
console.log(`Issues found: ${issues.length}\n`);

if (issues.length > 0) {
  console.log('⚠️  Files missing user_id:\n');
  issues.forEach(issue => {
    console.log(`  ${issue.file}:${issue.lineNumber}`);
    console.log(`    Issue: ${issue.issue}`);
    console.log(`    Snippet: ${issue.snippet}...`);
    console.log('');
  });
}
