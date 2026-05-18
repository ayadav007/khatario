import { NextRequest, NextResponse } from 'next/server';
import puppeteer from 'puppeteer';
import { getPuppeteerLaunchOptions } from '@/lib/puppeteer-launch';
import { InvoiceRenderer } from '@/lib/invoice-renderer';
import { getDefaultTemplateSettings, mergeTemplateSettings } from '@/lib/template-defaults';
import { injectPrintHtmlEnhancements, resolvePrintConfig } from '@/lib/print-config';

function getSampleRenderData(templateId: string) {
  const isComposition = templateId.includes('composition');
  const isGstDetailed = templateId === 'gst_detailed';
  const needsHsnTaxBreakdown = isGstDetailed || templateId === 'tally_style';

  return {
    business: {
      name: 'Digitable',
      address: 'Plot No. 123, MIDC Industrial Area',
      city: 'Mumbai',
      state: 'Maharashtra',
      state_code: '27',
      pincode: '400093',
      phone: '+91 98765 43210',
      email: 'accounts@digitable.com',
      website: 'www.digitable.com',
      gstin: '27AABCU9603R1ZM',
      pan: 'AABCU9603R',
      cin: 'U74900MH2020PTC123456',
      iec_code: '0305012345',
      swift_code: 'HDFCINBBXXX',
      logo_url: null,
      signature_url: null,
      bank_name: 'HDFC Bank',
      account_number: '50200012345678',
      branch_name: 'Andheri East, Mumbai',
      ifsc_code: 'HDFC0001234',
    },
    customer: {
      name: 'XYZ Enterprises Pvt. Ltd.',
      address: '456 Business Park, Sector 18\nGurugram, Haryana - 122015',
      shipping_address: '789 Warehouse Zone, Sector 24\nGurugram, Haryana - 122017',
      city: 'Gurugram',
      state: 'Haryana',
      state_code: '06',
      pincode: '122015',
      country: 'India',
      phone: '+91 97654 32109',
      email: 'purchases@xyzenterprises.com',
      gstin: '06ABCDE1234F1Z5',
      pan: 'ABCDE1234F',
      contact_person: 'Rajesh Sharma',
      buyer_tax_id: 'ABCDE1234F',
      current_balance: 48563.6,
      shipping_name: 'XYZ Enterprises — Warehouse',
      shipping_gstin: '06ABCDE1234F1Z5',
      shipping_state: 'Haryana',
      shipping_state_code: '06',
      ...(isGstDetailed
        ? {
            opening_balance: 10021.18,
            balance_due: 115658.18,
          }
        : {}),
    },
    invoice: {
      invoice_number: 'INV-2026-001',
      invoice_date: '02-Jan-2026',
      invoice_title: isComposition ? 'BILL OF SUPPLY' : 'TAX INVOICE',
      invoice_type: isComposition ? 'Bill of Supply' : 'Tax Invoice',
      due_date: '16-Jan-2026',
      po_number: 'PO-2025-789',
      reference_number: 'REF-2026-456',
      place_of_supply: 'Haryana',
      place_of_supply_state_code: '06',
      is_reverse_charge: true,
      reverse_charge: 'Yes',
      is_export: false,
      buyer_tax_id: 'ABCDE1234F',
      qr_code_url: null,
      port_code: 'INNSA1',
      eway_bill_number: 'EWB-1234567890',
      delivery_note: 'DN-2026-078',
      payment_terms: 'Net 30 Days',
      other_references: 'LC/2026/001',
      dispatched_through: 'ABC Transport Co.',
      destination: 'Gurugram, Haryana',
      terms_of_delivery: 'FOB - Freight on Board',
      invoice_currency: 'INR',
      exchange_rate: 1.0,
      country_of_origin: 'India',
      port_of_loading: 'Nhava Sheva (INNSA)',
      port_of_discharge: 'Dubai (AEJEA)',
      place_of_delivery: 'Dubai, UAE',
      incoterms: 'CIF',
      transport_mode: 'Sea',
      awb_number: 'AWB-2026-789012',
      bl_number: 'BL-2026-345678',
      export_declaration: 'All goods are of Indian origin',
      lut_declaration: 'Supply under LUT. ARN: AD270123456789Q',
      terms: 'Payment within 14 days. Interest @ 18% p.a. on delayed payments.',
      subtotal: 59020.0,
      discount_total: 3030.0,
      additional_charges: 500.0,
      cgst_total: isComposition ? 0 : 3645.0,
      sgst_total: isComposition ? 0 : 3645.0,
      igst_total: 0,
      cess_total: 100.0,
      tax_total: isComposition ? 0 : 7290.0,
      round_off: 0.4,
      grand_total: isComposition ? 59020.0 : 68563.6,
      paid_amount: 20000.0,
      balance_amount: isComposition ? 39020.0 : 48563.6,
      is_igst: false,
      amount_in_words: isComposition
        ? 'Fifty Nine Thousand Twenty Rupees Only'
        : 'Sixty Eight Thousand Five Hundred Sixty Three Rupees and Sixty Paise Only',
      ...(isGstDetailed
        ? {
            total_quantity: 180,
            total_unit: 'Nos',
            tax_amount_in_words: 'Seven Thousand Two Hundred Ninety Rupees Only',
          }
        : {}),
      ...(needsHsnTaxBreakdown
        ? {
            tax_breakdown: [
              {
                hsn_sac: '27101990',
                taxable_value: 53050.0,
                cgst_rate: 9,
                cgst_amount: 4774.5,
                sgst_rate: 9,
                sgst_amount: 4774.5,
                total_tax: 9549.0,
              },
              {
                hsn_sac: '38200000',
                taxable_value: 20160.0,
                cgst_rate: 6,
                cgst_amount: 1209.6,
                sgst_rate: 6,
                sgst_amount: 1209.6,
                total_tax: 2419.2,
              },
            ],
          }
        : {}),
    },
    items: [
      {
        index: 1,
        sn: 1,
        item_name: 'Premium Hydraulic Oil - Grade 68',
        hsn_sac: '27101990',
        hsn_code: '27101990',
        unit: 'Ltr',
        quantity: 50,
        unit_price: 450.0,
        rate: 450.0,
        discount_percent: 10,
        discount_amount: 2250.0,
        tax_rate: isComposition ? 0 : 18,
        cgst_rate: isComposition ? 0 : 9,
        sgst_rate: isComposition ? 0 : 9,
        cgst_amount: isComposition ? 0 : 1822.5,
        sgst_amount: isComposition ? 0 : 1822.5,
        tax_amount: isComposition ? 0 : 3645.0,
        line_total: isComposition ? 22500.0 : 26550.0,
        batch_number: 'BATCH-2026-001',
        expiry_date: '31-Dec-2027',
        image_url: null,
        description: 'High performance hydraulic oil for industrial machinery',
        variant_name: 'Grade 68 - 5L Can',
        variant_attributes: 'Grade: 68, Pack: 5 Litre',
      },
      {
        index: 2,
        sn: 2,
        item_name: 'Industrial Gear Oil - EP 90',
        hsn_sac: '27101990',
        hsn_code: '27101990',
        unit: 'Ltr',
        quantity: 30,
        unit_price: 520.0,
        rate: 520.0,
        discount_percent: 5,
        discount_amount: 780.0,
        tax_rate: isComposition ? 0 : 18,
        cgst_rate: isComposition ? 0 : 9,
        sgst_rate: isComposition ? 0 : 9,
        cgst_amount: isComposition ? 0 : 1404.0,
        sgst_amount: isComposition ? 0 : 1404.0,
        tax_amount: isComposition ? 0 : 2808.0,
        line_total: isComposition ? 15600.0 : 18428.0,
        batch_number: 'BATCH-2026-002',
        expiry_date: null,
        image_url: null,
        description: 'Extreme pressure gear oil for heavy duty applications',
        variant_name: null,
        variant_attributes: null,
      },
      {
        index: 3,
        sn: 3,
        item_name: 'Engine Coolant - Long Life',
        hsn_sac: '38200000',
        hsn_code: '38200000',
        unit: 'Pcs',
        quantity: 20,
        unit_price: 900.0,
        rate: 900.0,
        discount_percent: 0,
        discount_amount: 0.0,
        tax_rate: isComposition ? 0 : 12,
        cgst_rate: isComposition ? 0 : 6,
        sgst_rate: isComposition ? 0 : 6,
        cgst_amount: isComposition ? 0 : 1080.0,
        sgst_amount: isComposition ? 0 : 1080.0,
        tax_amount: isComposition ? 0 : 2160.0,
        line_total: isComposition ? 18000.0 : 20160.0,
        batch_number: null,
        expiry_date: null,
        image_url: null,
        description: 'Long life engine coolant for all weather conditions',
        variant_name: null,
        variant_attributes: null,
      },
    ],
  };
}

