/**
 * Advanced Template Preview Generator
 * 
 * This script uses the actual invoice presenter and PDF generator
 * to create realistic template previews.
 * 
 * Usage:
 * - npx tsx scripts/generate-previews-advanced.ts
 */

import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Sample invoice data
const getSampleData = () => {
  return {
    business: {
      id: 1,
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
      gst_registration_type: "regular",
      logo_url: null
    },
    customer: {
      id: 1,
      name: "XYZ Enterprises Pvt. Ltd.",
      address: "456 Business Park, Sector 18",
      city: "Gurugram",
      state: "Haryana",
      state_code: "06",
      pincode: "122015",
      country: "India",
      phone: "+91 97654 32109",
      email: "purchases@xyzenterprises.com",
      gstin: "06ABCDE1234F1Z5",
      pan: "ABCDE1234F"
    },
    invoice: {
      id: 1,
      invoice_number: "INV-2026-001",
      invoice_date: "2026-01-02",
      due_date: "2026-01-16",
      po_number: "PO-2025-789",
      reference_number: "REF-2026-001",
      place_of_supply: "Haryana",
      reverse_charge: false,
      document_type: "tax_invoice",
      currency_code: "INR",
      exchange_rate: 1.00,
      subtotal: 59020.00,
      discount_total: 4080.00,
      tax_total: 9543.60,
      grand_total: 68563.60,
      paid_amount: 30000.00,
      balance_due: 38563.60,
      notes: "Thank you for your business!",
      terms: "Payment within 14 days",
      created_at: "2026-01-02T10:00:00Z"
    },
    items: [
      {
        id: 1,
        item_name: "Premium Hydraulic Oil - Grade 68",
        description: "High performance hydraulic oil",
        hsn_code: "27101990",
        unit: "Ltr",
        quantity: 50,
        rate: 450.00,
        discount_percent: 10.00,
        discount_amount: 2250.00,
        taxable_amount: 20250.00,
        tax_rate: 18.00,
        cgst_amount: 1822.50,
        sgst_amount: 1822.50,
        igst_amount: 0.00,
        line_total: 23895.00
      },
      {
        id: 2,
        item_name: "Industrial Gear Oil - EP 90",
        description: "Extra pressure gear oil",
        hsn_code: "27101990",
        unit: "Ltr",
        quantity: 30,
        rate: 520.00,
        discount_percent: 5.00,
        discount_amount: 780.00,
        taxable_amount: 14820.00,
        tax_rate: 18.00,
        cgst_amount: 1333.80,
        sgst_amount: 1333.80,
        igst_amount: 0.00,
        line_total: 17487.60
      },
      {
        id: 3,
        item_name: "Engine Coolant - Antifreeze",
        description: "Long life engine coolant",
        hsn_code: "38200000",
        unit: "Ltr",
        quantity: 100,
        rate: 180.00,
        discount_percent: 0.00,
        discount_amount: 0.00,
        taxable_amount: 18000.00,
        tax_rate: 12.00,
        cgst_amount: 1080.00,
        sgst_amount: 1080.00,
        igst_amount: 0.00,
        line_total: 20160.00
      }
    ],
    bank: {
      bank_name: "HDFC Bank",
      account_number: "50200012345678",
      ifsc_code: "HDFC0001234",
      branch_name: "Andheri East, Mumbai",
      swift_code: "HDFCINBB"
    }
  };
};

async function generatePreviews() {
  console.log('🚀 Generating template previews...\n');
  
  const outputDir = path.join(__dirname, '..', 'public', 'templates', 'previews');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  console.log('📁 Output directory:', outputDir);
  console.log('⏳ This may take a few minutes...\n');
  
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const page = await browser.newPage();
  await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 2 });
  
  // Templates to generate
  const templates = [
    'gst_standard',
    'modern',
    'classic',
    'elegant',
    'minimal',
    'composition_standard',
    'composition_modern',
    'tax_exempt',
    'credit_standard',
    'debit_standard',
    'challan_standard'
  ];
  
  for (const templateId of templates) {
    try {
      // Create a simple HTML preview
      const html = createSimplePreview(templateId);
      
      await page.setContent(html, { waitUntil: 'networkidle0' });
      await page.screenshot({
        path: path.join(outputDir, `${templateId}.png`),
        fullPage: true,
        type: 'png'
      });
      
      console.log(`✅ Generated: ${templateId}.png`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`❌ Failed: ${templateId}`, errorMessage);
    }
  }
  
  await browser.close();
  console.log('\n✨ Preview generation complete!');
}

