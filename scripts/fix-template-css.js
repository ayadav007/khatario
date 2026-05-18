const fs = require('fs');
const path = require('path');
const glob = require('glob');

console.log('🔧 Fixing CSS syntax in template files...\n');

// Find all template.html files
const templateFiles = glob.sync('templates/**/template.html', { cwd: process.cwd() });

let fixedCount = 0;
let errorCount = 0;

templateFiles.forEach((filePath) => {
  try {
    const fullPath = path.join(process.cwd(), filePath);
    let content = fs.readFileSync(fullPath, 'utf-8');
    let modified = false;

    // Fix: Remove quotes around Handlebars variables in font-family
    const fontFamilyPattern = /font-family:\s*'{{settings\.font_family}}'/g;
    if (fontFamilyPattern.test(content)) {
      content = content.replace(fontFamilyPattern, 'font-family: {{settings.font_family}}');
      modified = true;
    }

    // Fix: Remove quotes around other Handlebars variables in CSS
    const quotedHandlebarsPattern = /(['"])({{[^}]+}})\1/g;
    const beforeFix = content;
    content = content.replace(quotedHandlebarsPattern, (match, quote, handlebars) => {
      // Only fix if it's in a CSS context (not in HTML attributes)
      if (match.includes('{{settings.')) {
        modified = true;
        return handlebars;
      }
      return match;
    });

    if (modified) {
      fs.writeFileSync(fullPath, content, 'utf-8');
      console.log(`✅ Fixed: ${filePath}`);
      fixedCount++;
    }
  } catch (error) {
    console.error(`❌ Error processing ${filePath}:`, error.message);
    errorCount++;
  }
});

console.log(`\n📊 Summary:`);
console.log(`   Fixed: ${fixedCount} files`);
console.log(`   Errors: ${errorCount} files`);
console.log(`   Total: ${templateFiles.length} templates`);

if (fixedCount > 0) {
  console.log('\n✨ CSS syntax fixed! Please regenerate template previews:');
  console.log('   node scripts/generate-real-previews.js');
}

