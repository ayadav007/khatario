import { NextRequest, NextResponse } from 'next/server';
import { renderTemplatePreviewHtml } from '@/lib/template-preview-render';
import { registerGlobalInvoiceHandlebarsHelpers } from '@/lib/handlebars-invoice-helpers';

registerGlobalInvoiceHandlebarsHelpers();

function getSampleData(templateId: string) {
  const isComposition = templateId.includes('composition');
  const isGstDetailed = templateId === 'gst_detailed';
  const needsHsnTaxBreakdown = isGstDetailed || templateId === 'tally_style';
  
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
      phone: "+91 98765 43210",
      email: "accounts@digitable.com",
      website: "www.digitable.com",
      gstin: "27AABCU9603R1ZM",
      pan: "AABCU9603R",
      cin: "U74900MH2020PTC123456",
      iec_code: "0305012345",
      swift_code: "HDFCINBBXXX",
      logo_url: null,
      signature_url: null,
      bank_name: "HDFC Bank",
      account_number: "50200012345678",
      branch_name: "Andheri East, Mumbai",
      ifsc_code: "HDFC0001234"
    },
    customer: {
      name: "XYZ Enterprises Pvt. Ltd.",
      address: "456 Business Park, Sector 18\nGurugram, Haryana - 122015",
      shipping_address: "789 Warehouse Zone, Sector 24\nGurugram, Haryana - 122017",
      city: "Gurugram",
      state: "Haryana",
      state_code: "06",
      pincode: "122015",
      country: "India",
      phone: "+91 97654 32109",
      email: "purchases@xyzenterprises.com",
      gstin: "06ABCDE1234F1Z5",
      pan: "ABCDE1234F",
      contact_person: "Rajesh Sharma",
      buyer_tax_id: "ABCDE1234F",
      current_balance: 48563.60,
      shipping_name: "XYZ Enterprises — Warehouse",
      shipping_gstin: "06ABCDE1234F1Z5",
      shipping_state: "Haryana",
      shipping_state_code: "06",
      ...(isGstDetailed ? {
        opening_balance: 10021.18,
        balance_due: 115658.18
      } : {})
    },
    invoice: {
      invoice_number: "INV-2026-001",
      invoice_date: "02-Jan-2026",
      invoice_title: isComposition ? "BILL OF SUPPLY" : "TAX INVOICE",
      invoice_type: isComposition ? "Bill of Supply" : "Tax Invoice",
      due_date: "16-Jan-2026",
      po_number: "PO-2025-789",
      reference_number: "REF-2026-456",
      place_of_supply: "Haryana",
      place_of_supply_state_code: "06",
      is_reverse_charge: true,
      reverse_charge: "Yes",
      is_export: false,
      buyer_tax_id: "ABCDE1234F",
      qr_code_url: null,
      port_code: "INNSA1",
      eway_bill_number: "EWB-1234567890",
      delivery_note: "DN-2026-078",
      payment_terms: "Net 30 Days",
      other_references: "LC/2026/001",
      dispatched_through: "ABC Transport Co.",
      destination: "Gurugram, Haryana",
      terms_of_delivery: "FOB - Freight on Board",
      invoice_currency: "INR",
      exchange_rate: 1.00,
      country_of_origin: "India",
      port_of_loading: "Nhava Sheva (INNSA)",
      port_of_discharge: "Dubai (AEJEA)",
      place_of_delivery: "Dubai, UAE",
      incoterms: "CIF",
      transport_mode: "Sea",
      awb_number: "AWB-2026-789012",
      bl_number: "BL-2026-345678",
      export_declaration: "All goods are of Indian origin",
      lut_declaration: "Supply under LUT. ARN: AD270123456789Q",
      terms: "Payment within 14 days. Interest @ 18% p.a. on delayed payments.",
      subtotal: 59020.00,
      discount_total: 3030.00,
      additional_charges: 500.00,
      cgst_total: isComposition ? 0 : 3645.00,
      sgst_total: isComposition ? 0 : 3645.00,
      igst_total: 0,
      cess_total: 100.00,
      tax_total: isComposition ? 0 : 7290.00,
      round_off: 0.40,
      grand_total: isComposition ? 59020.00 : 68563.60,
      paid_amount: 20000.00,
      balance_amount: isComposition ? 39020.00 : 48563.60,
      is_igst: false,
      amount_in_words: isComposition ? "Fifty Nine Thousand Twenty Rupees Only" : "Sixty Eight Thousand Five Hundred Sixty Three Rupees and Sixty Paise Only",
      ...(isGstDetailed ? {
        total_quantity: 180,
        total_unit: "Nos",
        tax_amount_in_words: "Seven Thousand Two Hundred Ninety Rupees Only"
      } : {})
    },
    items: [
      {
        index: 1,
        sn: 1,
        item_name: "Premium Hydraulic Oil - Grade 68",
        hsn_sac: "27101990",
        hsn_code: "27101990",
        unit: "Ltr",
        quantity: 50,
        unit_price: 450.00,
        rate: 450.00,
        discount_percent: 10,
        discount_amount: 2250.00,
        tax_rate: isComposition ? 0 : 18,
        cgst_rate: isComposition ? 0 : 9,
        sgst_rate: isComposition ? 0 : 9,
        cgst_amount: isComposition ? 0 : 1822.50,
        sgst_amount: isComposition ? 0 : 1822.50,
        tax_amount: isComposition ? 0 : 3645.00,
        line_total: isComposition ? 22500.00 : 26550.00,
        batch_number: "BATCH-2026-001",
        expiry_date: "31-Dec-2027",
        image_url: null,
        description: "High performance hydraulic oil for industrial machinery",
        variant_name: "Grade 68 - 5L Can",
        variant_attributes: "Grade: 68, Pack: 5 Litre"
      },
      {
        index: 2,
        sn: 2,
        item_name: "Industrial Gear Oil - EP 90",
        hsn_sac: "27101990",
        hsn_code: "27101990",
        unit: "Ltr",
        quantity: 30,
        unit_price: 520.00,
        rate: 520.00,
        discount_percent: 5,
        discount_amount: 780.00,
        tax_rate: isComposition ? 0 : 18,
        cgst_rate: isComposition ? 0 : 9,
        sgst_rate: isComposition ? 0 : 9,
        cgst_amount: isComposition ? 0 : 1404.00,
        sgst_amount: isComposition ? 0 : 1404.00,
        tax_amount: isComposition ? 0 : 2808.00,
        line_total: isComposition ? 15600.00 : 18408.00,
        batch_number: "BATCH-2026-002",
        expiry_date: "30-Nov-2027",
        image_url: null,
        description: "Extra pressure gear oil for heavy duty applications",
        variant_name: "EP 90 - 1L Bottle",
        variant_attributes: "Grade: EP 90, Pack: 1 Litre"
      },
      {
        index: 3,
        sn: 3,
        item_name: "Engine Coolant - Antifreeze",
        hsn_sac: "38200000",
        hsn_code: "38200000",
        unit: "Ltr",
        quantity: 100,
        unit_price: 180.00,
        rate: 180.00,
        discount_percent: 0,
        discount_amount: 0,
        tax_rate: isComposition ? 0 : 12,
        cgst_rate: isComposition ? 0 : 6,
        sgst_rate: isComposition ? 0 : 6,
        cgst_amount: isComposition ? 0 : 1080.00,
        sgst_amount: isComposition ? 0 : 1080.00,
        tax_amount: isComposition ? 0 : 2160.00,
        line_total: isComposition ? 18000.00 : 20160.00,
        batch_number: null,
        expiry_date: null,
        image_url: null,
        description: "Long life engine coolant for all weather conditions",
        variant_name: null,
        variant_attributes: null
      }
    ],
    totals: {
      subtotal: 59020.00,
      cgst: isComposition ? 0 : 4771.80,
      sgst: isComposition ? 0 : 4771.80,
      grand_total: isComposition ? 59020.00 : 68563.60,
      amount_in_words: isComposition ? "Fifty Nine Thousand Twenty Rupees Only" : "Sixty Eight Thousand Five Hundred Sixty Three Rupees and Sixty Paise Only"
    },
    bank: {
      bank_name: "HDFC Bank",
      account_number: "50200012345678",
      ifsc_code: "HDFC0001234",
      branch_name: "Andheri East, Mumbai"
    },
    terms: "Payment within 14 days. Interest @ 18% p.a. on delayed payments.",
    notes: "Thank you for your business!",
    is_igst: false,
    ...(needsHsnTaxBreakdown ? {
      tax_breakdown: [
        {
          hsn_sac: "27101990",
          taxable_value: 53050.00,
          cgst_rate: 9,
          cgst_amount: 4774.50,
          sgst_rate: 9,
          sgst_amount: 4774.50,
          total_tax: 9549.00
        },
        {
          hsn_sac: "38200000",
          taxable_value: 20160.00,
          cgst_rate: 6,
          cgst_amount: 1209.60,
          sgst_rate: 6,
          sgst_amount: 1209.60,
          total_tax: 2419.20
        }
      ]
    } : {})
  };
}

