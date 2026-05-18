const fs = require('fs');
const path = require('path');

const appDir = path.join(__dirname, '..', 'app', '(app)');

function findTsxFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  
  files.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    
    if (stat.isDirectory()) {
      findTsxFiles(filePath, fileList);
    } else if (file.endsWith('.tsx') || file.endsWith('.ts')) {
      fileList.push(filePath);
    }
  });
  
  return fileList;
}

function removeAppLayout(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  let modified = false;
  
  // Remove AppLayout import
  const importRegex = /import\s+{\s*AppLayout\s*}\s+from\s+['"]@\/components\/layout\/AppLayout['"];?\s*\n/g;
  if (importRegex.test(content)) {
    content = content.replace(importRegex, '');
    modified = true;
  }
  
  // Remove AppLayout wrapper - handle various patterns
  // Pattern 1: <AppLayout>...</AppLayout>
  const wrapperRegex1 = /<AppLayout(\s+[^>]*)?>/g;
  if (wrapperRegex1.test(content)) {
    // Remove opening tag
    content = content.replace(wrapperRegex1, '');
    modified = true;
    
    // Remove closing tag
    content = content.replace(/<\/AppLayout>/g, '');
    modified = true;
  }
  
  // Pattern 2: <AppLayout showDateRange ...>
  const wrapperRegex2 = /<AppLayout\s+showDateRange[^>]*>/g;
  if (wrapperRegex2.test(content)) {
    content = content.replace(wrapperRegex2, '');
    modified = true;
    content = content.replace(/<\/AppLayout>/g, '');
    modified = true;
  }
  
  // Pattern 3: <AppLayout onDateRangeChange={...}>
  const wrapperRegex3 = /<AppLayout\s+onDateRangeChange=\{[\s\S]*?\}>/g;
  if (wrapperRegex3.test(content)) {
    content = content.replace(wrapperRegex3, '');
    modified = true;
    content = content.replace(/<\/AppLayout>/g, '');
    modified = true;
  }
  
  // Clean up extra blank lines (more than 2 consecutive)
  content = content.replace(/\n{3,}/g, '\n\n');
  
  if (modified) {
    fs.writeFileSync(filePath, content, 'utf8');
    return true;
  }
  
  return false;
}

// Find all TSX files
const files = findTsxFiles(appDir);
console.log(`Found ${files.length} files to check...\n`);

let modifiedCount = 0;
const modifiedFiles = [];

files.forEach(file => {
  const relativePath = path.relative(path.join(__dirname, '..'), file);
  
  // Check if file contains AppLayout
  const content = fs.readFileSync(file, 'utf8');
  if (content.includes('AppLayout')) {
    if (removeAppLayout(file)) {
      modifiedCount++;
      modifiedFiles.push(relativePath);
      console.log(`✓ Removed AppLayout from: ${relativePath}`);
    } else {
      console.log(`⚠ Found AppLayout but couldn't remove (manual check needed): ${relativePath}`);
    }
  }
});

console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`✅ Migration Complete!`);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`Modified ${modifiedCount} files`);
console.log(`\nModified files:`);
modifiedFiles.forEach(f => console.log(`  - ${f}`));
