const fs = require('fs');
const path = require('path');

// List of all show_* fields that should appear in item tables
const itemTableFields = [
  'show_serial_number',
  'show_item_name',
  'show_item_image', // Special: appears inside item_name cell
  'show_hsn',
  'show_unit',
  'show_quantity',
  'show_rate',
  'show_discount_percent',
  'show_discount_amount',
  'show_tax_rate',
  'show_tax_amount',
  'show_line_total',
  'show_batch_number', // Special: appears inside item_name cell
  'show_expiry_date', // Special: appears inside item_name cell
];

const templatesToCheck = [
  'templates/gst_standard/template.html',
  'templates/modern/template.html',
  'templates/classic/template.html',
  'templates/elegant/template.html',
  'templates/minimal/template.html',
];

console.log('Auditing templates for header/data cell mismatches...\n');

templatesToCheck.forEach(templatePath => {
  const fullPath = path.join(process.cwd(), templatePath);
  if (!fs.existsSync(fullPath)) {
    console.log(`❌ ${templatePath} - FILE NOT FOUND`);
    return;
  }
  
  const content = fs.readFileSync(fullPath, 'utf-8');
  
  // Extract table headers
  const headerMatches = content.match(/<thead>[\s\S]*?<\/thead>/);
  if (!headerMatches) {
    console.log(`⚠️  ${templatePath} - NO TABLE HEADER FOUND`);
    return;
  }
  
  const headerContent = headerMatches[0];
  const dataContent = content; // Check entire file for data cells
  
  // Check each field
  const issues = [];
  
  itemTableFields.forEach(field => {
    // Skip special fields that appear inside item_name
    if (['show_item_image', 'show_batch_number', 'show_expiry_date'].includes(field)) {
      return;
    }
    
    const headerRegex = new RegExp(`ifSetting\\s*['"]${field}['"][\\s\\S]*?<th`, 'g');
    const dataRegex = new RegExp(`ifSetting\\s*['"]${field}['"][\\s\\S]*?<td`, 'g');
    
    const hasHeader = headerRegex.test(headerContent);
    const hasData = dataRegex.test(dataContent);
    
    if (hasHeader && !hasData) {
      issues.push(`  ❌ ${field}: Header exists but NO data cell`);
    } else if (!hasHeader && hasData) {
      issues.push(`  ❌ ${field}: Data cell exists but NO header`);
    } else if (!hasHeader && !hasData) {
      // Field not implemented - this is OK
    }
  });
  
  if (issues.length > 0) {
    console.log(`\n📄 ${templatePath}:`);
    issues.forEach(issue => console.log(issue));
  } else {
    console.log(`✅ ${templatePath} - All headers and data cells match`);
  }
});

console.log('\n✅ Audit complete!');

