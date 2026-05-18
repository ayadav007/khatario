import * as db from '@/lib/db';
import { InvoiceRenderer } from '@/lib/invoice-renderer';
import puppeteer from 'puppeteer';
import { getPuppeteerLaunchOptions } from '@/lib/puppeteer-launch';
import { prepareInvoiceForRendering } from './invoice-presenter';
import { getDefaultTemplateSettings, mergeTemplateSettings } from './template-defaults';
import { injectPrintHtmlEnhancements, resolvePrintConfig } from '@/lib/print-config';
import { validateAndSanitizeTemplate } from '@/lib/template-validator';
import { compressThermalContent } from '@/lib/content-compressor';
import { optimizeForThermal } from '@/lib/thermal-transformer';

export type DocumentTable = 
  | 'invoices' 
  | 'sales_orders' 
  | 'delivery_challans' 
  | 'credit_notes' 
  | 'debit_notes' 
  | 'purchase_orders' 
  | 'work_orders';

/**
 * Generates HTML for any document type.
 */
export async function generateDocumentHtml(
  documentId: string, 
  table: DocumentTable = 'invoices'
) {
    const itemTableMap: Record<DocumentTable, string> = {
      'invoices': 'invoice_items',
      'sales_orders': 'sales_order_items',
      'delivery_challans': 'delivery_challan_items',
      'credit_notes': 'credit_note_items',
      'debit_notes': 'debit_note_items',
      'purchase_orders': 'purchase_order_items',
      'work_orders': 'work_order_items'
    };

    const idColumnMap: Record<DocumentTable, string> = {
      'invoices': 'invoice_id',
      'sales_orders': 'sales_order_id',
      'delivery_challans': 'delivery_challan_id',
      'credit_notes': 'credit_note_id',
      'debit_notes': 'debit_note_id',
      'purchase_orders': 'purchase_order_id',
      'work_orders': 'work_order_id'
    };

    const itemTable = itemTableMap[table];
    const idColumn = idColumnMap[table];

    // Tables that support item variants
    // Currently only 'invoices' among the DocumentTable types has a variant_id column in its items table.
    const hasVariants = table === 'invoices';

    // 1. Fetch Document Data
    // ... rest of code
    const partyJoin = (table === 'purchase_orders') 
      ? `LEFT JOIN suppliers c ON doc.supplier_id = c.id`
      : `LEFT JOIN customers c ON doc.customer_id = c.id`;

    // suppliers: address (no billing/shipping split); customers: billing_address, shipping_address, country
    const partyColumns =
      table === 'purchase_orders'
        ? `c.name as customer_name,
        c.address as customer_billing_address,
        NULL::text as customer_shipping_address,
        c.phone as customer_phone,
        c.email as customer_email,
        c.gstin as customer_gstin,
        NULL::text as customer_country,
        c.current_balance as customer_current_balance,
        c.state as customer_state,
        c.state_code as customer_state_code`
        : `c.name as customer_name,
        c.billing_address as customer_billing_address,
        c.shipping_address as customer_shipping_address,
        c.phone as customer_phone,
        c.email as customer_email,
        c.gstin as customer_gstin,
        c.country as customer_country,
        c.current_balance as customer_current_balance,
        c.state as customer_state,
        c.state_code as customer_state_code`;

    const doc = await db.queryOne(
      `SELECT doc.*, 
        doc.billing_address as invoice_billing_address,
        doc.shipping_address as invoice_shipping_address,
        ${partyColumns},
        b.name as business_name, b.address_line1 as business_address, b.city as business_city, b.state as business_state, b.pincode as business_pincode, b.gstin as business_gstin, b.logo_url as business_logo, b.signature_url as business_signature, b.phone as business_phone, b.email as business_email, b.iec_code as business_iec_code, b.swift_code as business_swift_code, b.state_code as business_state_code
       FROM ${table} doc
       ${partyJoin}
       JOIN businesses b ON doc.business_id = b.id
       WHERE doc.id = $1`,
      [documentId]
    );

    if (!doc) {
      throw new Error('Document not found');
    }

    const itemsQuery = hasVariants 
      ? `SELECT 
          ii.*, 
          COALESCE(ii.item_name, i.name) as item_name, 
          COALESCE(ii.hsn_sac, i.hsn_sac) as hsn_sac,
          iv.variant_name,
          iv.attributes as variant_attributes
         FROM ${itemTable} ii
         LEFT JOIN items i ON ii.item_id = i.id
         LEFT JOIN item_variants iv ON ii.variant_id = iv.id
         WHERE ii.${idColumn} = $1
         ORDER BY ii.sort_order, ii.id`
      : `SELECT 
          ii.*, 
          COALESCE(ii.item_name, i.name) as item_name, 
          COALESCE(ii.hsn_sac, i.hsn_sac) as hsn_sac
         FROM ${itemTable} ii
         LEFT JOIN items i ON ii.item_id = i.id
         WHERE ii.${idColumn} = $1
         ORDER BY ii.sort_order, ii.id`;

    const items = await db.queryRows(itemsQuery, [documentId]);

    // Debug logging for troubleshooting
    if (process.env.NODE_ENV === 'development') {
      const isDev = process.env.NODE_ENV === 'development';
      if (isDev && items.length > 0) {
        console.log(`[generateDocumentHtml] Fetched ${items.length} items for ${table} ID: ${documentId}`);
        console.log(`[generateDocumentHtml] First item:`, {
          name: items[0].item_name,
          qty: items[0].qty || items[0].quantity
        });
      }
    }

    // 2. Determine template_id from business_template_assignments
    // Priority: business_template_assignments > doc.template_id > export_invoice > default
    
    // Map table names to document types
    const documentTypeMap: Record<DocumentTable, string> = {
      'invoices': 'tax_invoice',
      'credit_notes': 'credit_note',
      'debit_notes': 'debit_note',
      'delivery_challans': 'delivery_challan',
      'purchase_orders': 'purchase_order',
      'sales_orders': 'sales_order',
      'work_orders': 'sales_order'
    };
    
    const documentType = documentTypeMap[table] || 'tax_invoice';
    
    // Fetch template assignment from business_template_assignments
    // Priority: document's template_id > assigned template from DB > export > default
    let savedSettings = null;
    let assignedTemplateId = null;
    const providedTemplateId = doc.template_id; // Save the document's template_id if any
    
    // Debug logging only in development
    const isDev = process.env.NODE_ENV === 'development';
    if (isDev) {
      console.log('='.repeat(80));
      console.log('[PDF Generator] ========== TEMPLATE SELECTION DEBUG ==========');
      console.log('[PDF Generator] Step 1: Checking for template assignment...');
      console.log('[PDF Generator]   - Business ID:', doc.business_id || '(missing)');
      console.log('[PDF Generator]   - Document Type:', documentType);
      console.log('[PDF Generator]   - Document Template ID:', providedTemplateId || '(none)');
      console.log('[PDF Generator]   - Is Export:', doc.is_export || false);
    }
    
    // First, try to get assignment by document_type only (this gives us the assigned template)
    if (isDev) {
      console.log('[PDF Generator] Step 2: Querying business_template_assignments for document_type:', documentType);
    }
    let savedSettingsResult = await db.queryOne(
      `SELECT template_id, settings 
       FROM business_template_assignments 
       WHERE business_id = $1 AND document_type = $2
       LIMIT 1`,
      [doc.business_id, documentType]
    );
    
    if (savedSettingsResult) {
      assignedTemplateId = savedSettingsResult.template_id;
      const settings = savedSettingsResult.settings;
      if (settings) {
        savedSettings = typeof settings === 'string' ? JSON.parse(settings) : settings;
      }
      if (isDev) {
        console.log('[PDF Generator] ✅ Step 2 Result: Assignment FOUND');
        console.log('[PDF Generator]   - Assigned Template ID:', assignedTemplateId);
        console.log('[PDF Generator]   - Has Settings:', !!savedSettings);
        console.log('[PDF Generator]   - Settings Keys:', savedSettings ? Object.keys(savedSettings).length : 0);
      }
      
      // If document has a specific template_id, try to get settings for that template
      if (providedTemplateId && providedTemplateId !== assignedTemplateId) {
        if (isDev) {
          console.log('[PDF Generator] Step 3: Document template differs from assigned template');
          console.log('[PDF Generator]   - Document Template:', providedTemplateId);
          console.log('[PDF Generator]   - Assigned Template:', assignedTemplateId);
          console.log('[PDF Generator]   - Querying for document template settings...');
        }
        
        const specificAssignment = await db.queryOne(
          `SELECT template_id, settings 
           FROM business_template_assignments 
           WHERE business_id = $1 AND document_type = $2 AND template_id = $3
           LIMIT 1`,
          [doc.business_id, documentType, providedTemplateId]
        );
        
        if (specificAssignment && specificAssignment.settings) {
          savedSettings = typeof specificAssignment.settings === 'string' 
            ? JSON.parse(specificAssignment.settings) 
            : specificAssignment.settings;
          if (isDev) {
            console.log('[PDF Generator] ✅ Step 3 Result: Found settings for document template');
          }
        } else {
          if (isDev) {
            console.log('[PDF Generator] ⚠️ Step 3 Result: No settings found for document template');
            console.log('[PDF Generator]   - CRITICAL: Will NOT use assignment settings from different template');
            console.log('[PDF Generator]   - Will use template defaults for:', providedTemplateId);
          }
          // CRITICAL FIX: Don't use settings from a different template!
          // Clear savedSettings so we use defaults for the requested template
          savedSettings = null;
        }
      } else if (providedTemplateId && providedTemplateId === assignedTemplateId) {
        if (isDev) {
          console.log('[PDF Generator] Step 3: Document template matches assigned template - using assignment settings');
        }
      }
    } else {
      if (isDev) {
        console.log('[PDF Generator] ⚠️ Step 2 Result: No assignment found');
        const allAssignments = await db.query(
          `SELECT document_type, template_id 
           FROM business_template_assignments 
           WHERE business_id = $1`,
          [doc.business_id]
        );
        console.log('[PDF Generator]   - Total assignments for business:', allAssignments.rows.length);
        if (allAssignments.rows.length > 0) {
          console.log('[PDF Generator]   - Available assignments:');
          allAssignments.rows.forEach((a: any, i: number) => {
            console.log(`[PDF Generator]     ${i + 1}. document_type: ${a.document_type}, template_id: ${a.template_id}`);
          });
        } else {
          console.log('[PDF Generator]   - ⚠️ NO ASSIGNMENTS FOUND IN DATABASE!');
        }
      }
    }
    
    // Determine final template ID (Priority: document's template_id > assigned template > export > default)
    if (isDev) {
      console.log('[PDF Generator] Step 4: Finalizing template ID...');
      console.log('[PDF Generator]   - Document Template ID:', providedTemplateId || '(none)');
      console.log('[PDF Generator]   - Assigned Template ID:', assignedTemplateId || '(none)');
      console.log('[PDF Generator]   - Is Export:', doc.is_export || false);
    }
    
    let finalTemplateId: string;
    if (providedTemplateId) {
      finalTemplateId = providedTemplateId;
      console.log('[PDF Generator] ✅ Step 4 Result: Using document template_id');
      console.log('[PDF Generator]   - Final Template ID:', finalTemplateId);
    } else if (assignedTemplateId) {
      finalTemplateId = assignedTemplateId;
      if (isDev) {
        console.log('[PDF Generator] ✅ Step 4 Result: Using assigned template from DB');
        console.log('[PDF Generator]   - Final Template ID:', finalTemplateId);
      }
    } else if (doc.is_export) {
      finalTemplateId = 'export_invoice';
      if (isDev) {
        console.log('[PDF Generator] ⚠️ Step 4 Result: Using export_invoice (fallback - is_export=true)');
        console.log('[PDF Generator]   - Final Template ID:', finalTemplateId);
      }
    } else {
      finalTemplateId = 'gst_standard';
      if (isDev) {
        console.log('[PDF Generator] ⚠️ Step 4 Result: Using DEFAULT template (fallback)');
        console.log('[PDF Generator]   - Final Template ID:', finalTemplateId);
        console.log('[PDF Generator]   - ⚠️ THIS IS THE DEFAULT FALLBACK - no template was found!');
      }
    }
    
    // Merge settings with defaults
    if (isDev) {
      console.log('[PDF Generator] Step 5: Merging settings...');
      console.log('[PDF Generator]   - Template ID for defaults:', finalTemplateId);
    }
    const defaults = getDefaultTemplateSettings(finalTemplateId);
    if (isDev) {
      console.log('[PDF Generator]   - Default settings keys:', Object.keys(defaults).length);
      console.log('[PDF Generator]   - Default primary_color:', defaults.primary_color);
    }
    
    let finalSettings = defaults;
    
    if (savedSettings) {
      if (isDev) {
        console.log('[PDF Generator]   - Merging saved settings (from DB)...');
        console.log('[PDF Generator]   - Saved settings keys:', Object.keys(savedSettings).length);
      }
      finalSettings = mergeTemplateSettings(savedSettings, defaults);
      if (isDev) {
        console.log('[PDF Generator] ✅ Step 5 Result: Settings merged');
      }
    } else {
      if (isDev) {
        console.log('[PDF Generator]   - No saved settings to merge');
        console.log('[PDF Generator] ⚠️ Step 5 Result: Using default settings only');
      }
    }
    if (isDev) {
      console.log('='.repeat(80));
    }

    // 3. Transform data using shared Presenter
    // Ensure document_type matches the DB table so purchase orders are not misclassified as sales orders (both use order_number).
    const renderData = await prepareInvoiceForRendering({
      invoice: {
        ...doc,
        document_type: doc.document_type ?? documentType,
      },
      business: {
        ...doc,
        id: doc.business_id, // Required for fetching bank details
        name: doc.business_name,
        address: doc.business_address,
        city: doc.business_city,
        state: doc.business_state,
        pincode: doc.business_pincode,
        gstin: doc.business_gstin,
        phone: doc.business_phone,
        email: doc.business_email,
        logo_url: doc.business_logo,
        signature_url: doc.business_signature,
        state_code: doc.business_state_code
      },
      customer: {
        ...doc,
        name: doc.customer_name,
        billing_address: doc.invoice_billing_address || doc.customer_billing_address,
        shipping_address: doc.invoice_shipping_address || doc.customer_shipping_address,
        gstin: doc.customer_gstin,
        phone: doc.customer_phone,
        email: doc.customer_email,
        state: doc.customer_state,
        state_code: doc.customer_state_code,
        current_balance: doc.customer_current_balance || 0
      },
      items: items
    }, finalSettings);

    const renderer = new InvoiceRenderer();
    const html = await renderer.renderHtml(finalTemplateId, renderData);
    return {
      html,
      templateId: finalTemplateId,
      settings: finalSettings,
      businessId: doc.business_id as string,
    };
}

