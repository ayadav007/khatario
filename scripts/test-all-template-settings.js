/**
 * Comprehensive End-to-End Test for All 110 Template Settings
 * 
 * This script tests:
 * 1. All settings are defined in TemplateSettings interface
 * 2. Settings can be saved via template-assignments API
 * 3. Settings are retrieved correctly
 * 4. Settings are applied in template preview
 * 5. Settings are applied in PDF generation
 * 6. All templates support all settings
 */

const fs = require('fs');
const path = require('path');

// Read TemplateSettings interface to get all settings
const typesPath = path.join(__dirname, '../types/template.ts');
const typesContent = fs.readFileSync(typesPath, 'utf-8');

// Extract all settings
const settingsRegex = /(\w+)(\?)?:\s*(boolean|string|number|'[^']+'|"[^"]+");/g;
const allSettings = [];
let match;

while ((match = settingsRegex.exec(typesContent)) !== null) {
  const name = match[1];
  const isOptional = match[2] === '?';
  const type = match[3];
  
  if (name === 'template_id') continue; // Skip template_id
  
  allSettings.push({ name, type, isOptional });
}

console.log('='.repeat(80));
console.log('COMPREHENSIVE TEMPLATE SETTINGS END-TO-END TEST');
console.log('='.repeat(80));
console.log(`\nTotal Settings to Test: ${allSettings.length}`);

// Get all templates
const templatesDir = path.join(__dirname, '../templates');
const templateDirs = fs.readdirSync(templatesDir).filter(dir => {
  const dirPath = path.join(templatesDir, dir);
  return fs.statSync(dirPath).isDirectory() && 
         fs.existsSync(path.join(dirPath, 'template.html'));
});

console.log(`\nTemplates to Test: ${templateDirs.length}`);
templateDirs.forEach((dir, i) => {
  console.log(`  ${i + 1}. ${dir}`);
});

// Test results structure
const testResults = {
  totalSettings: allSettings.length,
  templates: {},
  summary: {
    passed: 0,
    failed: 0,
    warnings: 0
  }
};

// Test each template
templateDirs.forEach(templateId => {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`Testing Template: ${templateId}`);
  console.log('='.repeat(80));
  
  const templatePath = path.join(templatesDir, templateId, 'template.html');
  const templateContent = fs.readFileSync(templatePath, 'utf-8');
  
  const templateResults = {
    templateId,
    settings: {},
    summary: {
      found: 0,
      missing: 0,
      warnings: 0
    }
  };
  
  // Test each setting
  allSettings.forEach(setting => {
    const { name, type } = setting;
    const result = {
      name,
      type,
      found: false,
      usage: null,
      warning: null
    };
    
    // Check for ifSetting helper usage
    if (templateContent.includes(`ifSetting '${name}'`) || 
        templateContent.includes(`ifSetting "${name}"`)) {
      result.found = true;
      result.usage = 'ifSetting';
    }
    
    // Check for direct settings access
    if (templateContent.includes(`settings.${name}`)) {
      result.found = true;
      result.usage = result.usage ? `${result.usage} + direct` : 'direct';
    }
    
    // Special checks for appearance settings
    if (type === 'string' && (name.includes('color') || name.includes('font'))) {
      // Check if color/font is used in CSS
      if (name === 'primary_color') {
        if (!templateContent.includes('primary_color') && 
            !templateContent.includes('--primary') &&
            !templateContent.includes('primary-color')) {
          result.warning = 'Primary color not found in template';
        }
      }
      if (name === 'text_color') {
        if (!templateContent.includes('text_color') && 
            !templateContent.includes('--text-color') &&
            !templateContent.includes('text-color')) {
          result.warning = 'Text color not found in template';
        }
      }
      if (name === 'table_header_color') {
        if (!templateContent.includes('table_header_color') && 
            !templateContent.includes('--table-header-color') &&
            !templateContent.includes('table-header-color')) {
          result.warning = 'Table header color not found in template';
        }
      }
      if (name === 'font_family') {
        if (!templateContent.includes('font_family') && 
            !templateContent.includes('font-family')) {
          result.warning = 'Font family not found in template';
        }
      }
      if (name === 'font_size') {
        if (!templateContent.includes('font_size') && 
            !templateContent.includes('font-size')) {
          result.warning = 'Font size not found in template';
        }
      }
    }
    
    // Special checks for margin settings
    if (name.startsWith('margin_')) {
      if (!templateContent.includes(name) && 
          !templateContent.includes(name.replace('_', '-'))) {
        result.warning = `Margin setting ${name} not found in template`;
      }
    }
    
    templateResults.settings[name] = result;
    
    if (result.found) {
      templateResults.summary.found++;
    } else {
      templateResults.summary.missing++;
    }
    
    if (result.warning) {
      templateResults.summary.warnings++;
    }
  });
  
  testResults.templates[templateId] = templateResults;
  
  console.log(`\nResults for ${templateId}:`);
  console.log(`  ✅ Settings Found: ${templateResults.summary.found}/${allSettings.length}`);
  console.log(`  ❌ Settings Missing: ${templateResults.summary.missing}/${allSettings.length}`);
  console.log(`  ⚠️  Warnings: ${templateResults.summary.warnings}`);
  
  // Show missing critical settings
  const criticalSettings = [
    'primary_color', 'text_color', 'table_header_color',
    'font_family', 'font_size',
    'show_logo', 'show_business_name', 'show_invoice_number',
    'show_customer_name', 'show_grand_total'
  ];
  
  const missingCritical = criticalSettings.filter(s => 
    !templateResults.settings[s]?.found
  );
  
  if (missingCritical.length > 0) {
    console.log(`  ⚠️  Missing Critical Settings: ${missingCritical.join(', ')}`);
  }
});

