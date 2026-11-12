import { computeLineGst, round2 } from '@/lib/invoices/line-gst';
import { GST_RATE_SLABS } from '@/lib/gst/rates';

export type InvoiceParty = { name: string; address: string; gstin: string; state: string; phone?: string };
export type InvoiceLine = { description: string; hsn: string; quantity: string; rate: string; discountPercent: string; gstRate: number };
export type InvoiceDraft = {
  seller: InvoiceParty; buyer: InvoiceParty; number: string; date: string /* YYYY-MM-DD */; dueDate: string;
  pricesIncludeGst: boolean; lines: InvoiceLine[]; notes: string;
};
export type InvoiceTotals = {
  intraState: boolean;
  lines: { index: number; quantity: number; rate: number; discountPercent: number; taxable: number; cgst: number; sgst: number; igst: number; lineTotal: number }[];
  taxable: number; cgst: number; sgst: number; igst: number; roundOff: number; total: number; totalInWords: string;
};

export const INVOICE_DRAFT_KEY = 'khatario-free-invoice-draft-v1';
const MAX_LINES = 200;
const DEFAULT_GST_RATE = 18;

function emptyLine(): InvoiceLine {
  return { description: '', hsn: '', quantity: '', rate: '', discountPercent: '', gstRate: DEFAULT_GST_RATE };
}

function emptyParty(): InvoiceParty {
  return { name: '', address: '', gstin: '', state: '' };
}

export function emptyInvoiceDraft(today: string): InvoiceDraft {
  return {
    seller: { ...emptyParty(), phone: '' },
    buyer: emptyParty(),
    number: 'INV-001',
    date: today,
    dueDate: '',
    pricesIncludeGst: false,
    lines: [emptyLine()],
    notes: '',
  };
}

/** Text to a finite number; anything unreadable is 0. */
function num(v: string): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Largest quantity or rate a line may carry, and largest invoice total, so every figure stays exact and readable. */
const MAX_FIELD = 1e12;
const MAX_TOTAL = 9e13;

export function calculateInvoice(draft: InvoiceDraft): InvoiceTotals {
  const sellerState = draft.seller.state.trim().toLowerCase();
  const buyerState = draft.buyer.state.trim().toLowerCase();
  const intraState = buyerState === '' || buyerState === sellerState;

  const lines: InvoiceTotals['lines'] = [];
  let running = 0;
  draft.lines.forEach((line, index) => {
    const quantity = num(line.quantity);
    // Clamps keep a typo (negative rate, discount over 100) from making a negative invoice.
    const rate = Math.max(0, num(line.rate));
    const discountPercent = Math.min(100, Math.max(0, num(line.discountPercent)));
    if (!(quantity > 0) || quantity > MAX_FIELD || rate > MAX_FIELD) return;
    const r = computeLineGst(
      { quantity, unit_price: rate, discount_percent: discountPercent, tax_rate: line.gstRate },
      intraState,
      false,
      draft.pricesIncludeGst
    );
    if (![r.taxable, r.cgst, r.sgst, r.igst, r.lineTotal].every(Number.isFinite)) return; // overflow: do not count
    if (running + r.lineTotal > MAX_TOTAL) return; // invoice would be too large to print
    running += r.lineTotal;
    lines.push({ index, quantity, rate, discountPercent, taxable: r.taxable, cgst: r.cgst, sgst: r.sgst, igst: r.igst, lineTotal: r.lineTotal });
  });

  const sum = (pick: (l: InvoiceTotals['lines'][number]) => number) => round2(lines.reduce((s, l) => s + pick(l), 0));
  const taxable = sum((l) => l.taxable);
  const cgst = sum((l) => l.cgst);
  const sgst = sum((l) => l.sgst);
  const igst = sum((l) => l.igst);
  const exact = sum((l) => l.lineTotal);
  const total = Math.round(exact);
  const roundOff = round2(total - exact);

  return { intraState, lines, taxable, cgst, sgst, igst, roundOff, total, totalInWords: amountInWords(total) };
}