export async function GET(request: NextRequest) {
  let browser: any | null = null;
  try {
    const { searchParams } = new URL(request.url);
    const templateId = searchParams.get('template_id');
    const customSettingsParam = searchParams.get('settings');

    if (!templateId) {
      return NextResponse.json({ error: 'template_id parameter is required' }, { status: 400 });
    }

    let customSettings: any | null = null;
    if (customSettingsParam) {
      try {
        customSettings = JSON.parse(decodeURIComponent(customSettingsParam));
      } catch {
        customSettings = null;
      }
    }

    const defaults = getDefaultTemplateSettings(templateId);
    const finalSettings = customSettings ? mergeTemplateSettings(customSettings, defaults) : defaults;

    const sample = getSampleRenderData(templateId);
    const renderData = {
      invoice: sample.invoice,
      business: sample.business,
      customer: sample.customer,
      items: sample.items,
      settings: finalSettings,
    };

    const renderer = new InvoiceRenderer();
    const rawHtml = await renderer.renderHtml(templateId, renderData);
    const printCfg = resolvePrintConfig(templateId, finalSettings);
    const html = injectPrintHtmlEnhancements(rawHtml, printCfg);

    browser = await puppeteer.launch(getPuppeteerLaunchOptions());
    const page = await browser.newPage();
    await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 2 });
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    // Keep thumbnails consistent with PDF output (print CSS)
    await page.emulateMediaType('print');

    const png = await page.screenshot({ type: 'png' });
    await browser.close();
    browser = null;

    return new NextResponse(png as any, {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        // Cache for a bit; UI adds a cache-buster when needed.
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (error: any) {
    if (browser) {
      try {
        await browser.close();
      } catch {
        // ignore
      }
    }
    console.error('Error generating template preview image:', error);
    return NextResponse.json({ error: 'Failed to generate template preview image' }, { status: 500 });
  }
}

