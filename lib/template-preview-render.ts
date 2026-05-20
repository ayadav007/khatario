import fs from 'fs';
import path from 'path';
import Handlebars from 'handlebars';
import { getDefaultTemplateSettings, mergeTemplateSettings } from '@/lib/template-defaults';
import { registerInvoiceHandlebarsPartials } from '@/lib/handlebars-invoice-partials';
import { registerGlobalInvoiceHandlebarsHelpers } from '@/lib/handlebars-invoice-helpers';
import { enrichInvoiceRenderData } from '@/lib/custom-fields-render';
import { finalizePrintHtml } from '@/lib/pdf-generator';
import { injectTemplateScreenPreviewCss } from '@/lib/template-screen-preview';

export const TEMPLATE_PREVIEW_PATHS: Record<string, string> = {
  gst_standard: 'templates/gst_standard/template.html',
  modern: 'templates/modern/template.html',
  classic: 'templates/classic/template.html',
  elegant: 'templates/elegant/template.html',
  minimal: 'templates/minimal/template.html',
  business_pro: 'templates/business_pro/template.html',
  tally_style: 'templates/tally_style/template.html',
  export_invoice: 'templates/export_invoice/template.html',
  gst_detailed: 'templates/gst_detailed/template.html',
  composition_standard: 'templates/bill_of_supply/composition_standard/template.html',
  composition_modern: 'templates/bill_of_supply/composition_modern/template.html',
  tax_exempt: 'templates/bill_of_supply/tax_exempt/template.html',
  credit_standard: 'templates/credit_note/standard/template.html',
  debit_standard: 'templates/debit_note/standard/template.html',
  challan_standard: 'templates/delivery_challan/standard/template.html',
  payment_receipt: 'templates/payment_receipt/template.html',
  thermal_58mm: 'templates/thermal_58mm/template.html',
  thermal_80mm: 'templates/thermal_80mm/template.html',
};

export type TemplatePreviewRenderInput = {
  templateId: string;
  businessId?: string | null;
  customSettings?: Record<string, unknown> | null;
  /** Sample data factory from route module */
  getSampleData: (templateId: string) => Record<string, unknown>;
};

async function loadBusinessPreviewAssets(businessId: string | null | undefined) {
  let businessLogoUrl: string | null = null;
  let bankDetails: {
    bank_name: string | null;
    account_number: string | null;
    ifsc_code: string | null;
    branch_name: string | null;
  } | null = null;

  if (!businessId) return { businessLogoUrl, bankDetails };

  try {
    const { queryOne } = await import('@/lib/db');

    const business = await queryOne<{ logo_url: string | null }>(
      'SELECT logo_url FROM businesses WHERE id = $1',
      [businessId]
    );
    if (business) {
      businessLogoUrl = business.logo_url;
    }

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
        branch_name: bankAccount.branch_name || null,
      };
    }
  } catch (error) {
    console.error('[Template preview] Error fetching business data:', error);
  }

  return { businessLogoUrl, bankDetails };
}

/**
 * Renders template HTML for customize iframe — same print pipeline as invoice PDF + screen CSS.
 */
export async function renderTemplatePreviewHtml(
  input: TemplatePreviewRenderInput
): Promise<string> {
  const { templateId, businessId, customSettings, getSampleData } = input;

  const templatePath = TEMPLATE_PREVIEW_PATHS[templateId];
  if (!templatePath) {
    throw new Error(`Template "${templateId}" not found`);
  }

  const fullPath = path.join(process.cwd(), templatePath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Template file not found: ${templatePath}`);
  }

  const { businessLogoUrl, bankDetails } = await loadBusinessPreviewAssets(businessId ?? null);

  const templateHtml = fs.readFileSync(fullPath, 'utf-8');
  registerGlobalInvoiceHandlebarsHelpers();
  registerInvoiceHandlebarsPartials();
  const template = Handlebars.compile(templateHtml);
  const sampleData = getSampleData(templateId) as Record<string, any>;

  const defaults = getDefaultTemplateSettings(templateId);
  let finalSettings = defaults;
  if (customSettings) {
    finalSettings = mergeTemplateSettings(customSettings, defaults);
  }

  const finalRecord = finalSettings as unknown as Record<string, unknown>;
  const defaultsRecord = defaults as unknown as Record<string, unknown>;
  Object.keys(finalRecord).forEach((key: string) => {
    if (key.startsWith('show_') && finalRecord[key] === undefined) {
      finalRecord[key] = defaultsRecord[key] !== undefined ? defaultsRecord[key] : true;
    }
  });

  if (businessLogoUrl) {
    (sampleData.business as Record<string, unknown>).logo_url = businessLogoUrl;
  }

  if (bankDetails) {
    const biz = sampleData.business as Record<string, unknown>;
    biz.bank_name = bankDetails.bank_name ?? '';
    biz.account_number = bankDetails.account_number ?? '';
    biz.ifsc_code = bankDetails.ifsc_code ?? '';
    biz.branch_name = bankDetails.branch_name ?? '';
  }

  let data: Record<string, unknown> = {
    ...sampleData,
    settings: finalSettings,
    business: { ...(sampleData.business as object), id: businessId || undefined },
  };

  if (businessId) {
    data = (await enrichInvoiceRenderData(data as Parameters<typeof enrichInvoiceRenderData>[0])) as Record<
      string,
      unknown
    >;
  }

  const renderedHtml = template(data);
  const settingsRecord = finalRecord;

  let html = await finalizePrintHtml(
    renderedHtml,
    templateId,
    finalSettings,
    businessId || ''
  );
  html = injectTemplateScreenPreviewCss(html, templateId, settingsRecord);

  return html;
}
