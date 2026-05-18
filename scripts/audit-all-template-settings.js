/**
 * Comprehensive Audit Script for All 157 Template Settings
 * 
 * This script checks:
 * 1. All settings defined in TemplateSettings interface
 * 2. How settings flow from customization → preview → PDF
 * 3. If settings are properly applied in templates
 * 4. If colors are being used correctly
 * 5. If bank details are being fetched and applied
 */

const fs = require('fs');
const path = require('path');

// Read TemplateSettings interface
const typesPath = path.join(__dirname, '../types/template.ts');
const typesContent = fs.readFileSync(typesPath, 'utf-8');

// Extract all settings from TemplateSettings interface
const settingsRegex = /(\w+)(\?)?:\s*(boolean|string|number|'[^']+'|"[^"]+");/g;
const allSettings = [];
let match;

// Count all settings
const booleanSettings = [];
const stringSettings = [];
const numberSettings = [];
const optionalSettings = [];

while ((match = settingsRegex.exec(typesContent)) !== null) {
  const name = match[1];
  const isOptional = match[2] === '?';
  const type = match[3];
  
  if (name === 'template_id') continue; // Skip template_id
  
  allSettings.push({ name, type, isOptional });
  
  if (type === 'boolean') booleanSettings.push(name);
  else if (type === 'string') stringSettings.push(name);
  else if (type === 'number') numberSettings.push(name);
  
  if (isOptional) optionalSettings.push(name);
}

console.log('='.repeat(80));
console.log('COMPREHENSIVE TEMPLATE SETTINGS AUDIT');
console.log('='.repeat(80));
console.log(`\nTotal Settings Found: ${allSettings.length}`);
console.log(`- Boolean settings: ${booleanSettings.length}`);
console.log(`- String settings: ${stringSettings.length}`);
console.log(`- Number settings: ${numberSettings.length}`);
console.log(`- Optional settings: ${optionalSettings.length}`);

// Check template files for usage
const templatesDir = path.join(__dirname, '../templates');
const templateDirs = fs.readdirSync(templatesDir).filter(dir => {
  const dirPath = path.join(templatesDir, dir);
  return fs.statSync(dirPath).isDirectory();
});

console.log('\n' + '='.repeat(80));
console.log('CHECKING TEMPLATE FILES FOR SETTINGS USAGE');
console.log('='.repeat(80));

const templateUsage = {};
const colorUsage = {};
const bankDetailsUsage = {};

templateDirs.forEach(dir => {
  const templatePath = path.join(templatesDir, dir, 'template.html');
  if (!fs.existsSync(templatePath)) return;
  
  const templateContent = fs.readFileSync(templatePath, 'utf-8');
  templateUsage[dir] = {};
  
  // Check each setting
  allSettings.forEach(setting => {
    const name = setting.name;
    
    // Check for ifSetting helper usage
    if (templateContent.includes(`ifSetting '${name}'`) || 
        templateContent.includes(`ifSetting "${name}"`)) {
      templateUsage[dir][name] = 'ifSetting';
    }
    
    // Check for direct settings access
    if (templateContent.includes(`settings.${name}`)) {
      templateUsage[dir][name] = templateUsage[dir][name] || 'direct';
    }
  });
  
  // Check color usage
  if (templateContent.includes('primary_color') || templateContent.includes('--primary')) {
    colorUsage[dir] = colorUsage[dir] || {};
    colorUsage[dir].primary_color = true;
  }
  if (templateContent.includes('text_color') || templateContent.includes('--text-color')) {
    colorUsage[dir] = colorUsage[dir] || {};
    colorUsage[dir].text_color = true;
  }
  if (templateContent.includes('table_header_color') || templateContent.includes('--table-header-color')) {
    colorUsage[dir] = colorUsage[dir] || {};
    colorUsage[dir].table_header_color = true;
  }
  
  // Check bank details usage
  if (templateContent.includes('show_bank_details') || 
      templateContent.includes('show_bank_name') ||
      templateContent.includes('bank_name') ||
      templateContent.includes('account_number') ||
      templateContent.includes('ifsc_code')) {
    bankDetailsUsage[dir] = true;
  }
});

