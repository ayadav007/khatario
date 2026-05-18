/**
 * Template Preview Generator - Production Ready
 * 
 * Generates actual screenshots from real template HTML files
 * Uses Puppeteer to render with sample data
 * 
 * Usage:
 * npm install puppeteer
 * node scripts/generate-real-previews.js
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');

// Sample invoice data
const getSampleData = (templateId) => {
  const isComposition = templateId.includes('composition');
  
  return {
    settings: {
      font_family: 'Inter',
      font_size: 12,
      primary_color: '#3949AB',
      table_header_color: '#EEEEEE',
      text_color: '#333333'
    },
    business: {
      name: "Digitable",
      address: "Plot No. 123, MIDC Industrial Area",
      city: "Mumbai",
      state: "Maharashtra",
      state_code: "27",
      pincode: "400093",
      country: "India",
      phone: "+91 98765 43210",
      email: "accounts@digitable.com",
      website: "www.digitable.com",
      gstin: "27AABCU9603R1ZM",
      pan: "AABCU9603R",
      cin: "U74900MH2020PTC123456",
      logo_url: null
    },
    customer: {
      name: "XYZ Enterprises Pvt. Ltd.",
      address: "456 Business Park, Sector 18\nGurugram, Haryana - 122015",
      city: "Gurugram",
      state: "Haryana",
      state_code: "06",
      pincode: "122015",
      phone: "+91 97654 32109",
      email: "purchases@xyzenterprises.com",
      gstin: "06ABCDE1234F1Z5",
      pan: "ABCDE1234F"
    },
    invoice: {
      invoice_number: "INV-2026-001",
      invoice_date: "02-Jan-2026",
      invoice_title: isComposition ? "BILL OF SUPPLY" : "TAX INVOICE",
      invoice_type: isComposition ? "Bill of Supply" : "Tax Invoice",
      due_date: "16-Jan-2026",
      po_number: "PO-2025-789",
      reference_number: "REF-2026-001",
      place_of_supply: "Haryana",
      is_reverse_charge: false,
      subtotal: 59020.00,
      discount_total: 4080.00,
      tax_total: isComposition ? 0 : 9543.60,
      grand_total: isComposition ? 59020.00 : 68563.60,
      paid_amount: 30000.00,
      balance_due: isComposition ? 29020.00 : 38563.60
    },
    items: [
      {
        sn: 1,
        item_name: "Premium Hydraulic Oil - Grade 68",
        description: "High performance hydraulic oil for industrial machinery",
        hsn_code: "27101990",
        unit: "Ltr",
        quantity: 50,
        rate: 450.00,
        discount_percent: 10,
        discount_amount: 2250.00,
        taxable_amount: 20250.00,
        tax_rate: isComposition ? 0 : 18,
        cgst_rate: isComposition ? 0 : 9,
        sgst_rate: isComposition ? 0 : 9,
        cgst_amount: isComposition ? 0 : 1822.50,
        sgst_amount: isComposition ? 0 : 1822.50,
        igst_amount: 0,
        line_total: isComposition ? 20250.00 : 23895.00
      },
      {
        sn: 2,
        item_name: "Industrial Gear Oil - EP 90",
        description: "Extra pressure gear oil for heavy duty applications",
        hsn_code: "27101990",
        unit: "Ltr",
        quantity: 30,
        rate: 520.00,
        discount_percent: 5,
        discount_amount: 780.00,
        taxable_amount: 14820.00,
        tax_rate: isComposition ? 0 : 18,
        cgst_rate: isComposition ? 0 : 9,
        sgst_rate: isComposition ? 0 : 9,
        cgst_amount: isComposition ? 0 : 1333.80,
        sgst_amount: isComposition ? 0 : 1333.80,
        igst_amount: 0,
        line_total: isComposition ? 14820.00 : 17487.60
      },
      {
        sn: 3,
        item_name: "Engine Coolant - Antifreeze",
        description: "Long life engine coolant for all weather conditions",
        hsn_code: "38200000",
        unit: "Ltr",
        quantity: 100,
        rate: 180.00,
        discount_percent: 0,
        discount_amount: 0,
        taxable_amount: 18000.00,
        tax_rate: isComposition ? 0 : 12,
        cgst_rate: isComposition ? 0 : 6,
        sgst_rate: isComposition ? 0 : 6,
        cgst_amount: isComposition ? 0 : 1080.00,
        sgst_amount: isComposition ? 0 : 1080.00,
        igst_amount: 0,
        line_total: isComposition ? 18000.00 : 20160.00
      },
      {
        sn: 4,
        item_name: "Multi-Purpose Grease - Lithium Based",
        description: "High quality lithium grease for automotive and industrial use",
        hsn_code: "27101990",
        unit: "Kg",
        quantity: 25,
        rate: 280.00,
        discount_percent: 15,
        discount_amount: 1050.00,
        taxable_amount: 5950.00,
        tax_rate: isComposition ? 0 : 18,
        cgst_rate: isComposition ? 0 : 9,
        sgst_rate: isComposition ? 0 : 9,
        cgst_amount: isComposition ? 0 : 535.50,
        sgst_amount: isComposition ? 0 : 535.50,
        igst_amount: 0,
        line_total: isComposition ? 5950.00 : 7021.00
      }
    ],
    totals: {
      subtotal: 59020.00,
      discount: 4080.00,
      taxable_amount: 59020.00,
      cgst: isComposition ? 0 : 4771.80,
      sgst: isComposition ? 0 : 4771.80,
      igst: 0,
      cess: 0,
      total_tax: isComposition ? 0 : 9543.60,
      round_off: 0.00,
      grand_total: isComposition ? 59020.00 : 68563.60,
      amount_in_words: isComposition ? "Fifty Nine Thousand Twenty Rupees Only" : "Sixty Eight Thousand Five Hundred Sixty Three Rupees and Sixty Paise Only",
      paid_amount: 30000.00,
      balance_due: isComposition ? 29020.00 : 38563.60
    },
    bank: {
      bank_name: "HDFC Bank",
      account_number: "50200012345678",
      ifsc_code: "HDFC0001234",
      branch_name: "Andheri East, Mumbai",
      swift_code: "HDFCINBB"
    },
    transport: {
      vehicle_number: "MH02AB1234",
      transporter_name: "Express Logistics Pvt. Ltd.",
      e_way_bill_number: "121234567890",
      place_of_delivery: "Gurugram, Haryana"
    },
    terms: "1. Payment within 14 days from invoice date\n2. Interest @ 18% p.a. will be charged on delayed payments\n3. Goods once sold will not be taken back\n4. Subject to Mumbai jurisdiction only",
    notes: "Thank you for your business!",
    is_igst: false
  };
};

// Register Handlebars helpers
Handlebars.registerHelper('ifSetting', function(settingName, options) {
  return options.fn(this);
});

Handlebars.registerHelper('ifEqual', function(arg1, arg2, options) {
  return (arg1 == arg2) ? options.fn(this) : options.inverse(this);
});

Handlebars.registerHelper('or', function() {
  return Array.prototype.slice.call(arguments, 0, -1).some(Boolean);
});

Handlebars.registerHelper('and', function() {
  return Array.prototype.slice.call(arguments, 0, -1).every(Boolean);
});

Handlebars.registerHelper('formatCurrency', function(value) {
  if (!value && value !== 0) return '0.00';
  return parseFloat(value).toFixed(2);
});

Handlebars.registerHelper('formatNumber', function(value) {
  if (!value && value !== 0) return '0';
  return parseFloat(value).toFixed(2);
});

Handlebars.registerHelper('add', function(a, b) {
  return parseFloat(a || 0) + parseFloat(b || 0);
});

Handlebars.registerHelper('sum', function() {
  const args = Array.prototype.slice.call(arguments, 0, -1);
  return args.reduce((sum, val) => sum + parseFloat(val || 0), 0);
});

Handlebars.registerHelper('multiply', function(a, b) {
  return parseFloat(a || 0) * parseFloat(b || 0);
});

Handlebars.registerHelper('subtract', function(a, b) {
  return parseFloat(a || 0) - parseFloat(b || 0);
});

Handlebars.registerHelper('divide', function(a, b) {
  return parseFloat(a || 0) / parseFloat(b || 1);
});

Handlebars.registerHelper('gt', function(a, b) {
  return parseFloat(a || 0) > parseFloat(b || 0);
});

Handlebars.registerHelper('lt', function(a, b) {
  return parseFloat(a || 0) < parseFloat(b || 0);
});

Handlebars.registerHelper('eq', function(a, b) {
  return a == b;
});

Handlebars.registerHelper('ne', function(a, b) {
  return a != b;
});

Handlebars.registerHelper('not', function(value) {
  return !value;
});

Handlebars.registerHelper('json', function(context) {
  return JSON.stringify(context);
});

Handlebars.registerHelper('uppercase', function(str) {
  return str ? str.toString().toUpperCase() : '';
});

Handlebars.registerHelper('lowercase', function(str) {
  return str ? str.toString().toLowerCase() : '';
});

Handlebars.registerHelper('times', function(n, block) {
  var result = '';
  for (var i = 0; i < n; ++i) {
    result += block.fn(i);
  }
  return result;
});

// Templates to generate
const templates = [
  { id: 'gst_standard', path: 'templates/gst_standard/template.html' },
  { id: 'modern', path: 'templates/modern/template.html' },
  { id: 'classic', path: 'templates/classic/template.html' },
  { id: 'elegant', path: 'templates/elegant/template.html' },
  { id: 'minimal', path: 'templates/minimal/template.html' },
  { id: 'business_pro', path: 'templates/business_pro/template.html' },
  { id: 'export_invoice', path: 'templates/export_invoice/template.html' },
  { id: 'composition_standard', path: 'templates/bill_of_supply/composition_standard/template.html' },
  { id: 'composition_modern', path: 'templates/bill_of_supply/composition_modern/template.html' },
  { id: 'tax_exempt', path: 'templates/bill_of_supply/tax_exempt/template.html' },
  { id: 'credit_standard', path: 'templates/credit_note/standard/template.html' },
  { id: 'debit_standard', path: 'templates/debit_note/standard/template.html' },
  { id: 'challan_standard', path: 'templates/delivery_challan/standard/template.html' },
  { id: 'payment_receipt', path: 'templates/payment_receipt/template.html' },
  { id: 'thermal_58mm', path: 'templates/thermal_58mm/template.html' },
  { id: 'thermal_80mm', path: 'templates/thermal_80mm/template.html' },
];

async function generatePreviews() {
  console.log('🚀 Starting template preview generation...\n');
  
  const outputDir = path.join(__dirname, '..', 'public', 'templates', 'previews');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
    console.log(`✅ Created directory: ${outputDir}\n`);
  }
  
  console.log('🌐 Launching browser...');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const page = await browser.newPage();
  await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 2 });
  
  let successCount = 0;
  
  for (const template of templates) {
    try {
      const templatePath = path.join(__dirname, '..', template.path);
      
      if (!fs.existsSync(templatePath)) {
        console.log(`⚠️  Template not found: ${template.id}`);
        continue;
      }

      console.log(`📄 Generating: ${template.id}...`);
      
      // Read template
      const templateHtml = fs.readFileSync(templatePath, 'utf-8');
      
      // Compile with Handlebars
      const compiledTemplate = Handlebars.compile(templateHtml);
      
      // Get data and render
      const data = getSampleData(template.id);
      const renderedHtml = compiledTemplate(data);
      
      // Load in browser with more lenient settings
      await page.setContent(renderedHtml, { 
        waitUntil: 'domcontentloaded',
        timeout: 10000 
      });
      
      // Wait a bit for CSS to apply (using setTimeout wrapped in Promise)
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Take screenshot
      const outputPath = path.join(outputDir, `${template.id}.png`);
      await page.screenshot({
        path: outputPath,
        fullPage: true,
        type: 'png'
      });
      
      console.log(`✅ Generated: ${template.id}.png`);
      successCount++;
      
    } catch (error) {
      console.error(`❌ Error generating ${template.id}:`, error.message);
    }
  }
  
  await browser.close();
  
  console.log(`\n✨ Preview generation complete!`);
  console.log(`📊 Success: ${successCount}/${templates.length} templates`);
  console.log(`📁 Output: ${outputDir}`);
}

// Run
generatePreviews().catch(console.error);