/**
 * GET /api/template-preview?template_id=gst_standard&settings={...}
 * Renders template HTML with sample data for iframe preview
 * Optionally accepts custom settings as JSON string in query param
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const templateId = searchParams.get('template_id');
    const customSettingsParam = searchParams.get('settings');
    const businessId = searchParams.get('business_id');

    if (!templateId) {
      return new NextResponse('template_id parameter is required', { status: 400 });
    }

    let customSettings: Record<string, unknown> | null = null;
    if (customSettingsParam) {
      try {
        customSettings = JSON.parse(decodeURIComponent(customSettingsParam));
      } catch (e) {
        console.error('[Preview] Failed to parse settings JSON:', e);
      }
    }

    const html = await renderTemplatePreviewHtml({
      templateId,
      businessId,
      customSettings,
      getSampleData,
    });

    return new NextResponse(html, {
      headers: { 'Content-Type': 'text/html' },
    });
  } catch (error) {
    console.error('Error rendering template:', error);
    const message = error instanceof Error ? error.message : 'Error rendering template';
    return new NextResponse(message, { status: 500 });
  }
}

/**
 * POST /api/template-preview
 * Body: { template_id, business_id?, settings? } — used by customize drawer (avoids URL length limits).
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const templateId = body.template_id as string | undefined;
    const businessId = (body.business_id as string | undefined) ?? null;
    const customSettings = (body.settings as Record<string, unknown> | undefined) ?? null;

    if (!templateId) {
      return new NextResponse('template_id is required', { status: 400 });
    }

    const html = await renderTemplatePreviewHtml({
      templateId,
      businessId,
      customSettings,
      getSampleData,
    });

    return new NextResponse(html, {
      headers: { 'Content-Type': 'text/html' },
    });
  } catch (error) {
    console.error('Error rendering template (POST):', error);
    const message = error instanceof Error ? error.message : 'Error rendering template';
    return new NextResponse(message, { status: 500 });
  }
}

