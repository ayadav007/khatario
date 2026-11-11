import { getFeatureDisplayName, hasFeatureLabel } from '@/lib/feature-upgrade-labels';
import type { UpgradeRequest } from './upgrade-request';

/** Cheapest plan that unlocks the request, from /api/subscriptions/feature-plan or limit-plan. */
export interface RecommendedPlan {
  planId: string;
  planLabel: string;
  priceMonthly: number;
  /** Limit on that plan for a limit request (-1 = unlimited). */
  planLimit?: number;
}

export type UpgradeArtObject = 'bill' | 'users' | 'chat' | 'cal' | 'laptop';
export type UpgradeBadge = 'lock' | 'full' | 'plus' | 'clock';
export type UpgradeIcon = 'chart' | 'rupee' | 'users' | 'lock' | 'chat' | 'bolt' | 'clock' | 'check' | 'phone' | 'box';

export interface UpgradeChip {
  icon: UpgradeIcon;
  title: string;
  subtitle: string;
}

/** Everything the web dialog and the phone sheet print, so both say exactly the same thing. */
export interface UpgradeCopy {
  tag: string;
  title: string;
  body: string;
  object: UpgradeArtObject;
  badge: UpgradeBadge;
  chips: [UpgradeChip, UpgradeChip];
  tiles: [UpgradeIcon, UpgradeIcon];
  /** Fixed benefit lines; empty means the dialog shows the recommended plan's own highlights. */
  benefits: string[];
  ctaLabel: string;
  laterLabel: string;
  closable: boolean;
}

/** How each server limit reads in a sentence. `period` null = a running total, not a quota. */
export const LIMIT_NOUNS: Record<string, { noun: string; one: string; period: 'month' | 'day' | null }> = {
  invoices: { noun: 'invoices', one: 'invoice', period: 'month' },
  customers: { noun: 'customers', one: 'customer', period: null },
  items: { noun: 'items', one: 'item', period: null },
  users: { noun: 'users', one: 'user', period: null },
  connect_agents: { noun: 'inbox seats', one: 'inbox seat', period: null },
  whatsapp: { noun: 'WhatsApp messages', one: 'WhatsApp message', period: 'day' },
  employees: { noun: 'employees', one: 'employee', period: null },
  attendance: { noun: 'attendance records', one: 'attendance record', period: 'month' },
  leave_requests: { noun: 'leave requests', one: 'leave request', period: 'month' },
  payroll: { noun: 'payroll records', one: 'payroll record', period: 'month' },
  suppliers: { noun: 'suppliers', one: 'supplier', period: null },
  purchases: { noun: 'purchases', one: 'purchase', period: 'month' },
  expenses: { noun: 'expenses', one: 'expense', period: 'month' },
  estimates: { noun: 'estimates', one: 'estimate', period: 'month' },
  credit_notes: { noun: 'credit notes', one: 'credit note', period: 'month' },
  sales_orders: { noun: 'sales orders', one: 'sales order', period: 'month' },
  purchase_orders: { noun: 'purchase orders', one: 'purchase order', period: 'month' },
  branches: { noun: 'branches', one: 'branch', period: null },
  departments: { noun: 'departments', one: 'department', period: null },
  email: { noun: 'emails', one: 'email', period: 'day' },
  salary_advances: { noun: 'salary advances', one: 'salary advance', period: null },
  employee_expenses: { noun: 'staff expenses', one: 'staff expense', period: null },
  commissions: { noun: 'commissions', one: 'commission', period: null },
  employee_tasks: { noun: 'staff tasks', one: 'staff task', period: null },
  holidays: { noun: 'holidays', one: 'holiday', period: null },
  shifts: { noun: 'shifts', one: 'shift', period: null },
  designations: { noun: 'designations', one: 'designation', period: null },
  performance_reviews: { noun: 'performance reviews', one: 'performance review', period: null },
};

const SAFE = 'Everything you\'ve made stays as it is.';

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function featureName(req: UpgradeRequest): string | null {
  if (req.featureName?.trim()) return req.featureName.trim();
  return req.featureKey?.trim() ? getFeatureDisplayName(req.featureKey) : null;
}

function upgradeCta(plan: RecommendedPlan | null): string {
  return plan ? `Upgrade to ${plan.planLabel}` : 'See plans';
}

function limitOnPlan(plan: RecommendedPlan | null, noun: string): string {
  if (!plan) return 'More on a higher plan';
  if (plan.planLimit === undefined || plan.planLimit === -1) return `Unlimited on ${plan.planLabel}`;
  return `${plan.planLimit} ${noun} on ${plan.planLabel}`;
}