const ONES = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen',
];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

function below100(n: number): string {
  if (n < 20) return ONES[n];
  const t = TENS[Math.floor(n / 10)];
  return n % 10 ? `${t}-${ONES[n % 10]}` : t;
}

function below1000(n: number): string {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (h) parts.push(`${ONES[h]} hundred`);
  if (rest) parts.push(below100(rest));
  return parts.join(' ');
}

/** Whole number in Indian words (lowercase). The crore part recurses, so 1000 crore reads "one thousand crore". */
function wordsBelowCrore(n: number): string {
  const lakh = Math.floor(n / 100000);
  const thousand = Math.floor((n % 100000) / 1000);
  const rest = n % 1000;
  const parts: string[] = [];
  if (lakh) parts.push(`${below100(lakh)} lakh`);
  if (thousand) parts.push(`${below100(thousand)} thousand`);
  if (rest) parts.push(below1000(rest));
  return parts.join(' ');
}

function wordsOf(n: number): string {
  const crore = Math.floor(n / 10000000);
  const rest = n % 10000000;
  const parts: string[] = [];
  if (crore) parts.push(`${wordsOf(crore)} crore`);
  if (rest) parts.push(wordsBelowCrore(rest));
  return parts.join(' ');
}

/** Whole rupees in Indian numbering (thousand, lakh, crore, then crore again: "ninety-nine lakh crore"). */
export function amountInWords(rupees: number): string {
  const n = Math.max(0, Math.floor(Number.isFinite(rupees) ? rupees : 0));
  if (n === 0) return 'Zero rupees only';
  const text = `${wordsOf(n)} rupees only`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, fallback: string) => (typeof v === 'string' ? v : fallback);

function parseParty(v: unknown, base: InvoiceParty): InvoiceParty {
  const o = isObj(v) ? v : {};
  const party: InvoiceParty = {
    name: str(o.name, base.name),
    address: str(o.address, base.address),
    gstin: str(o.gstin, base.gstin),
    state: str(o.state, base.state),
  };
  if (base.phone !== undefined || typeof o.phone === 'string') party.phone = str(o.phone, base.phone ?? '');
  return party;
}

function parseLine(v: unknown): InvoiceLine {
  const base = emptyLine();
  const o = isObj(v) ? v : {};
  const rate = o.gstRate;
  return {
    description: str(o.description, base.description),
    hsn: str(o.hsn, base.hsn),
    quantity: str(o.quantity, base.quantity),
    rate: str(o.rate, base.rate),
    discountPercent: str(o.discountPercent, base.discountPercent),
    gstRate: typeof rate === 'number' && (GST_RATE_SLABS as readonly number[]).includes(rate) ? rate : DEFAULT_GST_RATE,
  };
}

/** Reads a saved draft from untrusted text. Never throws; wrong or unknown fields fall back to the empty draft. */
export function parseInvoiceDraft(raw: string | null, today: string): InvoiceDraft {
  const base = emptyInvoiceDraft(today);
  try {
    if (!raw) return base;
    const o: unknown = JSON.parse(raw);
    if (!isObj(o)) return base;
    const lines = Array.isArray(o.lines) ? o.lines.slice(0, MAX_LINES).map(parseLine) : [];
    return {
      seller: parseParty(o.seller, base.seller),
      buyer: parseParty(o.buyer, base.buyer),
      number: str(o.number, base.number),
      date: str(o.date, base.date),
      dueDate: str(o.dueDate, base.dueDate),
      pricesIncludeGst: typeof o.pricesIncludeGst === 'boolean' ? o.pricesIncludeGst : base.pricesIncludeGst,
      lines: lines.length ? lines : base.lines,
      notes: str(o.notes, base.notes),
    };
  } catch {
    return base;
  }
}