/**
 * System print pipeline: inject global print CSS + body classes, then optional Khatario footer.
 * Call this for PDF and HTML preview responses so output matches printed PDFs.
 */
export async function finalizePrintHtml(
  html: string,
  templateId: string,
  settings: unknown,
  businessId: string
): Promise<string> {
  const { html: safeHtml, warnings } = validateAndSanitizeTemplate(html);
  warnings.forEach((w) => {
    console.warn(`[Template Warning][${templateId}] ${w}`);
  });

  const printCfg = resolvePrintConfig(
    templateId,
    (settings ?? {}) as Record<string, unknown>
  );
  const isThermal =
    printCfg.format === 'THERMAL_80MM' || printCfg.format === 'THERMAL_58MM';
  let workingHtml = isThermal ? optimizeForThermal(safeHtml) : safeHtml;
  if (isThermal) {
    workingHtml = compressThermalContent(workingHtml);
  }
  let out = injectPrintHtmlEnhancements(workingHtml, printCfg);
  const { maybeAppendKhatarioPrintFooter } = await import('@/lib/print-branding');
  out = await maybeAppendKhatarioPrintFooter(out, businessId);
  return out;
}

// Legacy wrapper for backward compatibility
export async function generateInvoiceHtml(invoiceId: string) {
  return generateDocumentHtml(invoiceId, 'invoices');
}