function createSimplePreview(templateId: string): string {
  const data = getSampleData();
  
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: Arial, sans-serif; padding: 40px; background: white; }
    .invoice { max-width: 210mm; margin: 0 auto; background: white; }
    .header { display: flex; justify-content: space-between; margin-bottom: 30px; border-bottom: 3px solid #2563eb; padding-bottom: 20px; }
    .company { flex: 1; }
    .company h1 { color: #1e40af; font-size: 28px; margin-bottom: 8px; }
    .company p { color: #64748b; font-size: 12px; line-height: 1.6; }
    .invoice-type { text-align: right; }
    .invoice-type h2 { color: #2563eb; font-size: 24px; }
    .invoice-type p { color: #64748b; font-size: 14px; margin-top: 4px; }
    .section { margin: 30px 0; }
    .section-title { font-size: 12px; font-weight: bold; color: #64748b; text-transform: uppercase; margin-bottom: 12px; }
    .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
    .info-box { background: #f8fafc; padding: 15px; border-radius: 8px; border-left: 3px solid #2563eb; }
    .info-box h3 { font-size: 14px; color: #1e293b; margin-bottom: 8px; }
    .info-box p { font-size: 12px; color: #64748b; line-height: 1.5; }
    table { width: 100%; border-collapse: collapse; margin: 20px 0; }
    thead { background: #2563eb; color: white; }
    th { padding: 12px; text-align: left; font-size: 11px; font-weight: 600; text-transform: uppercase; }
    td { padding: 12px; border-bottom: 1px solid #e2e8f0; font-size: 12px; color: #334155; }
    tbody tr:hover { background: #f8fafc; }
    .text-right { text-align: right; }
    .totals { margin-left: auto; width: 350px; }
    .totals-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #e2e8f0; }
    .totals-row.grand { background: #2563eb; color: white; padding: 12px; margin-top: 8px; border-radius: 8px; font-weight: bold; font-size: 16px; }
    .footer { margin-top: 40px; padding-top: 20px; border-top: 2px solid #e2e8f0; }
    .footer-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
    .signature { text-align: right; margin-top: 40px; }
    .signature-line { border-top: 2px solid #1e293b; width: 200px; margin-left: auto; padding-top: 8px; }
  </style>
</head>
<body>
  <div class="invoice">
    <div class="header">
      <div class="company">
        <h1>${data.business.name}</h1>
        <p>${data.business.address}<br>${data.business.city}, ${data.business.state} - ${data.business.pincode}</p>
        <p>GSTIN: ${data.business.gstin} | PAN: ${data.business.pan}</p>
        <p>📧 ${data.business.email} | 📞 ${data.business.phone}</p>
      </div>
      <div class="invoice-type">
        <h2>${templateId.includes('composition') ? 'BILL OF SUPPLY' : 'TAX INVOICE'}</h2>
        <p>${templateId.replace(/_/g, ' ').toUpperCase()}</p>
      </div>
    </div>

    <div class="section">
      <div class="info-grid">
        <div class="info-box">
          <h3>Bill To:</h3>
          <p><strong>${data.customer.name}</strong></p>
          <p>${data.customer.address}<br>${data.customer.city}, ${data.customer.state} - ${data.customer.pincode}</p>
          <p>GSTIN: ${data.customer.gstin}</p>
        </div>
        <div class="info-box">
          <h3>Invoice Details:</h3>
          <p><strong>Invoice #:</strong> ${data.invoice.invoice_number}</p>
          <p><strong>Date:</strong> 02-Jan-2026</p>
          <p><strong>Due Date:</strong> 16-Jan-2026</p>
          <p><strong>PO Number:</strong> ${data.invoice.po_number}</p>
        </div>
      </div>
    </div>

    <div class="section">
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Item Description</th>
            <th>HSN</th>
            <th class="text-right">Qty</th>
            <th class="text-right">Rate</th>
            ${!templateId.includes('composition') ? '<th class="text-right">Tax</th>' : ''}
            <th class="text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          ${data.items.map((item, idx) => `
            <tr>
              <td>${idx + 1}</td>
              <td><strong>${item.item_name}</strong><br><small>${item.description}</small></td>
              <td>${item.hsn_code}</td>
              <td class="text-right">${item.quantity} ${item.unit}</td>
              <td class="text-right">₹${item.rate.toFixed(2)}</td>
              ${!templateId.includes('composition') ? `<td class="text-right">${item.tax_rate}%</td>` : ''}
              <td class="text-right">₹${item.line_total.toFixed(2)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>

    <div class="totals">
      <div class="totals-row">
        <span>Subtotal:</span>
        <span>₹${data.invoice.subtotal.toFixed(2)}</span>
      </div>
      ${!templateId.includes('composition') ? `
        <div class="totals-row">
          <span>CGST (9%):</span>
          <span>₹${(data.invoice.tax_total / 2).toFixed(2)}</span>
        </div>
        <div class="totals-row">
          <span>SGST (9%):</span>
          <span>₹${(data.invoice.tax_total / 2).toFixed(2)}</span>
        </div>
      ` : ''}
      <div class="totals-row grand">
        <span>Grand Total:</span>
        <span>₹${data.invoice.grand_total.toFixed(2)}</span>
      </div>
    </div>

    ${templateId.includes('composition') ? `
      <div class="section" style="background: #fef3c7; padding: 12px; border-left: 4px solid #f59e0b; border-radius: 8px; margin-top: 30px;">
        <p style="font-size: 12px; color: #92400e; font-weight: 600;">
          📋 Composition Taxable Person - Not eligible to collect tax on supplies
        </p>
      </div>
    ` : ''}

    <div class="footer">
      <div class="footer-grid">
        <div>
          <h3 class="section-title">Bank Details</h3>
          <p style="font-size: 12px; color: #64748b; line-height: 1.6;">
            <strong>Bank:</strong> ${data.bank.bank_name}<br>
            <strong>A/c No:</strong> ${data.bank.account_number}<br>
            <strong>IFSC:</strong> ${data.bank.ifsc_code}<br>
            <strong>Branch:</strong> ${data.bank.branch_name}
          </p>
        </div>
        <div>
          <h3 class="section-title">Terms & Conditions</h3>
          <p style="font-size: 11px; color: #64748b; line-height: 1.6;">
            ${data.invoice.terms}
          </p>
        </div>
      </div>
      
      <div class="signature">
        <div class="signature-line">
          <strong style="font-size: 12px;">Authorized Signatory</strong><br>
          <small style="color: #64748b;">${data.business.name}</small>
        </div>
      </div>
    </div>

    <div style="text-align: center; margin-top: 40px; padding-top: 20px; border-top: 1px solid #e2e8f0;">
      <p style="font-size: 11px; color: #94a3b8;">This is a computer-generated document and does not require a physical signature.</p>
    </div>
  </div>
</body>
</html>
  `;
}

generatePreviews().catch(console.error);

