/**
 * GST Alert Center: the alert shape returned by /api/gst/compliance-alerts and how each check is
 * labelled. Group labels name the provision the check actually applies (lib/gst/compliance/checks.ts).
 */
export type Severity = 'info' | 'warning' | 'critical';
export type RcmDocument = 'purchase' | 'expense';

export type CheckId =
  | 'rule37'
  | 'itc_deadline'
  | 'credit_note_deadline'
  | 'gstr3b_due'
  | 'eway_bill'
  | 'einvoice'
  | 'rcm_self_invoice';

export interface Rule37Bill {
  purchase_id: string;
  bill_number: string | null;
  bill_date: string;
  supplier_name: string | null;
  unpaid: number;
  itc_at_stake: number;
  to_reverse?: number;
  interest_if_utilised?: number;
  days_outstanding: number;
}

export interface GstAlert {
  id: string;
  check_id: CheckId;
  alert_key: string;
  severity: Severity;
  stage: string;
  title: string;
  message: string;
  legal_ref: string;
  action_url: string | null;
  action_label: string | null;
  ask_question: string | null;
  due_date: string | null;
  amount: number | null;
  details: {
    bills?: Rule37Bill[];
    bill_count?: number;
    interest_if_utilised?: number;
    invoices?: Array<{ supplier_gstin: string; supplier_name: string | null; invoice_number: string; invoice_date: string; itc: number }>;
    sales?: Array<{ invoice_id: string; invoice_number: string; invoice_date: string; customer_name: string | null; grand_total: number }>;
    rcm_bills?: Array<{ purchase_id: string; document?: RcmDocument; bill_number: string | null; bill_date: string; supplier_name: string | null; self_invoice_by: string; tax: number }>;
    unverified?: Array<{ purchase_id: string; document?: RcmDocument; bill_number?: string | null; bill_date?: string; supplier_name?: string | null; tax?: number; message: string }>;
    period?: string;
    label?: string;
    can_mark_filed?: boolean;
  };
  first_seen_at: string;
  last_seen_at: string;
  resolved_at: string | null;
  notified_at: string | null;
  dismissed: boolean;
  dismissed_reason: string | null;
  dismissed_at: string | null;
  dismissed_by_name: string | null;
}

interface CheckMeta {
  /** Group heading in the list. */
  group: string;
  /** Chip on the detail panel. */
  chip: string;
  /** What `amount` means for this check; null when the check has no amount. */
  impact: string | null;
  /** Whether `amount` is credit the business can lose, so it counts towards "ITC at risk". */
  itc: boolean;
}

export const CHECK_ORDER: CheckId[] = [
  'rule37',
  'itc_deadline',
  'gstr3b_due',
  'rcm_self_invoice',
  'credit_note_deadline',
  'eway_bill',
  'einvoice',
];

export const CHECK_META: Record<CheckId, CheckMeta> = {
  rule37: { group: 'Rule 37 – Supplier bills unpaid for 180 days', chip: 'Rule 37 · ITC reversal', impact: 'ITC at risk', itc: true },
  itc_deadline: { group: "Section 16(4) – Last date for last year's ITC", chip: 'Section 16(4) · ITC time limit', impact: 'ITC to claim', itc: true },
  gstr3b_due: { group: 'GSTR-3B – Due dates and late fees', chip: 'GSTR-3B · Filing', impact: 'Late fee', itc: false },
  rcm_self_invoice: { group: 'Rule 47A – Reverse charge self-invoices', chip: 'Rule 47A · RCM self-invoice', impact: 'Tax payable under RCM', itc: false },
  credit_note_deadline: { group: 'Section 34(2) – Credit note time limit', chip: 'Section 34(2) · Credit notes', impact: null, itc: false },
  eway_bill: { group: 'E-way bills', chip: 'E-way bill', impact: 'Invoice value', itc: false },
  einvoice: { group: 'E-invoicing (IRN)', chip: 'E-invoicing', impact: 'Last FY turnover', itc: false },
};

export function checkMeta(id: string): CheckMeta {
  return CHECK_META[id as CheckId] ?? { group: 'Other GST checks', chip: 'GST', impact: null, itc: false };
}

export const SEVERITY_STYLE: Record<Severity, { label: string; pill: string; card: string; group: string; dot: string }> = {
  critical: {
    label: 'Act now',
    pill: 'bg-red-100 text-red-800',
    card: 'border-red-200 bg-red-50/70',
    group: 'bg-red-50 border-red-200',
    dot: 'bg-red-500',
  },
  warning: {
    label: 'Due soon',
    pill: 'bg-amber-100 text-amber-800',
    card: 'border-amber-200 bg-amber-50/70',
    group: 'bg-amber-50 border-amber-200',
    dot: 'bg-amber-500',
  },
  info: {
    label: 'Reminder',
    pill: 'bg-sky-100 text-sky-800',
    card: 'border-sky-200 bg-sky-50/60',
    group: 'bg-sky-50 border-sky-200',
    dot: 'bg-sky-500',
  },
};

export const SEVERITY_ORDER: Severity[] = ['critical', 'warning', 'info'];

