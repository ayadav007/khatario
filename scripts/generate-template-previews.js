/**
 * Template Preview Generator
 * 
 * This script generates actual invoice preview images for all templates
 * by rendering them with realistic sample data and taking screenshots.
 * 
 * Prerequisites:
 * - npm install puppeteer
 * 
 * Usage:
 * - node scripts/generate-template-previews.js
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

// Sample invoice data
const getSampleInvoiceData = (templateId) => {
  return {
    business: {
      name: "Digitable",
      address: "Plot No. 123, MIDC Industrial Area\nAndheri East, Mumbai - 400093\nMaharashtra, India",
      phone: "+91 98765 43210",
      email: "accounts@digitable.com",
      website: "www.digitable.com",
      gstin: "27AABCU9603R1ZM",
      pan: "AABCU9603R",
      cin: "U74900MH2020PTC123456",
      state: "Maharashtra",
      state_code: "27",
      logo_url: null,
      gst_registration_type: templateId.includes('composition') ? 'composition' : 'regular'
    },
    customer: {
      name: "XYZ Enterprises Pvt. Ltd.",
      address: "456 Business Park, Sector 18\nGurugram, Haryana - 122015",
      phone: "+91 97654 32109",
      email: "purchases@xyzenterprises.com",
      gstin: "06ABCDE1234F1Z5",
      state: "Haryana",
      state_code: "06",
      pan: "ABCDE1234F"
    },
    invoice: {
      number: "INV-2026-001",
      date: "02-Jan-2026",
      due_date: "16-Jan-2026",
      po_number: "PO-2025-789",
      place_of_supply: "Haryana",
      reverse_charge: false,
      invoice_type: templateId.includes('bill_of_supply') ? 'Bill of Supply' : 'Tax Invoice',
      currency: "INR",
      exchange_rate: 1.00
    },
    items: [
      {
        sno: 1,
        name: "Premium Hydraulic Oil - Grade 68",
        description: "High performance hydraulic oil for industrial machinery",
        hsn: "27101990",
        unit: "Ltr",
        quantity: 50,
        rate: 450.00,
        discount_percent: 10,
        discount_amount: 2250.00,
        taxable_amount: 20250.00,
        tax_rate: 18,
        cgst_amount: 1822.50,
        sgst_amount: 1822.50,
        igst_amount: 0,
        amount: 23895.00
      },
      {
        sno: 2,
        name: "Industrial Gear Oil - EP 90",
        description: "Extra pressure gear oil for heavy duty applications",
        hsn: "27101990",
        unit: "Ltr",
        quantity: 30,
        rate: 520.00,
        discount_percent: 5,
        discount_amount: 780.00,
        taxable_amount: 14820.00,
        tax_rate: 18,
        cgst_amount: 1333.80,
        sgst_amount: 1333.80,
        igst_amount: 0,
        amount: 17487.60
      },
      {
        sno: 3,
        name: "Engine Coolant - Antifreeze",
        description: "Long life engine coolant for all weather conditions",
        hsn: "38200000",
        unit: "Ltr",
        quantity: 100,
        rate: 180.00,
        discount_percent: 0,
        discount_amount: 0,
        taxable_amount: 18000.00,
        tax_rate: 12,
        cgst_amount: 1080.00,
        sgst_amount: 1080.00,
        igst_amount: 0,
        amount: 20160.00
      },
      {
        sno: 4,
        name: "Multi-Purpose Grease - Lithium Based",
        description: "High quality lithium grease for automotive and industrial use",
        hsn: "27101990",
        unit: "Kg",
        quantity: 25,
        rate: 280.00,
        discount_percent: 15,
        discount_amount: 1050.00,
        taxable_amount: 5950.00,
        tax_rate: 18,
        cgst_amount: 535.50,
        sgst_amount: 535.50,
        igst_amount: 0,
        amount: 7021.00
      }
    ],
    totals: {
      subtotal: 59020.00,
      discount: 4080.00,
      taxable_amount: 59020.00,
      cgst: 4771.80,
      sgst: 4771.80,
      igst: 0,
      cess: 0,
      total_tax: 9543.60,
      round_off: -0.00,
      grand_total: 68563.60,
      amount_in_words: "Sixty Eight Thousand Five Hundred Sixty Three Rupees and Sixty Paise Only",
      paid_amount: 30000.00,
      balance_due: 38563.60
    },
    bank: {
      name: "HDFC Bank",
      account_number: "50200012345678",
      ifsc: "HDFC0001234",
      branch: "Andheri East, Mumbai",
      swift_code: "HDFCINBB"
    },
    transport: {
      vehicle_number: "MH02AB1234",
      transporter_name: "Express Logistics Pvt. Ltd.",
      e_way_bill_number: "121234567890",
      place_of_delivery: "Gurugram, Haryana",
      mode_of_transport: "Road"
    },
    terms: "1. Payment within 14 days from invoice date\n2. Interest @ 18% p.a. will be charged on delayed payments\n3. Goods once sold will not be taken back\n4. Subject to Mumbai jurisdiction only",
    notes: "Thank you for your business! For any queries, please contact our accounts department.",
    signature: true,
    qr_code: true,
    is_igst: false
  };
};

// Template metadata
const templates = {
  tax_invoice: [
    { id: 'gst_standard', path: 'templates/gst_standard' },
    { id: 'modern', path: 'templates/modern' },
    { id: 'classic', path: 'templates/classic' },
    { id: 'elegant', path: 'templates/elegant' },
    { id: 'minimal', path: 'templates/minimal' }
  ],
  bill_of_supply: [
    { id: 'composition_standard', path: 'templates/bill_of_supply/composition_standard' },
    { id: 'composition_modern', path: 'templates/bill_of_supply/composition_modern' },
    { id: 'tax_exempt', path: 'templates/bill_of_supply/tax_exempt' }
  ],
  credit_note: [
    { id: 'credit_standard', path: 'templates/credit_note/standard' }
  ],
  debit_note: [
    { id: 'debit_standard', path: 'templates/debit_note/standard' }
  ],
  delivery_challan: [
    { id: 'challan_standard', path: 'templates/delivery_challan/standard' }
  ]
};

// Ensure output directory exists
const ensureDir = (dirPath) => {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    console.log(`✅ Created directory: ${dirPath}`);
  }
};

// Generate preview for a single template
const generatePreview = async (page, template, outputPath) => {
  try {
    const templatePath = path.join(__dirname, '..', template.path, 'template.html');
    
    if (!fs.existsSync(templatePath)) {
      console.log(`⚠️  Template not found: ${templatePath}`);
      return false;
    }

    // Read template HTML
    let templateHtml = fs.readFileSync(templatePath, 'utf-8');
    
    // Get sample data
    const data = getSampleInvoiceData(template.id);
    
    // Simple Handlebars-like replacements (basic version)
    // In production, this should use actual Handlebars rendering
    templateHtml = templateHtml
      .replace(/\{\{business\.name\}\}/g, data.business.name)
      .replace(/\{\{business\.address\}\}/g, data.business.address.replace(/\n/g, '<br>'))
      .replace(/\{\{business\.phone\}\}/g, data.business.phone)
      .replace(/\{\{business\.email\}\}/g, data.business.email)
      .replace(/\{\{business\.gstin\}\}/g, data.business.gstin)
      .replace(/\{\{customer\.name\}\}/g, data.customer.name)
      .replace(/\{\{customer\.address\}\}/g, data.customer.address.replace(/\n/g, '<br>'))
      .replace(/\{\{customer\.gstin\}\}/g, data.customer.gstin)
      .replace(/\{\{invoice\.number\}\}/g, data.invoice.number)
      .replace(/\{\{invoice\.date\}\}/g, data.invoice.date)
      .replace(/\{\{invoice\.invoice_type\}\}/g, data.invoice.invoice_type)
      .replace(/\{\{totals\.grand_total\}\}/g, data.totals.grand_total.toFixed(2))
      .replace(/\{\{totals\.amount_in_words\}\}/g, data.totals.amount_in_words);

    // Set content and wait for rendering
    await page.setContent(templateHtml, { waitUntil: 'networkidle0' });
    
    // Take screenshot
    await page.screenshot({
      path: outputPath,
      fullPage: true,
      type: 'png'
    });
    
    console.log(`✅ Generated preview: ${path.basename(outputPath)}`);
    return true;
  } catch (error) {
    console.error(`❌ Error generating preview for ${template.id}:`, error.message);
    return false;
  }
};

// Main function
const generateAllPreviews = async () => {
  console.log('🚀 Starting template preview generation...\n');
  
  // Ensure output directory exists
  const outputDir = path.join(__dirname, '..', 'public', 'templates', 'previews');
  ensureDir(outputDir);
  
  // Launch browser
  console.log('🌐 Launching headless browser...');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const page = await browser.newPage();
  
  // Set viewport to A4 size (595x842 points = 794x1123 pixels at 96 DPI)
  await page.setViewport({
    width: 794,
    height: 1123,
    deviceScaleFactor: 2
  });
  
  let successCount = 0;
  let totalCount = 0;
  
  // Generate previews for all templates
  for (const [docType, templateList] of Object.entries(templates)) {
    console.log(`\n📄 Processing ${docType}...`);
    
    for (const template of templateList) {
      totalCount++;
      const outputPath = path.join(outputDir, `${template.id}.png`);
      const success = await generatePreview(page, template, outputPath);
      if (success) successCount++;
    }
  }
  
  await browser.close();
  
  console.log(`\n✨ Preview generation complete!`);
  console.log(`📊 Success: ${successCount}/${totalCount} templates`);
  console.log(`📁 Output directory: ${outputDir}`);
  
  if (successCount < totalCount) {
    console.log(`\n⚠️  Some templates failed to generate. Please check the errors above.`);
  }
};

// Run the script
generateAllPreviews().catch(console.error);

