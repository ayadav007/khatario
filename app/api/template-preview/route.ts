import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import Handlebars from 'handlebars';
import { getDefaultTemplateSettings, mergeTemplateSettings } from '@/lib/template-defaults';

// Register Handlebars helpers
Handlebars.registerHelper('ifSetting', function(this: any, settingName: string, options: any) {
  // Safety check: ensure options.fn exists (block helper requirement)
  if (!options || typeof options.fn !== 'function') {
    console.error('[ifSetting] Error: options.fn is not a function. Setting:', settingName, 'Options:', options);
    return '';
  }
  
  // Access settings from root context
  const root = options.data?.root || options.data || this;
  const settings = root?.settings || {};
  const settingValue = settings[settingName];
  
  // Explicit false means hide
  if (settingValue === false) {
    return options.inverse && typeof options.inverse === 'function' ? options.inverse(this) : '';
  }
  
  // Explicit true means show
  if (settingValue === true) {
    return options.fn(this);
  }
  
  // If undefined, default to showing (for backward compatibility)
  // But this should ideally never happen if settings are properly initialized
  return options.fn(this);
});

Handlebars.registerHelper('ifEqual', function(this: any, arg1: any, arg2: any, options: any) {
  return (arg1 == arg2) ? options.fn(this) : options.inverse(this);
});

Handlebars.registerHelper('or', function(this: any) {
  return Array.prototype.slice.call(arguments, 0, -1).some(Boolean);
});

Handlebars.registerHelper('and', function(this: any) {
  return Array.prototype.slice.call(arguments, 0, -1).every(Boolean);
});

Handlebars.registerHelper('and', function(this: any) {
  return Array.prototype.slice.call(arguments, 0, -1).every(Boolean);
});

Handlebars.registerHelper('formatCurrency', function(this: any, value: any) {
  if (!value && value !== 0) return '0.00';
  return parseFloat(value).toFixed(2);
});

Handlebars.registerHelper('formatNumber', function(this: any, value: any) {
  if (!value && value !== 0) return '0';
  return parseFloat(value).toFixed(2);
});

Handlebars.registerHelper('add', function(this: any, a: any, b: any) {
  return parseFloat(a || 0) + parseFloat(b || 0);
});

Handlebars.registerHelper('sum', function(this: any) {
  const args = Array.prototype.slice.call(arguments, 0, -1);
  return args.reduce((sum, val) => sum + parseFloat(val || 0), 0);
});

// Helper to calculate dynamic colspan for item table totals
// Counts visible columns and returns (total - 1) to align with the last column
Handlebars.registerHelper('itemTableColspan', function(this: any, ...args: any[]) {
  // Last argument is always the options object for Handlebars helpers
  const options = args[args.length - 1];
  
  // Access root context
  const root = options?.data?.root || options?.data || this;
  const settings = root?.settings || {};
  const invoice = root?.invoice || {};
  
  let count = 0;
  
  // Count visible columns (default to true if not explicitly false)
  // Each column is counted individually, regardless of tax type
  if (settings.show_serial_number !== false) count++;
  if (settings.show_item_name !== false) count++;
  if (settings.show_hsn !== false) count++;
  if (settings.show_quantity !== false) count++;
  if (settings.show_rate !== false) count++;
  if (settings.show_discount_percent !== false) count++;
  if (settings.show_discount_amount !== false) count++;
  
  // Tax columns: always count as 1 column each (Tax % and Tax are separate columns)
  // The template shows them as single columns, not split by CGST/SGST
  if (settings.show_tax_rate !== false) count++;
  if (settings.show_tax_amount !== false) count++;
  
  if (settings.show_line_total !== false) count++;
  
  // Debug logging
  if (process.env.NODE_ENV === 'development') {
    console.log('[itemTableColspan] Column count:', count, 'colspan:', Math.max(1, count - 1), {
      show_serial_number: settings.show_serial_number,
      show_item_name: settings.show_item_name,
      show_hsn: settings.show_hsn,
      show_quantity: settings.show_quantity,
      show_rate: settings.show_rate,
      show_discount_percent: settings.show_discount_percent,
      show_discount_amount: settings.show_discount_amount,
      show_tax_rate: settings.show_tax_rate,
      show_tax_amount: settings.show_tax_amount,
      show_line_total: settings.show_line_total
    });
  }
  
  // Return (total - 1) to span all columns except the last one (Total)
  return Math.max(1, count - 1);
});