export const DISMISS_REASONS = [
  'Already handled outside Khatario',
  'My CA is handling it',
  'Does not apply to my business',
];

export function inr(n: number | null | undefined) {
  return `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

export function dateLabel(iso: string) {
  return new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function dateTimeLabel(iso: string) {
  return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** "Due in 9 days", "Due today", "4 days late", or "Reverse now" for Rule 37 credit already past 180 days. */
export function dueLabel(a: GstAlert): { text: string; late: boolean } | null {
  if (a.alert_key === 'rule37:reversal_pending') return { text: 'Reverse now', late: true };
  if (!a.due_date) return null;
  const days = Math.round((Date.parse(`${a.due_date}T00:00:00`) - Date.parse(`${todayIso()}T00:00:00`)) / 86_400_000);
  if (days === 0) return { text: 'Due today', late: false };
  if (days < 0) return { text: `${-days} day${days === -1 ? '' : 's'} late`, late: true };
  return { text: `Due in ${days} day${days === 1 ? '' : 's'}`, late: false };
}

/** The documents an alert covers, as "3 bills · Prem Traders, ABC Distributors". */
export function documentSummary(a: GstAlert): string | null {
  const d = a.details;
  const parts: Array<{ n: number; one: string; many: string; names: Array<string | null | undefined> }> = [
    { n: d.bill_count ?? d.bills?.length ?? 0, one: 'bill', many: 'bills', names: (d.bills ?? []).map((b) => b.supplier_name) },
    { n: d.invoices?.length ?? 0, one: 'supplier invoice', many: 'supplier invoices', names: (d.invoices ?? []).map((i) => i.supplier_name || i.supplier_gstin) },
    { n: d.sales?.length ?? 0, one: 'invoice', many: 'invoices', names: (d.sales ?? []).map((s) => s.customer_name) },
    { n: d.rcm_bills?.length ?? 0, one: 'RCM supply', many: 'RCM supplies', names: (d.rcm_bills ?? []).map((b) => b.supplier_name) },
    { n: d.unverified?.length ?? 0, one: 'supply to check', many: 'supplies to check', names: (d.unverified ?? []).map((b) => b.supplier_name) },
  ];
  const found = parts.filter((p) => p.n > 0);
  if (!found.length) return d.label ?? null;
  const count = found.map((p) => `${p.n} ${p.n === 1 ? p.one : p.many}`).join(', ');
  const names = Array.from(new Set(found.flatMap((p) => p.names).filter((x): x is string => !!x)));
  const who = names.length ? ` · ${names.slice(0, 2).join(', ')}${names.length > 2 ? ` +${names.length - 2}` : ''}` : '';
  return `${count}${who}`;
}

/** Text a user can search: title, message and the documents' numbers and parties. */
export function searchText(a: GstAlert): string {
  const d = a.details;
  return [
    a.title,
    a.message,
    a.legal_ref,
    checkMeta(a.check_id).group,
    ...(d.bills ?? []).flatMap((b) => [b.bill_number, b.supplier_name]),
    ...(d.invoices ?? []).flatMap((i) => [i.invoice_number, i.supplier_name, i.supplier_gstin]),
    ...(d.sales ?? []).flatMap((s) => [s.invoice_number, s.customer_name]),
    ...(d.rcm_bills ?? []).flatMap((b) => [b.bill_number, b.supplier_name]),
    ...(d.unverified ?? []).flatMap((b) => [b.bill_number, b.supplier_name]),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

/** The one next step, in GST return terms, where the check has a clear one. */
export function recommendedAction(a: GstAlert): string | null {
  const due = a.due_date ? dateLabel(a.due_date) : null;
  switch (a.alert_key.split(':')[0]) {
    case 'rule37':
      if (a.alert_key === 'rule37:reversal_pending') {
        const interest = a.details.interest_if_utilised;
        return (
          `Reverse ${inr(a.amount)} in your next GSTR-3B, Table 4(B)(2).` +
          (interest ? ` If this credit was already used, interest of about ${inr(interest)} is due under Section 50.` : '') +
          ' When you pay the supplier, claim it again in Table 4(A)(5) and show it in Table 4(D)(1).'
        );
      }
      return `Pay these suppliers${due ? ` before ${due}` : ''}. ITC on any part still unpaid after 180 days must be reversed.`;
    case 'itc_deadline':
      return `Record these purchases, or mark them not eligible in GSTR-2B reconciliation${due ? `, by ${due}` : ''}. Credit for last year's invoices cannot be taken after that.`;
    case 'gstr3b':
      return a.severity === 'critical'
        ? 'File GSTR-3B as soon as you can: the late fee grows every day and unpaid tax attracts 18% yearly interest.'
        : `File GSTR-3B and pay the tax${due ? ` by ${due}` : ''}.`;
    case 'rcm_self_invoice':
      return a.due_date
        ? `Issue the self-invoice by ${due} (30 days from receipt) and pay the tax in cash through GSTR-3B.`
        : 'Confirm the supplier is unregistered and record the date you received the supply, so the Rule 47A date can be worked out.';
    default:
      return null;
  }
}
