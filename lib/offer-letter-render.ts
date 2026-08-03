import * as db from '@/lib/db';
import Handlebars from 'handlebars';
import fs from 'fs';
import {
  applyOfferLetterTextSettings,
  getOfferLetterTemplateSettings,
  parseOfferLetterTemplateSettings,
  type OfferLetterTemplateSettings,
} from '@/lib/hr/offer-letter-template-settings';
import {
  DEFAULT_OFFER_LETTER_TEMPLATE_ID,
  isValidOfferLetterTemplateId,
} from '@/lib/offer-letter-template-registry';
import { resolveOfferLetterTemplatePath } from '@/lib/offer-letter-template-path';

let helpersRegistered = false;

function registerHelpers() {
  if (helpersRegistered) return;
  Handlebars.registerHelper('formatCurrency', (value: unknown) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return '0.00';
    return num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  });
  helpersRegistered = true;
}

export function annual(monthly: number): number {
  return Math.round(monthly * 12 * 100) / 100;
}

export function formatInr(amount: number): string {
  return amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatOfferDate(d: string | Date | null | undefined): string {
  if (!d) return '';
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export type OfferLetterViewModel = {
  business: {
    name: string;
    address: string;
    logo_url: string | null;
    signature_url: string | null;
    cin: string | null;
  };
  candidate: {
    full_name: string;
    signature_url: string | null;
    accepted_date: string | null;
  };
  offer: {
    designation: string;
    department: string | null;
    work_location: string | null;
    joining_date: string;
    probation_months: number;
    annual_bonus: string | null;
    basic_salary_annual: string;
    hra_annual: string | null;
    transport_annual: string | null;
    medical_annual: string | null;
    special_annual: string | null;
    other_annual: string | null;
    ctc_annual: string;
    terms_text: string | null;
  };
  signatory: {
    name: string;
    title: string;
  };
  settings: OfferLetterTemplateSettings;
};

export function compileOfferLetterHtml(templateId: string, model: OfferLetterViewModel): string {
  registerHelpers();
  const templatePath = resolveOfferLetterTemplatePath(templateId);
  const templateSource = fs.readFileSync(templatePath, 'utf-8');
  const template = Handlebars.compile(templateSource);
  return template(model);
}

function buildSalaryAnnualFields(basic: number, hra: number, transport: number, medical: number, special: number, other: number) {
  const monthlyCtc = basic + hra + transport + medical + special + other;
  return {
    basic_salary_annual: formatInr(annual(basic)),
    hra_annual: hra ? formatInr(annual(hra)) : null,
    transport_annual: transport ? formatInr(annual(transport)) : null,
    medical_annual: medical ? formatInr(annual(medical)) : null,
    special_annual: special ? formatInr(annual(special)) : null,
    other_annual: other ? formatInr(annual(other)) : null,
    ctc_annual: formatInr(annual(monthlyCtc)),
  };
}

export function buildViewModelFromOfferRow(
  row: {
    designation: string;
    department: string | null;
    joining_date: string;
    probation_months: number | null;
    work_location: string | null;
    annual_bonus: string | null;
    notice_period_days: number | null;
    basic_salary: string;
    hra: string | null;
    transport_allowance: string | null;
    medical_allowance: string | null;
    special_allowance: string | null;
    other_allowances: string | null;
    terms_text: string | null;
    signatory_name: string | null;
    signatory_title: string | null;
    candidate_signature_url: string | null;
    accepted_at: string | null;
    candidate_name: string;
    business_name: string;
    business_address: string;
    business_logo: string | null;
    business_signature: string | null;
  },
  rawSettings: OfferLetterTemplateSettings,
): OfferLetterViewModel {
  const basic = Number(row.basic_salary);
  const hra = Number(row.hra ?? 0);
  const transport = Number(row.transport_allowance ?? 0);
  const medical = Number(row.medical_allowance ?? 0);
  const special = Number(row.special_allowance ?? 0);
  const other = Number(row.other_allowances ?? 0);

  const textVars: Record<string, string> = {
    'business.name': row.business_name,
    'offer.probation_months': String(row.probation_months ?? 0),
    'offer.notice_period_days': String(row.notice_period_days ?? 30),
  };
  const settings = applyOfferLetterTextSettings(rawSettings, textVars);

  const signatoryName =
    row.signatory_name?.trim() ||
    settings.authorized_signatory_name?.trim() ||
    row.business_name;
  const signatoryTitle = row.signatory_title?.trim() || settings.authorized_signatory_title;

  return {
    business: {
      name: row.business_name,
      address: row.business_address,
      logo_url: row.business_logo,
      signature_url: row.business_signature,
      cin: null,
    },
    candidate: {
      full_name: row.candidate_name,
      signature_url: row.candidate_signature_url,
      accepted_date: row.accepted_at ? formatOfferDate(row.accepted_at) : null,
    },
    offer: {
      designation: row.designation,
      department: row.department,
      work_location: row.work_location,
      joining_date: formatOfferDate(row.joining_date),
      probation_months: row.probation_months ?? 0,
      annual_bonus: row.annual_bonus ? formatInr(Number(row.annual_bonus)) : null,
      terms_text: row.terms_text,
      ...buildSalaryAnnualFields(basic, hra, transport, medical, special, other),
    },
    signatory: {
      name: signatoryName,
      title: signatoryTitle,
    },
    settings,
  };
}

/** Sample data for settings-page preview (uses real business branding when available). */
export async function buildOfferLetterPreviewModel(
  businessId: string,
  options?: {
    settingsOverride?: OfferLetterTemplateSettings;
    templateIdOverride?: string;
  },
): Promise<{ template_id: string; model: OfferLetterViewModel }> {
  const stored = await getOfferLetterTemplateSettings(businessId);
  const rawSettings = options?.settingsOverride ?? stored.settings;
  const template_id =
    options?.templateIdOverride && isValidOfferLetterTemplateId(options.templateIdOverride)
      ? options.templateIdOverride
      : stored.template_id || DEFAULT_OFFER_LETTER_TEMPLATE_ID;

  const business = await db.queryOne<{
    name: string;
    business_address: string;
    logo_url: string | null;
    signature_url: string | null;
  }>(
    `SELECT name, logo_url, signature_url,
      CONCAT(
        COALESCE(address_line1, ''),
        CASE WHEN address_line2 IS NOT NULL THEN ', ' || address_line2 ELSE '' END,
        CASE WHEN city IS NOT NULL THEN ', ' || city ELSE '' END,
        CASE WHEN state IS NOT NULL THEN ', ' || state ELSE '' END,
        CASE WHEN pincode IS NOT NULL THEN ' - ' || pincode ELSE '' END
      ) AS business_address
     FROM businesses WHERE id = $1`,
    [businessId],
  );

  const businessName = business?.name ?? 'Your Company Pvt. Ltd.';
  const probationMonths = 3;
  const noticeDays = 30;

  const textVars: Record<string, string> = {
    'business.name': businessName,
    'offer.probation_months': String(probationMonths),
    'offer.notice_period_days': String(noticeDays),
  };
  const settings = applyOfferLetterTextSettings(parseOfferLetterTemplateSettings(rawSettings), textVars);

  const signatoryName = settings.authorized_signatory_name?.trim() || businessName;

  const basic = 75000;
  const hra = 30000;
  const transport = 1600;
  const medical = 1250;
  const special = 42150;

  return {
    template_id: stored.template_id,
    model: {
      business: {
        name: businessName,
        address: business?.business_address || 'Bengaluru, Karnataka',
        logo_url: business?.logo_url ?? null,
        signature_url: business?.signature_url ?? null,
        cin: null,
      },
      candidate: {
        full_name: 'PRIYA SHARMA',
        signature_url: null,
        accepted_date: null,
      },
      offer: {
        designation: 'Senior Software Engineer',
        department: 'Engineering',
        work_location: 'Bengaluru',
        joining_date: formatOfferDate(new Date(Date.now() + 90 * 86400000)),
        probation_months: probationMonths,
        annual_bonus: formatInr(100000),
        terms_text: null,
        ...buildSalaryAnnualFields(basic, hra, transport, medical, special, 0),
      },
      signatory: {
        name: signatoryName,
        title: settings.authorized_signatory_title,
      },
      settings,
    },
  };
}

export async function generateOfferLetterPreviewHtml(
  businessId: string,
  options?: {
    settingsOverride?: OfferLetterTemplateSettings;
    templateIdOverride?: string;
  },
): Promise<string> {
  const { template_id, model } = await buildOfferLetterPreviewModel(businessId, options);
  return compileOfferLetterHtml(template_id, model);
}
