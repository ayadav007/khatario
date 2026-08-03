/**
 * Product lines: Billing, HR, Connect (WhatsApp).
 * One codebase — different signup entry, default plan, and nav profile.
 */

export const PRODUCT_LINES = ['billing', 'hr', 'connect'] as const;
export type ProductLine = (typeof PRODUCT_LINES)[number];

export const PRODUCT_LINE_LABELS: Record<ProductLine, string> = {
  billing: 'Billing',
  hr: 'HR',
  connect: 'Connect',
};

export const PRODUCT_LINE_DESCRIPTIONS: Record<ProductLine, string> = {
  billing: 'GST invoicing, inventory, purchases, and reports for Indian shops.',
  hr: 'Employees, attendance, payroll, and leave — without the billing suite.',
  connect: 'WhatsApp CRM, bot, and messaging — pay only for the add-ons you need.',
};

export const LANDING_HERO_COPY: Record<
  ProductLine,
  { badges: string[]; headline: string; subhead: string; cta: string; footnote: string }
> = {
  billing: {
    badges: ['GST-ready invoicing', 'Made for India'],
    headline: 'Still billing by hand at closing time? There is a simpler way.',
    subhead:
      'Khatario turns your counter into one simple flow: bill with correct GST, share on WhatsApp, track who has paid, and file reports — without wrestling spreadsheets or the CA at midnight.',
    cta: 'Start Billing trial',
    footnote: 'No credit card to start · Works on phone & computer',
  },
  hr: {
    badges: ['Attendance & payroll', 'Made for India'],
    headline: 'HR on spreadsheets and registers? There is a simpler way.',
    subhead:
      'Track employees, daily attendance, payroll, and leave in one place — without buying the full billing suite.',
    cta: 'Start HR trial',
    footnote: '30-day HR Pro trial · No credit card to start',
  },
  connect: {
    badges: ['WhatsApp CRM', 'No platform fee'],
    headline: 'Customers on WhatsApp, replies all over the place? There is a simpler way.',
    subhead:
      'Run conversations, bot rules, and outbound messages from one inbox. Pay only for the WhatsApp add-ons you enable.',
    cta: 'Create free Connect account',
    footnote: 'Free platform · Bot & Send Message add-ons when you need them',
  },
};

export const HR_TRIAL_PLAN_ID = 'hr_trial' as const;
export const HR_FREE_PLAN_ID = 'hr_free' as const;
export const CONNECT_PLAN_ID = 'connect' as const;

/** Top-level sidebar sections hidden per product line (label match). */
export const HIDDEN_NAV_LABELS_BY_PRODUCT_LINE: Record<ProductLine, Set<string>> = {
  billing: new Set(),
  hr: new Set(['Sales', 'Purchases', 'Inventory', 'Accounting', 'Reports', 'Supplier']),
  connect: new Set([
    'Sales',
    'Purchases',
    'Inventory',
    'Accounting',
    'Reports',
    'Supplier',
    'HR & Employees',
  ]),
};

export function normalizeProductLine(value: unknown): ProductLine {
  if (typeof value === 'string' && PRODUCT_LINES.includes(value as ProductLine)) {
    return value as ProductLine;
  }
  return 'billing';
}

export function getSignupHref(productLine: ProductLine): string {
  return `/signup?product=${productLine}`;
}

export interface SignupPlanConfig {
  productLine: ProductLine;
  planId: string;
  status: 'trial' | 'active';
  trialDays: number | null;
  postTrialPlanId: string;
}

export function getSignupPlanConfig(productLine: ProductLine): SignupPlanConfig {
  switch (productLine) {
    case 'hr':
      return {
        productLine: 'hr',
        planId: HR_TRIAL_PLAN_ID,
        status: 'trial',
        trialDays: 30,
        postTrialPlanId: HR_FREE_PLAN_ID,
      };
    case 'connect':
      return {
        productLine: 'connect',
        planId: CONNECT_PLAN_ID,
        status: 'active',
        trialDays: null,
        postTrialPlanId: CONNECT_PLAN_ID,
      };
    default:
      return {
        productLine: 'billing',
        planId: 'trial',
        status: 'trial',
        trialDays: 30,
        postTrialPlanId: 'free',
      };
  }
}

/** Plan id after calendar trial expiry (entitlement enforcement). */
export function getPostTrialFreePlanId(productLine: ProductLine): string {
  return getSignupPlanConfig(productLine).postTrialPlanId;
}

export function isProductLineTrialPlanId(planId: string | null | undefined): boolean {
  return planId === 'trial' || planId === HR_TRIAL_PLAN_ID;
}

export function isNavSectionHiddenForProductLine(
  sectionLabel: string,
  productLine: ProductLine | null | undefined,
): boolean {
  const line = normalizeProductLine(productLine ?? 'billing');
  return HIDDEN_NAV_LABELS_BY_PRODUCT_LINE[line].has(sectionLabel);
}