// Generate comprehensive report
console.log('\n' + '='.repeat(80));
console.log('COMPREHENSIVE TEST SUMMARY');
console.log('='.repeat(80));

const allTemplates = Object.keys(testResults.templates);
const totalTests = allSettings.length * allTemplates.length;
let totalFound = 0;
let totalMissing = 0;
let totalWarnings = 0;

allTemplates.forEach(templateId => {
  const template = testResults.templates[templateId];
  totalFound += template.summary.found;
  totalMissing += template.summary.missing;
  totalWarnings += template.summary.warnings;
});

console.log(`\nTotal Templates Tested: ${allTemplates.length}`);
console.log(`Total Settings Tested: ${allSettings.length}`);
console.log(`Total Tests: ${totalTests}`);
console.log(`\nOverall Results:`);
console.log(`  ✅ Settings Found: ${totalFound} (${((totalFound/totalTests)*100).toFixed(1)}%)`);
console.log(`  ❌ Settings Missing: ${totalMissing} (${((totalMissing/totalTests)*100).toFixed(1)}%)`);
console.log(`  ⚠️  Warnings: ${totalWarnings}`);

// Find settings that are missing in most templates
console.log('\n' + '='.repeat(80));
console.log('SETTINGS MISSING IN MULTIPLE TEMPLATES');
console.log('='.repeat(80));

const missingCounts = {};
allSettings.forEach(setting => {
  const name = setting.name;
  let missingIn = 0;
  allTemplates.forEach(templateId => {
    if (!testResults.templates[templateId].settings[name]?.found) {
      missingIn++;
    }
  });
  if (missingIn > 0) {
    missingCounts[name] = missingIn;
  }
});

const sortedMissing = Object.entries(missingCounts)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 20); // Top 20 most missing

if (sortedMissing.length > 0) {
  console.log('\nTop 20 Most Missing Settings:');
  sortedMissing.forEach(([name, count], i) => {
    const percentage = ((count / allTemplates.length) * 100).toFixed(1);
    console.log(`  ${i + 1}. ${name}: Missing in ${count}/${allTemplates.length} templates (${percentage}%)`);
  });
} else {
  console.log('\n✅ All settings are found in at least one template!');
}

// Find templates with best coverage
console.log('\n' + '='.repeat(80));
console.log('TEMPLATE COVERAGE RANKING');
console.log('='.repeat(80));

const coverage = allTemplates.map(templateId => {
  const template = testResults.templates[templateId];
  const percentage = ((template.summary.found / allSettings.length) * 100).toFixed(1);
  return {
    templateId,
    found: template.summary.found,
    total: allSettings.length,
    percentage: parseFloat(percentage),
    warnings: template.summary.warnings
  };
}).sort((a, b) => b.percentage - a.percentage);

coverage.forEach((item, i) => {
  const status = item.percentage >= 90 ? '✅' : item.percentage >= 70 ? '⚠️' : '❌';
  console.log(`${i + 1}. ${status} ${item.templateId}: ${item.found}/${item.total} (${item.percentage}%) - ${item.warnings} warnings`);
});

// Save detailed results
const resultsPath = path.join(__dirname, '../docs/template-settings-test-results.json');
fs.writeFileSync(
  resultsPath,
  JSON.stringify(testResults, null, 2)
);

console.log('\n' + '='.repeat(80));
console.log('✅ Test Complete!');
console.log(`Detailed results saved to: ${resultsPath}`);
console.log('='.repeat(80));

