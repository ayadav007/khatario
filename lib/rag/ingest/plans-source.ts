import { queryRows } from '@/lib/db';
import { listActiveSubscriptionPlans } from '@/lib/subscription/list-plans';
import { CONNECT_FREE_PLAN_ID, PRODUCT_LINE_LABELS, normalizeProductLine } from '@/lib/product-lines';
import { WHATSAPP_ADDON_LABELS, WHATSAPP_ADDON_PRICING } from '@/lib/platform-addon-checkout';
import { getPublicSupportConfig } from '@/lib/marketing-public-config';
import type { KbSourceInput } from '../types';
import { HR_COMING_SOON, HR_LAUNCHED } from '../product-availability';

export const PLANS_LOCATOR = 'subscription_plans';

const LIMIT_LABELS: Record<string, string> = {
  max_invoices_per_month: 'Invoices per month',
  max_customers: 'Customers',
  max_items: 'Items (products and services)',
  max_users: 'Team users',
  max_whatsapp_per_day: 'WhatsApp messages per day',
  max_email_per_day: 'Emails per day',
  max_suppliers: 'Suppliers',
  max_purchases_per_month: 'Purchase bills per month',
  max_expenses_per_month: 'Expenses per month',
  max_estimates_per_month: 'Estimates / quotations per month',
  max_credit_notes_per_month: 'Credit notes per month',
  max_sales_orders_per_month: 'Sales orders per month',
  max_purchase_orders_per_month: 'Purchase orders per month',
  max_branches: 'Branches',
  max_employees: 'Employees',
  max_departments: 'Departments',
  max_designations: 'Designations',
  max_shifts: 'Shifts',
  max_holidays: 'Holidays',
  max_attendance_records_per_month: 'Attendance records per month',
  max_leave_requests_per_month: 'Leave requests per month',
  max_payroll_records_per_month: 'Payroll records per month',
  max_salary_advances_per_month: 'Salary advances per month',
  max_employee_expenses_per_month: 'Employee expense claims per month',
  max_commissions_per_month: 'Commissions per month',
  max_employee_tasks_per_month: 'Employee tasks per month',
  max_performance_reviews_per_month: 'Performance reviews per month',
};

const CATEGORY_LABELS: Record<string, string> = { hr: 'HR', gst: 'GST', crm: 'CRM' };

type PlanRow = {
  id: string;
  name: string;
  display_name: string;
  description: string | null;
  price_monthly: string | number | null;
  price_yearly: string | number | null;
  price_3year?: string | number | null;
  currency: string | null;
  product_line: string | null;
  features: {
    limits?: Record<string, number>;
    features?: Record<string, boolean>;
    trial_days?: number;
  } & Record<string, unknown>;
};

