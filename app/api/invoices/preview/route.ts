import { NextRequest, NextResponse } from 'next/server';
import { InvoiceRenderer } from '@/lib/invoice-renderer';
import * as db from '@/lib/db';
import { getDefaultTemplateSettings, mergeTemplateSettings } from '@/lib/template-defaults';
import { prepareInvoiceForRendering } from '@/lib/invoice-presenter';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    let { templateId, data } = body;

    console.log('='.repeat(80));
    console.log('[Preview API] ========== TEMPLATE SELECTION DEBUG ==========');
    console.log('[Preview API] Request received:', {
      provided_templateId: templateId || '(none)',
      document_type: data.invoice?.document_type || '(none)',
      business_id: data.business?.id || '(none)',
      is_export: data.invoice?.is_export || false
    });
    console.log('='.repeat(80));

    if (!data) {
      console.error('[Preview API] Missing data in request body');
      return NextResponse.json({ error: 'Missing data' }, { status: 400 });
    }

    // 1. Determine document type from data
    const documentTypeMap: Record<string, string> = {
      'tax_invoice': 'tax_invoice',
      'proforma_invoice': 'proforma_invoice',
      'bill_of_supply': 'bill_of_supply',
      'credit_note': 'credit_note',
      'debit_note': 'debit_note',
      'delivery_challan': 'delivery_challan',
      'sales_order': 'sales_order',
      'purchase_order': 'purchase_order'
    };
    
    const documentType = data.invoice?.document_type 
      ? documentTypeMap[data.invoice.document_type] || 'tax_invoice'
      : 'tax_invoice';

    // 2. Fetch template assignment from business_template_assignments (NEW SYSTEM)
    // Priority: provided templateId > assigned template from DB > export > default
    let savedSettings = null;
    let assignedTemplateId = null;
    const providedTemplateId = templateId; // Save the provided templateId if any
    
    console.log('[Preview API] Step 1: Checking for template assignment in database...');
    console.log('[Preview API]   - Business ID:', data.business?.id || '(missing)');
    console.log('[Preview API]   - Document Type:', documentType);
    console.log('[Preview API]   - Provided Template ID:', providedTemplateId || '(none)');
    
    if (data.business?.id) {
      try {
        // First, try to get assignment by document_type only (this gives us the assigned template)
        console.log('[Preview API] Step 2: Querying business_template_assignments for document_type:', documentType);
        let assignment = await db.queryOne(
          `SELECT template_id, settings 
           FROM business_template_assignments 
           WHERE business_id = $1 AND document_type = $2
           LIMIT 1`,
          [data.business.id, documentType]
        );
        
        if (assignment) {
          assignedTemplateId = assignment.template_id;
          const settings = assignment.settings;
          if (settings) {
            savedSettings = typeof settings === 'string' ? JSON.parse(settings) : settings;
          }
          console.log('[Preview API] ✅ Step 2 Result: Assignment FOUND');
          console.log('[Preview API]   - Assigned Template ID:', assignedTemplateId);
          console.log('[Preview API]   - Has Settings:', !!savedSettings);
          console.log('[Preview API]   - Settings Keys:', savedSettings ? Object.keys(savedSettings).length : 0);
          
          // If a specific template_id was provided, try to get settings for that template
          if (providedTemplateId && providedTemplateId !== assignedTemplateId) {
            console.log('[Preview API] Step 3: Provided template differs from assigned template');
            console.log('[Preview API]   - Provided:', providedTemplateId);
            console.log('[Preview API]   - Assigned:', assignedTemplateId);
            console.log('[Preview API]   - Querying for specific template settings...');
            
            // Try to get settings for the provided template_id
            const specificAssignment = await db.queryOne(
              `SELECT template_id, settings 
               FROM business_template_assignments 
               WHERE business_id = $1 AND document_type = $2 AND template_id = $3
               LIMIT 1`,
              [data.business.id, documentType, providedTemplateId]
            );
            
            if (specificAssignment && specificAssignment.settings) {
              // Use settings for the provided template
              savedSettings = typeof specificAssignment.settings === 'string' 
                ? JSON.parse(specificAssignment.settings) 
                : specificAssignment.settings;
              console.log('[Preview API] ✅ Step 3 Result: Found settings for provided template');
            } else {
              console.log('[Preview API] ⚠️ Step 3 Result: No settings found for provided template');
              console.log('[Preview API]   - CRITICAL: Will NOT use assignment settings from different template');
              console.log('[Preview API]   - Will use template defaults for:', providedTemplateId);
              // CRITICAL FIX: Don't use settings from a different template!
              // Clear savedSettings so we use defaults for the requested template
              savedSettings = null;
            }
          } else if (providedTemplateId && providedTemplateId === assignedTemplateId) {
            console.log('[Preview API] Step 3: Provided template matches assigned template - using assignment settings');
          }
        } else {
          // Debug: Check if any assignments exist for this business
          console.log('[Preview API] ⚠️ Step 2 Result: No assignment found');
          const allAssignments = await db.query(
            `SELECT document_type, template_id 
             FROM business_template_assignments 
             WHERE business_id = $1`,
            [data.business.id]
          );
          console.log('[Preview API]   - Checking all assignments for this business...');
          console.log('[Preview API]   - Total assignments found:', allAssignments.rows.length);
          if (allAssignments.rows.length > 0) {
            console.log('[Preview API]   - Available assignments:');
            allAssignments.rows.forEach((a: any, i: number) => {
              console.log(`[Preview API]     ${i + 1}. document_type: ${a.document_type}, template_id: ${a.template_id}`);
            });
          } else {
            console.log('[Preview API]   - ⚠️ NO ASSIGNMENTS FOUND IN DATABASE!');
            console.log('[Preview API]   - This means no template has been selected in Settings');
          }
        }
      } catch (dbError) {
        console.error('[Preview API] ❌ Database error:', dbError);
      }
    } else {
      console.log('[Preview API] ⚠️ Step 1 Result: No business_id provided - cannot fetch assignment');
    }

    // 3. Finalize template ID (Priority: provided templateId > assigned template > export > default)
    console.log('[Preview API] Step 4: Finalizing template ID...');
    console.log('[Preview API]   - Provided Template ID:', providedTemplateId || '(none)');
    console.log('[Preview API]   - Assigned Template ID:', assignedTemplateId || '(none)');
    console.log('[Preview API]   - Is Export:', data.invoice?.is_export || false);
    
    if (!templateId) {
      if (assignedTemplateId) {
        templateId = assignedTemplateId;
        console.log('[Preview API] ✅ Step 4 Result: Using assigned template from DB');
        console.log('[Preview API]   - Final Template ID:', templateId);
      } else if (data.invoice?.is_export) {
        templateId = 'export_invoice';
        console.log('[Preview API] ⚠️ Step 4 Result: Using export_invoice (fallback - is_export=true)');
        console.log('[Preview API]   - Final Template ID:', templateId);
      } else {
        templateId = 'gst_standard';
        console.log('[Preview API] ⚠️ Step 4 Result: Using DEFAULT template (fallback)');
        console.log('[Preview API]   - Final Template ID:', templateId);
        console.log('[Preview API]   - ⚠️ THIS IS THE DEFAULT FALLBACK - no template was found!');
      }
    } else {
      console.log('[Preview API] ✅ Step 4 Result: Using provided template');
      console.log('[Preview API]   - Final Template ID:', templateId);
    }

    // 3. Merge all settings levels
    console.log('[Preview API] Step 5: Merging settings...');
    console.log('[Preview API]   - Template ID for defaults:', templateId);
    const defaults = getDefaultTemplateSettings(templateId);
    console.log('[Preview API]   - Default settings keys:', Object.keys(defaults).length);
    console.log('[Preview API]   - Default primary_color:', defaults.primary_color);
    
    let finalSettings = defaults;
    if (savedSettings) {
      console.log('[Preview API]   - Merging saved settings (from DB)...');
      console.log('[Preview API]   - Saved settings keys:', Object.keys(savedSettings).length);
      finalSettings = mergeTemplateSettings(savedSettings, finalSettings);
    } else {
      console.log('[Preview API]   - No saved settings to merge');
    }
    
    if (data.settings) {
      console.log('[Preview API]   - Merging request settings (from data)...');
      finalSettings = mergeTemplateSettings(data.settings, finalSettings);
    }
    
    console.log('[Preview API] ✅ Step 5 Result: Final settings merged');
    console.log(`[Preview API] Final settings summary:`, {
      primary_color: finalSettings.primary_color,
      text_color: finalSettings.text_color,
      table_header_color: finalSettings.table_header_color,
      font_family: finalSettings.font_family,
      show_logo: finalSettings.show_logo,
      settingsCount: Object.keys(finalSettings).length
    });
    console.log('='.repeat(80));
    
    // 4. Transform data using the unified Presenter
    // NOTE: prepareInvoiceForRendering expects settings as SECOND parameter, not inside data!
    if (!data || !data.invoice) {
      return NextResponse.json({ error: 'Invalid data structure' }, { status: 400 });
    }
    const renderData = await prepareInvoiceForRendering(data, finalSettings);

    console.log('[Preview API] ✅ Final template:', templateId, 'Title:', renderData.invoice.invoice_title, 'Document Type:', documentType);
    
    try {
      const renderer = new InvoiceRenderer();
      let html = await renderer.renderHtml(templateId, renderData);
      if (data.business?.id) {
        const { maybeAppendKhatarioPrintFooter } = await import('@/lib/print-branding');
        html = await maybeAppendKhatarioPrintFooter(html, data.business.id);
      }

      // Return template info for debugging
      return NextResponse.json({ 
        html, 
        templateId,
        assignedTemplateId: assignedTemplateId || null,
        documentType,
        usedAssignment: !!assignedTemplateId
      });
    } catch (renderError: any) {
      console.error('[Preview API] Render error:', renderError);
      return NextResponse.json({ error: `Render failed: ${renderError.message}` }, { status: 500 });
    }
  } catch (error: any) {
    console.error('[Preview API] Uncaught error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