// Generate report
console.log('\n' + '='.repeat(80));
console.log('SETTINGS USAGE BY TEMPLATE');
console.log('='.repeat(80));

Object.keys(templateUsage).forEach(template => {
  const used = Object.keys(templateUsage[template]).length;
  console.log(`\n${template}: ${used}/${allSettings.length} settings used`);
  
  // Show missing critical settings
  const criticalSettings = [
    'primary_color', 'text_color', 'table_header_color',
    'font_family', 'font_size',
    'show_logo', 'show_business_name', 'show_business_address',
    'show_invoice_number', 'show_invoice_date',
    'show_customer_name', 'show_customer_address',
    'show_grand_total'
  ];
  
  const missing = criticalSettings.filter(s => !templateUsage[template][s]);
  if (missing.length > 0) {
    console.log(`  ⚠️  Missing critical settings: ${missing.join(', ')}`);
  }
});

console.log('\n' + '='.repeat(80));
console.log('COLOR SETTINGS USAGE');
console.log('='.repeat(80));

Object.keys(colorUsage).forEach(template => {
  console.log(`\n${template}:`);
  console.log(`  primary_color: ${colorUsage[template].primary_color ? '✅' : '❌'}`);
  console.log(`  text_color: ${colorUsage[template].text_color ? '✅' : '❌'}`);
  console.log(`  table_header_color: ${colorUsage[template].table_header_color ? '✅' : '❌'}`);
});

console.log('\n' + '='.repeat(80));
console.log('BANK DETAILS USAGE');
console.log('='.repeat(80));

Object.keys(bankDetailsUsage).forEach(template => {
  console.log(`${template}: ${bankDetailsUsage[template] ? '✅ Has bank details' : '❌ No bank details'}`);
});

// Check API routes
console.log('\n' + '='.repeat(80));
console.log('CHECKING API ROUTES FOR SETTINGS FLOW');
console.log('='.repeat(80));

const apiRoutes = [
  '../app/api/invoices/preview/route.ts',
  '../app/api/template-preview/route.ts',
  '../lib/pdf-generator.ts',
  '../lib/invoice-presenter.ts'
];

apiRoutes.forEach(route => {
  const routePath = path.join(__dirname, route);
  if (fs.existsSync(routePath)) {
    const content = fs.readFileSync(routePath, 'utf-8');
    const hasSettings = content.includes('settings') || content.includes('TemplateSettings');
    const hasPrepareInvoice = content.includes('prepareInvoiceForRendering');
    const hasBankDetails = content.includes('bank') || content.includes('account_number');
    
    console.log(`\n${route}:`);
    console.log(`  Settings handling: ${hasSettings ? '✅' : '❌'}`);
    console.log(`  Uses prepareInvoiceForRendering: ${hasPrepareInvoice ? '✅' : '❌'}`);
    console.log(`  Bank details handling: ${hasBankDetails ? '✅' : '❌'}`);
  }
});

// Summary
console.log('\n' + '='.repeat(80));
console.log('SUMMARY & RECOMMENDATIONS');
console.log('='.repeat(80));

console.log(`
1. Total Settings: ${allSettings.length}
2. Templates Checked: ${Object.keys(templateUsage).length}
3. Templates with Color Support: ${Object.keys(colorUsage).length}
4. Templates with Bank Details: ${Object.keys(bankDetailsUsage).length}

CRITICAL CHECKS NEEDED:
- Verify settings are passed from customization → preview API → renderer
- Verify colors are applied in CSS variables or inline styles
- Verify bank details are fetched from database and merged into business object
- Verify all show_* settings are checked with ifSetting helper
- Verify appearance settings (font, margins, etc.) are applied
`);

// Export results
const results = {
  totalSettings: allSettings.length,
  settings: allSettings,
  templateUsage,
  colorUsage,
  bankDetailsUsage,
  timestamp: new Date().toISOString()
};

fs.writeFileSync(
  path.join(__dirname, '../docs/template-settings-audit-results.json'),
  JSON.stringify(results, null, 2)
);

console.log('\n✅ Audit complete! Results saved to docs/template-settings-audit-results.json');

