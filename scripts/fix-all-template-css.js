const fs = require('fs');
const path = require('path');
const glob = require('glob');

console.log('🔧 Fixing CSS syntax in ALL template files...\n');

const templateFiles = glob.sync('templates/**/template.html', { cwd: process.cwd() });

let fixedCount = 0;
let errorCount = 0;

templateFiles.forEach((filePath) => {
  try {
    const fullPath = path.join(process.cwd(), filePath);
    let content = fs.readFileSync(fullPath, 'utf-8');
    let modified = false;

    // Check if already has :root block
    const hasRoot = content.includes(':root {');
    
    if (!hasRoot && (content.includes('{{settings.') || content.includes("{{settings."))) {
      // Find all unique settings used
      const settingsMatches = content.matchAll(/{{settings\.(\w+)}}/g);
      const settingsUsed = new Set();
      for (const match of settingsMatches) {
        settingsUsed.add(match[1]);
      }

      if (settingsUsed.size > 0) {
        // Create :root block
        let rootBlock = '    :root {\n';
        if (settingsUsed.has('primary_color')) {
          rootBlock += '      --primary-color: {{settings.primary_color}};\n';
        }
        if (settingsUsed.has('text_color')) {
          rootBlock += '      --text-color: {{settings.text_color}};\n';
        }
        if (settingsUsed.has('table_header_color')) {
          rootBlock += '      --table-header-color: {{settings.table_header_color}};\n';
        }
        if (settingsUsed.has('font_family')) {
          rootBlock += '      --font-family: {{settings.font_family}};\n';
        }
        if (settingsUsed.has('font_size')) {
          rootBlock += '      --font-size: {{settings.font_size}}px;\n';
        }
        if (settingsUsed.has('margin_top')) {
          rootBlock += '      --margin-top: {{settings.margin_top}}px;\n';
        }
        if (settingsUsed.has('margin_right')) {
          rootBlock += '      --margin-right: {{settings.margin_right}}px;\n';
        }
        if (settingsUsed.has('margin_bottom')) {
          rootBlock += '      --margin-bottom: {{settings.margin_bottom}}px;\n';
        }
        if (settingsUsed.has('margin_left')) {
          rootBlock += '      --margin-left: {{settings.margin_left}}px;\n';
        }
        rootBlock += '    }\n';

        // Insert :root block after <style>
        content = content.replace(/<style>/, `<style>\n${rootBlock}`);

        // Replace Handlebars variables with CSS variables
        content = content.replace(/{{settings\.primary_color}}/g, 'var(--primary-color)');
        content = content.replace(/{{settings\.text_color}}/g, 'var(--text-color)');
        content = content.replace(/{{settings\.table_header_color}}/g, 'var(--table-header-color)');
        content = content.replace(/{{settings\.font_family}}/g, 'var(--font-family)');
        content = content.replace(/{{settings\.font_size}}px/g, 'var(--font-size)');
        content = content.replace(/{{settings\.margin_top}}px/g, 'var(--margin-top)');
        content = content.replace(/{{settings\.margin_right}}px/g, 'var(--margin-right)');
        content = content.replace(/{{settings\.margin_bottom}}px/g, 'var(--margin-bottom)');
        content = content.replace(/{{settings\.margin_left}}px/g, 'var(--margin-left)');

        modified = true;
      }
    }

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
  console.log('\n✨ CSS syntax fixed!');
}