Handlebars.registerHelper('multiply', function(this: any, a: any, b: any) {
  return parseFloat(a || 0) * parseFloat(b || 0);
});

Handlebars.registerHelper('subtract', function(this: any, a: any, b: any) {
  return parseFloat(a || 0) - parseFloat(b || 0);
});

Handlebars.registerHelper('divide', function(this: any, a: any, b: any) {
  return parseFloat(a || 0) / parseFloat(b || 1);
});

Handlebars.registerHelper('gt', function(this: any, a: any, b: any) {
  return parseFloat(a || 0) > parseFloat(b || 0);
});

Handlebars.registerHelper('lt', function(this: any, a: any, b: any) {
  return parseFloat(a || 0) < parseFloat(b || 0);
});

Handlebars.registerHelper('eq', function(this: any, a: any, b: any) {
  return a == b;
});

Handlebars.registerHelper('ne', function(this: any, a: any, b: any) {
  return a != b;
});

Handlebars.registerHelper('not', function(this: any, value: any) {
  return !value;
});

Handlebars.registerHelper('json', function(this: any, context: any) {
  return JSON.stringify(context);
});

Handlebars.registerHelper('uppercase', function(this: any, str: any) {
  return str ? str.toString().toUpperCase() : '';
});

Handlebars.registerHelper('lowercase', function(this: any, str: any) {
  return str ? str.toString().toLowerCase() : '';
});

Handlebars.registerHelper('abs', function(this: any, value: any) {
  return Math.abs(parseFloat(value || 0));
});