/** The popup's words and picture for one request (docs/plan/UNIFIED_UPGRADE_POPUP.md, Design). */
export function buildUpgradeCopy(req: UpgradeRequest, plan: RecommendedPlan | null): UpgradeCopy {
  switch (req.variant) {
    case 'limit': {
      const nouns = req.limitType ? LIMIT_NOUNS[req.limitType] : undefined;
      const limit = req.limit;
      let title = "Sorry, you've reached your plan's limit";
      if (nouns && limit !== undefined && limit >= 0) {
        if (req.limitType === 'users' || req.limitType === 'connect_agents') {
          title = `Sorry, your plan has room for ${plural(limit, nouns.one, nouns.noun)}`;
        } else {
          const when = nouns.period === 'month' ? ' this month' : nouns.period === 'day' ? ' today' : '';
          title = `Sorry, you've used all ${limit} ${limit === 1 ? nouns.one : nouns.noun}${when}`;
        }
      }
      const people = req.limitType === 'users' || req.limitType === 'employees' || req.limitType === 'connect_agents';
      const reopens = nouns?.period === 'month' ? ' It opens again next month, or upgrade to keep going today.' : '';
      return {
        tag: 'Limit reached',
        title,
        body: `${SAFE}${reopens}`,
        object: people ? 'users' : 'bill',
        badge: 'full',
        chips: [
          { icon: people ? 'users' : 'chart', title: nouns ? capitalise(nouns.noun) : 'More room', subtitle: limitOnPlan(plan, nouns?.noun ?? '') },
          {
            icon: 'lock',
            title: req.current !== undefined && limit !== undefined ? `${req.current} of ${limit} used` : 'Limit reached',
            subtitle: 'On your plan',
          },
        ],
        tiles: ['chart', 'rupee'],
        benefits: [],
        ctaLabel: upgradeCta(plan),
        laterLabel: 'Maybe later',
        closable: true,
      };
    }
    case 'addon': {
      const named = featureName(req);
      const name = named && !/connect/i.test(named) ? named : 'this';
      return {
        tag: 'Add-on',
        title: `Sorry, ${name} needs Khatario Connect`,
        body: `Connect is an add-on that works with any plan. Your billing stays exactly as it is.`,
        object: 'chat',
        badge: 'plus',
        chips: [
          { icon: 'chat', title: 'Shared inbox', subtitle: 'For your team' },
          { icon: 'bolt', title: 'Auto replies', subtitle: 'WhatsApp bot' },
        ],
        tiles: ['users', 'check'],
        benefits: ['One shared inbox for your team', 'Auto replies and a WhatsApp bot', 'Campaigns on your own number'],
        ctaLabel: 'Add Khatario Connect',
        laterLabel: 'Maybe later',
        closable: true,
      };
    }
    case 'trial': {
      const days = req.trialDaysLeft ?? 0;
      const title =
        days < 0
          ? 'Your free trial has ended'
          : days === 0
            ? 'Your free trial ends today'
            : `Your free trial ends in ${plural(days, 'day', 'days')}`;
      return {
        tag: 'Trial',
        title,
        body:
          days < 0
            ? 'Pick a plan to get every feature back. Your data stays safe.'
            : 'Pick a plan now so nothing stops. If you don\'t, the business moves to Free and your data stays safe.',
        object: 'cal',
        badge: 'clock',
        chips: [
          { icon: 'clock', title: days < 0 ? 'Trial ended' : `${plural(Math.max(days, 0), 'day', 'days')} left`, subtitle: req.trialEndsOn ? `Ends ${req.trialEndsOn}` : 'Free trial' },
          { icon: 'check', title: 'Data stays safe', subtitle: 'Always' },
        ],
        tiles: ['rupee', 'box'],
        benefits: [],
        ctaLabel: 'Choose a plan',
        laterLabel: 'Remind me tomorrow',
        closable: true,
      };
    }
    case 'web':
      return {
        tag: 'Phone-only plan',
        title: "Sorry, Khatario Free doesn't open on a computer",
        body: 'Free stays free forever in the Android app. Upgrade to bill on this computer too. Your data stays safe.',
        object: 'laptop',
        badge: 'lock',
        chips: [
          { icon: 'phone', title: 'Android app', subtitle: 'Free forever' },
          { icon: 'lock', title: 'This computer', subtitle: 'Needs a plan' },
        ],
        tiles: ['check', 'rupee'],
        benefits: [],
        ctaLabel: upgradeCta(plan),
        laterLabel: 'Sign out',
        closable: false,
      };
    case 'feature':
    default: {
      const name = featureName(req);
      return {
        tag: 'Not in your plan',
        title: `Sorry, ${name ?? 'this feature'} isn't in your plan`,
        body: plan ? `It comes with ${plan.planLabel}. ${SAFE}` : SAFE,
        object: 'bill',
        badge: 'lock',
        chips: [
          { icon: 'chart', title: name ?? 'More features', subtitle: 'Unlock it today' },
          { icon: 'rupee', title: plan ? `With ${plan.planLabel}` : 'On a higher plan', subtitle: plan ? `₹${plan.priceMonthly}/month` : 'See plans' },
        ],
        tiles: ['box', 'users'],
        benefits: [],
        ctaLabel: upgradeCta(plan),
        laterLabel: 'Maybe later',
        closable: true,
      };
    }
  }
}

/** "{Plan} also gives you": features the plan adds, the one they asked for first. */
export function planBenefitLines(
  planFeatureIds: string[],
  enabledIds: string[],
  featureKey?: string,
  max = 3,
): string[] {
  const have = new Set(enabledIds);
  const added = planFeatureIds.filter((id) => !have.has(id) && hasFeatureLabel(id));
  const ordered = featureKey && added.includes(featureKey) ? [featureKey, ...added.filter((id) => id !== featureKey)] : added;
  return ordered.slice(0, max).map((id) => getFeatureDisplayName(id));
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