function inr(amount: number, currency: string): string {
  const symbol = currency === 'INR' ? '₹' : `${currency} `;
  return `${symbol}${amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function priceLine(plan: PlanRow): string {
  const currency = plan.currency || 'INR';
  const monthly = Number(plan.price_monthly ?? 0);
  const yearly = Number(plan.price_yearly ?? 0);
  const isTrial = /trial/i.test(`${plan.id} ${plan.name}`);
  if (!monthly && !yearly) return isTrial ? 'Price: Free during the trial period.' : 'Price: Free (₹0).';
  const parts: string[] = [];
  if (monthly) parts.push(`${inr(monthly, currency)} per month`);
  if (yearly) {
    const saving = monthly ? Math.round((1 - yearly / (monthly * 12)) * 100) : 0;
    parts.push(`${inr(yearly, currency)} per year${saving > 0 ? ` (about ${saving}% less than paying monthly)` : ''}`);
  }
  const threeYear = Number(plan.price_3year ?? 0);
  if (threeYear) parts.push(`${inr(threeYear, currency)} for 3 years`);
  return `Price: ${parts.join(', or ')}.`;
}

function limitValue(value: number): string {
  if (value === -1) return 'Unlimited';
  if (value === 0) return 'Not included';
  return value.toLocaleString('en-IN');
}

/** Live plan facts rendered as markdown; the assistant must only quote prices from this document. */
export async function buildPlansMarkdown(): Promise<string> {
  const plans = ((await listActiveSubscriptionPlans()) as unknown as PlanRow[]).filter(
    (p) => p.id !== CONNECT_FREE_PLAN_ID && (HR_LAUNCHED || normalizeProductLine(p.product_line) !== 'hr'),
  );
  const featureRows = await queryRows<{ id: string; label: string; category: string }>(
    `SELECT id, label, category FROM platform_features WHERE is_active = true`,
  ).catch(() => [] as Array<{ id: string; label: string; category: string }>);
  const featureById = new Map(featureRows.map((f) => [f.id, f]));

  const lines: string[] = [
    '# Khatario plans and pricing',
    '',
    'These are the plans currently offered on Khatario, taken directly from the live plan settings. ' +
      'Always quote prices and limits exactly as written here. Plans can change, so the pricing section on khatario.com is the final reference.',
    '',
    '## Plan price summary',
    '',
  ];

  for (const plan of plans) {
    const line = PRODUCT_LINE_LABELS[normalizeProductLine(plan.product_line)];
    lines.push(`- ${plan.display_name} (${line}): ${priceLine(plan).replace(/^Price: /, '')}`);
  }
  if (!HR_LAUNCHED) lines.push(`- Khatario HR: coming soon, no plans or prices yet. ${HR_COMING_SOON}`);
  lines.push('');

  for (const plan of plans) {
    const productLine = PRODUCT_LINE_LABELS[normalizeProductLine(plan.product_line)];
    lines.push(`## ${plan.display_name} plan (${productLine})`, '');
    if (plan.description) lines.push(plan.description.trim(), '');
    lines.push(priceLine(plan));
    if (typeof plan.features?.trial_days === 'number' && plan.features.trial_days > 0) {
      lines.push(`Free trial: ${plan.features.trial_days} days.`);
    }
    lines.push('');

    const limits = Object.entries(plan.features?.limits ?? {}).filter(([key]) => LIMIT_LABELS[key]);
    if (limits.length) {
      lines.push(`### ${plan.display_name} plan limits`, '');
      for (const [key, value] of limits.sort(([a], [b]) => a.localeCompare(b))) {
        lines.push(`- ${LIMIT_LABELS[key]}: ${limitValue(Number(value))}`);
      }
      lines.push('');
    }

    const enabled = Object.entries(plan.features?.features ?? {})
      .filter(([, on]) => on === true)
      .map(([id]) => featureById.get(id))
      .filter((f): f is { id: string; label: string; category: string } => Boolean(f));
    if (enabled.length) {
      lines.push(`### ${plan.display_name} plan features`, '');
      const byCategory = new Map<string, string[]>();
      for (const f of enabled) {
        const list = byCategory.get(f.category) ?? [];
        list.push(f.label);
        byCategory.set(f.category, list);
      }
      for (const [category, labels] of Array.from(byCategory.entries()).sort()) {
        const name = CATEGORY_LABELS[category] ?? category.charAt(0).toUpperCase() + category.slice(1);
        lines.push(`- ${name}: ${labels.sort().join(', ')}`);
      }
      lines.push('');
    }
  }

  lines.push(
    '## WhatsApp on Khatario',
    '',
    '- Every billing plan, including Free, can link a WhatsApp number by QR code to send invoices and payment reminders. ' +
      'Automatic scheduled payment reminders start on the Growth plan.',
    '- The Connect plan is a paid add-on for the official WhatsApp Business API: your own WhatsApp Business number, ' +
      'the shared team inbox, the AI agent, Meta-approved templates, campaigns, automation and the WhatsApp shop.',
    '- Connect includes its own WhatsApp agent seats, separate from billing plan users. Owners add agents under ' +
      'Settings → WhatsApp → Agents. Agents can chat with customers and view customers, items, invoices and orders, ' +
      'but cannot create or edit them or see purchases and accounts. A person can be moved between Billing users and WhatsApp agents.',
    `- Extra AI replies beyond the Connect allowance: ${WHATSAPP_ADDON_LABELS.khatario_ai} top-up at ${inr(WHATSAPP_ADDON_PRICING.khatario_ai, 'INR')} per month (requires Connect).`,
    '',
  );

  return lines.join('\n').trim() + '\n';
}

export function buildSupportMarkdown(): string {
  const support = getPublicSupportConfig();
  const lines = [
    '# Contact Khatario support',
    '',
    '## How to reach the Khatario team',
    '',
  ];
  if (support.email) lines.push(`- Email: ${support.email}`);
  if (support.whatsappUrl) lines.push(`- WhatsApp: ${support.whatsappUrl}`);
  lines.push(`- Support hours: ${support.hours}`);
  lines.push('- Book a free live demo at https://khatario.com/book-demo to talk to the team on a call.');
  lines.push('- Guides and how-tos are available at https://khatario.com/guides.');
  return lines.join('\n') + '\n';
}

export async function loadPlansSource(): Promise<KbSourceInput> {
  const body = await buildPlansMarkdown();
  return {
    kind: 'plans',
    locator: PLANS_LOCATOR,
    audiences: ['prospect', 'tenant_user'],
    businessId: null,
    documents: [
      {
        docKey: 'plans',
        title: 'Khatario plans and pricing',
        url: '/#pricing',
        audiences: ['prospect', 'tenant_user'],
        locale: 'en',
        tags: ['pricing', 'plans', 'limits'],
        requiredFeature: null,
        body,
      },
      {
        docKey: 'support-contact',
        title: 'Contact Khatario support',
        url: '/book-demo',
        audiences: ['prospect', 'tenant_user'],
        locale: 'en',
        tags: ['support', 'contact'],
        requiredFeature: null,
        body: buildSupportMarkdown(),
      },
    ],
  };
}
