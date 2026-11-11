import { NextRequest, NextResponse } from 'next/server';
import { InvoiceRenderer } from '@/lib/invoice-renderer';
import * as db from '@/lib/db';
import { getDefaultTemplateSettings, mergeTemplateSettings } from '@/lib/template-defaults';
import { prepareInvoiceForRendering } from '@/lib/invoice-presenter';
import { finalizePrintHtml } from '@/lib/pdf-generator';
import { injectThermalScreenPreviewCss } from '@/lib/thermal-preview';
import { getSessionScopedBusinessId } from '@/lib/auth-helpers';
import { findTemplateAssignment } from '@/lib/template-assignment';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const sessionBusinessId = getSessionScopedBusinessId(request);
    if (!sessionBusinessId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const body = await request.json();
    let { templateId, data } = body;
    if (data?.business?.id && data.business.id !== sessionBusinessId) {
      return NextResponse.json({ error: 'Business ID does not match your session' }, { status: 403 });
    }
    if (data) {
      data.business = { ...(data.business || {}), id: sessionBusinessId };
    }


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
    
    
    if (data.business?.id) {
      try {
        // First, try to get assignment by document_type only (this gives us the assigned template)
        const assignment = await findTemplateAssignment(data.business.id, documentType);
        
        if (assignment) {
          assignedTemplateId = assignment.template_id;
          savedSettings = assignment.settings;
          
          // If a specific template_id was provided, try to get settings for that template
          if (providedTemplateId && providedTemplateId !== assignedTemplateId) {
            
            // Try to get settings for the provided template_id
            const specificAssignment = await db.queryOne(
              `SELECT template_id, settings 
               FROM business_template_assignments 
               WHERE business_id = $1 AND document_type = $2 AND template_id = $3
               LIMIT 1`,
              [data.business.id, assignment.document_type, providedTemplateId]
            );
            
            if (specificAssignment && specificAssignment.settings) {
              // Use settings for the provided template
              savedSettings = typeof specificAssignment.settings === 'string' 
                ? JSON.parse(specificAssignment.settings) 
                : specificAssignment.settings;
            } else {
              // CRITICAL FIX: Don't use settings from a different template!
              // Clear savedSettings so we use defaults for the requested template
              savedSettings = null;
            }
          }
        }
      } catch (dbError) {
        console.error('[Preview API] ❌ Database error:', dbError);
      }
    }

    // 3. Finalize template ID (Priority: provided templateId > assigned template > export > default)
    
    if (!templateId) {
      if (assignedTemplateId) {
        templateId = assignedTemplateId;
      } else if (data.invoice?.is_export) {
        templateId = 'export_invoice';
      } else {
        templateId = 'gst_standard';
      }
    }

    // 3. Merge all settings levels
    const defaults = getDefaultTemplateSettings(templateId);
    
    let finalSettings = defaults;
    if (savedSettings) {
      finalSettings = mergeTemplateSettings(savedSettings, finalSettings);
    }
    
    if (data.settings) {
      finalSettings = mergeTemplateSettings(data.settings, finalSettings);
    }
    
    
    // 4. Transform data using the unified Presenter
    // NOTE: prepareInvoiceForRendering expects settings as SECOND parameter, not inside data!
    if (!data || !data.invoice) {
      return NextResponse.json({ error: 'Invalid data structure' }, { status: 400 });
    }
    const renderData = await prepareInvoiceForRendering(data, finalSettings);

    
    try {
      const renderer = new InvoiceRenderer();
      let html = await renderer.renderHtml(templateId, renderData);
      html = await finalizePrintHtml(
        html,
        templateId,
        finalSettings,
        data.business?.id || ''
      );
      html = injectThermalScreenPreviewCss(html, templateId);

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