// Sample data generator
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
    
    // Fetch business logo and bank details if business_id is provided
    let businessLogoUrl: string | null = null;
    let bankDetails: {
      bank_name: string | null;
      account_number: string | null;
      ifsc_code: string | null;
      branch_name: string | null;
    } | null = null;
    
    if (businessId) {
      try {
        const { queryOne } = await import('@/lib/db');
        
        // Fetch business logo
        const business = await queryOne<{ logo_url: string | null }>(
          'SELECT logo_url FROM businesses WHERE id = $1',
          [businessId]
        );
        if (business) {
          businessLogoUrl = business.logo_url;
          console.log('[Preview] Business logo URL:', businessLogoUrl || 'Not set');
        }
        
        // Fetch bank details from bank_accounts table
        const bankAccount = await queryOne<{
          bank_name: string;
          account_number: string;
          ifsc_code: string | null;
          branch_name: string | null;
        }>(
          `SELECT bank_name, account_number, ifsc_code, branch_name
           FROM bank_accounts
           WHERE business_id = $1 AND is_active = true
           ORDER BY created_at ASC
           LIMIT 1`,
          [businessId]
        );
        
        if (bankAccount) {
          bankDetails = {
            bank_name: bankAccount.bank_name || null,
            account_number: bankAccount.account_number || null,
            ifsc_code: bankAccount.ifsc_code || null,
            branch_name: bankAccount.branch_name || null
          };
          console.log('[Preview] Bank details found:', bankDetails);
        } else {
          console.log('[Preview] No active bank account found for business');
        }
      } catch (error) {
        console.error('[Preview] Error fetching business data:', error);
        // Continue without logo/bank details - not critical
      }
    }

    // Parse custom settings if provided
    let customSettings = null;
    if (customSettingsParam) {
      try {
        customSettings = JSON.parse(decodeURIComponent(customSettingsParam));
        console.log('[Preview] Received custom settings:', customSettings ? 'Yes' : 'No');
      } catch (e) {
        console.error('[Preview] Failed to parse settings JSON:', e);
        console.log('[Preview] Settings param:', customSettingsParam?.substring(0, 100));
      }
    }

    // Map template ID to path
    const templatePaths: Record<string, string> = {
      'gst_standard': 'templates/gst_standard/template.html',
      'modern': 'templates/modern/template.html',
      'classic': 'templates/classic/template.html',
      'elegant': 'templates/elegant/template.html',
      'minimal': 'templates/minimal/template.html',
      'business_pro': 'templates/business_pro/template.html',
      'tally_style': 'templates/tally_style/template.html',
      'export_invoice': 'templates/export_invoice/template.html',
      'gst_detailed': 'templates/gst_detailed/template.html',
      'composition_standard': 'templates/bill_of_supply/composition_standard/template.html',
      'composition_modern': 'templates/bill_of_supply/composition_modern/template.html',
      'tax_exempt': 'templates/bill_of_supply/tax_exempt/template.html',
      'credit_standard': 'templates/credit_note/standard/template.html',
      'debit_standard': 'templates/debit_note/standard/template.html',
      'challan_standard': 'templates/delivery_challan/standard/template.html',
      'payment_receipt': 'templates/payment_receipt/template.html',
      'thermal_58mm': 'templates/thermal_58mm/template.html',
      'thermal_80mm': 'templates/thermal_80mm/template.html',
    };

    const templatePath = templatePaths[templateId];
    if (!templatePath) {
      return new NextResponse(`Template "${templateId}" not found`, { status: 404 });
    }

    // Read template file
    const fullPath = path.join(process.cwd(), templatePath);
    if (!fs.existsSync(fullPath)) {
      return new NextResponse(`Template file not found: ${templatePath}`, { status: 404 });
    }

    const templateHtml = fs.readFileSync(fullPath, 'utf-8');

    // Compile with Handlebars
    const template = Handlebars.compile(templateHtml);

    // Get sample data
    const sampleData = getSampleData(templateId);
    
    // CRITICAL: Merge settings properly with defaults
    // 1. Start with template-specific defaults
    const defaults = getDefaultTemplateSettings(templateId);
    
    // 2. Merge with custom settings from query param
    let finalSettings = defaults;
    if (customSettings) {
      finalSettings = mergeTemplateSettings(customSettings, defaults);
      console.log('[Preview] Custom settings merged:', Object.keys(customSettings).length, 'settings');
    } else {
      console.log('[Preview] Using default settings for template:', templateId);
    }
    
    // 3. Ensure all boolean values are explicitly set (not undefined)
    // This prevents the ifSetting helper from defaulting incorrectly
    Object.keys(finalSettings).forEach((key: string) => {
      if (key.startsWith('show_') && (finalSettings as any)[key] === undefined) {
        (finalSettings as any)[key] = (defaults as any)[key] !== undefined ? (defaults as any)[key] : true;
      }
    });
    
    // Override logo_url with actual business logo if available
    if (businessLogoUrl) {
      (sampleData.business as any).logo_url = businessLogoUrl;
      console.log('[Preview] Using business logo:', businessLogoUrl);
    } else if (businessId) {
      console.log('[Preview] Business has no logo set');
    }
    
    // Override bank details with actual bank account data if available
    if (bankDetails) {
      // Normalize null to undefined at the boundary
      sampleData.business.bank_name = bankDetails.bank_name ?? '';
      sampleData.business.account_number = bankDetails.account_number ?? '';
      sampleData.business.ifsc_code = bankDetails.ifsc_code ?? '';
      sampleData.business.branch_name = bankDetails.branch_name ?? '';
      console.log('[Preview] Using bank details from database:', bankDetails);
    }
    
    // 4. Apply final settings to data object
    const data = {
      ...sampleData,
      settings: finalSettings
    };
    
    // Log critical settings for debugging
    console.log('[Preview] Final settings:', {
      primary_color: finalSettings.primary_color,
      text_color: finalSettings.text_color,
      table_header_color: finalSettings.table_header_color,
      font_family: finalSettings.font_family,
      font_size: finalSettings.font_size,
      show_logo: finalSettings.show_logo,
      show_bank_details: finalSettings.show_bank_details,
      show_bank_name: finalSettings.show_bank_name,
      settingsCount: Object.keys(finalSettings).length
    });
    
    const renderedHtml = template(data);

    // Return HTML for iframe
    return new NextResponse(renderedHtml, {
      headers: {
        'Content-Type': 'text/html',
      },
    });
  } catch (error) {
    console.error('Error rendering template:', error);
    return new NextResponse('Error rendering template', { status: 500 });
  }
}