export async function generateDocumentPdf(documentId: string, table: DocumentTable = 'invoices') {
    const { html, templateId, settings, businessId } = await generateDocumentHtml(documentId, table);

    const htmlForPdf = await finalizePrintHtml(html, templateId, settings, businessId);

    // 3. Generate PDF with Puppeteer
    // Optimize Puppeteer launch args for better performance
    const browser = await puppeteer.launch(
      getPuppeteerLaunchOptions({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-extensions',
          '--disable-software-rasterizer',
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding',
        ],
      })
    );
    const page = await browser.newPage();
    // Use 'domcontentloaded' instead of 'networkidle0' for faster rendering
    await page.setContent(htmlForPdf, { waitUntil: 'domcontentloaded' });
    // CRITICAL: Render using print CSS (@media print) for consistent PDF layout
    // Without this, Puppeteer uses screen media by default, which can introduce
    // extra whitespace and unexpected page breaks across templates.
    await page.emulateMediaType('print');

    const printCfg = resolvePrintConfig(templateId, settings);
    const pdfOptions: Record<string, unknown> = { ...printCfg.puppeteer };

    const pdfBuffer = await page.pdf(pdfOptions as any);
    await browser.close();

    return Buffer.from(pdfBuffer);
}

// Legacy wrapper for backward compatibility
export async function generateInvoicePdf(invoiceId: string) {
  return generateDocumentPdf(invoiceId, 'invoices');
}
