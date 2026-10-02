import type { Business } from '@/types/database';
import { getStateCode } from '@/lib/invoice-engine';

export type Address = {
  id: string;
  label: string;
  line1: string;
  city: string;
  state: string;
  stateCode: string;
  pincode: string;
};

export type Customer = {
  id: string;
  name: string;
  contact?: string;
  phone: string;
  email?: string;
  gstin?: string;
  /** Set for overseas buyers; GSTIN is not applicable. */
  country?: string;
  taxId?: string;
  billing: Address;
  shipping: Address[];
  outstanding: number;
  overdueCount: number;
  lastInvoice?: { no: string; date: string; amount: number };
};

export type CatalogItem = {
  id: string;
  name: string;
  code: string;
  hsn: string;
  category: string;
  unit: string;
  salesPrice: number;
  purchasePrice: number;
  gstPct: number;
  stock: number;
  lowStockAt: number;
};

export type LineItem = {
  lineId: string;
  itemId: string;
  name: string;
  code: string;
  hsn: string;
  unit: string;
  qty: number;
  rate: number;
  purchasePrice: number;
  discount: number;
  discountType: 'pct' | 'amt';
  gstPct: number;
  stock: number;
};

export const BUSINESS = {
  name: 'Khatario Electricals',
  gstin: '27AAKCK1234F1Z9',
  address: 'Shop 4, FC Road, Shivajinagar, Pune 411004',
  state: 'Maharashtra',
  stateCode: '27',
  phone: '+91 98765 43210',
  bank: { name: 'HDFC Bank', account: '50200012344521', ifsc: 'HDFC0001234', branch: 'FC Road, Pune' },
  upi: 'khatario@hdfcbank',
};

export type Seller = {
  name: string;
  gstin: string;
  address: string;
  state: string;
  stateCode: string;
  phone: string;
  bank: { name: string; account: string; ifsc: string; branch: string };
  upi: string;
  fromProfile: boolean;
};

/**
 * Seller identity for GST: same precedence as the real invoice engine
 * (business.state_code, else derived from business.state), then GSTIN prefix.
 */
export function sellerFromBusiness(b: Business | null | undefined): Seller {
  const stateCode =
    b?.state_code || (b?.state ? getStateCode(b.state) : '') || (b?.gstin ? b.gstin.slice(0, 2) : '');
  if (!b || !stateCode) return { ...BUSINESS, fromProfile: false };
  return {
    name: b.name || BUSINESS.name,
    gstin: b.gstin || '',
    address: [b.address_line1 || b.address, b.address_line2, b.city, b.pincode].filter(Boolean).join(', '),
    state: b.state || '',
    stateCode,
    phone: b.phone || '',
    bank: {
      name: b.bank_name || '',
      account: b.account_number || '',
      ifsc: b.ifsc_code || '',
      branch: b.branch_name || '',
    },
    upi: BUSINESS.upi,
    fromProfile: true,
  };
}

const ganeshHo: Address = {
  id: 'a1',
  label: 'Head office',
  line1: '12, Laxmi Road, Budhwar Peth',
  city: 'Pune',
  state: 'Maharashtra',
  stateCode: '27',
  pincode: '411002',
};

const balajiHo: Address = {
  id: 'a3',
  label: 'Store',
  line1: 'No. 8, SP Road, Chickpet',
  city: 'Bengaluru',
  state: 'Karnataka',
  stateCode: '29',
  pincode: '560002',
};

const vijayHome: Address = {
  id: 'a5',
  label: 'Shop',
  line1: 'Near Bus Stand, Hadapsar',
  city: 'Pune',
  state: 'Maharashtra',
  stateCode: '27',
  pincode: '411028',
};

const metroHo: Address = {
  id: 'a6',
  label: 'Registered office',
  line1: '701, Lodha Supremus, Lower Parel',
  city: 'Mumbai',
  state: 'Maharashtra',
  stateCode: '27',
  pincode: '400013',
};

const alNoorHo: Address = {
  id: 'a7',
  label: 'Head office',
  line1: 'Office 1204, Al Ghurair Centre, Deira',
  city: 'Dubai',
  state: 'United Arab Emirates',
  stateCode: '96',
  pincode: 'PO Box 5432',
};

export const CUSTOMERS: Customer[] = [
  {
    id: 'c1',
    name: 'Shree Ganesh Traders',
    contact: 'Vijay Patil',
    phone: '98200 11223',
    email: 'accounts@shreeganesh.in',
    gstin: '27AABCS1429B1Z5',
    billing: ganeshHo,
    shipping: [
      ganeshHo,
      {
        id: 'a2',
        label: 'Godown',
        line1: 'Plot 44, MIDC Bhosari',
        city: 'Pune',
        state: 'Maharashtra',
        stateCode: '27',
        pincode: '411026',
      },
    ],
    outstanding: 18450,
    overdueCount: 2,
    lastInvoice: { no: 'INV/26-27/0471', date: '28 Sep 2026', amount: 12400 },
  },
  {
    id: 'c2',
    name: 'Balaji Electricals',
    contact: 'Ramesh Kumar',
    phone: '99000 44556',
    gstin: '29AAFCB7781K1ZQ',
    billing: balajiHo,
    shipping: [
      balajiHo,
      {
        id: 'a4',
        label: 'Site - Whitefield',
        line1: 'Prestige Shantiniketan, Tower C',
        city: 'Bengaluru',
        state: 'Karnataka',
        stateCode: '29',
        pincode: '560048',
      },
    ],
    outstanding: 0,
    overdueCount: 0,
    lastInvoice: { no: 'INV/26-27/0455', date: '19 Sep 2026', amount: 48200 },
  },
  {
    id: 'c3',
    name: 'Vijay Bhaiya',
    phone: '94334 22273',
    billing: vijayHome,
    shipping: [vijayHome],
    outstanding: 2300,
    overdueCount: 0,
  },
  {
    id: 'c4',
    name: 'Metro Builders LLP',
    contact: 'Anita Shah',
    phone: '98190 77881',
    email: 'purchase@metrobuilders.in',
    gstin: '27AAMFM5521R1ZX',
    billing: metroHo,
    shipping: [metroHo],
    outstanding: 125000,
    overdueCount: 4,
    lastInvoice: { no: 'INV/26-27/0402', date: '02 Sep 2026', amount: 86500 },
  },
  {
    id: 'c5',
    name: 'Al Noor Trading LLC',
    contact: 'Faisal Rahman',
    phone: '+971 50 123 4567',
    email: 'imports@alnoor.ae',
    country: 'United Arab Emirates',
    taxId: 'TRN 100234567800003',
    billing: alNoorHo,
    shipping: [alNoorHo],
    outstanding: 0,
    overdueCount: 0,
    lastInvoice: { no: 'EXP/26-27/0012', date: '14 Sep 2026', amount: 412000 },
  },
];

export const OVERSEAS_STATE_CODE = '96';

export type ExportConfig = {
  enabled: boolean;
  /** lut: zero-rated without paying IGST. igst: IGST paid, refund claimed later. */
  type: 'lut' | 'igst';
  currency: string;
  rate: number;
  portCode: string;
  shippingBillNo: string;
  shippingBillDate: string;
  portOfLoading: string;
  portOfDischarge: string;
  placeOfDelivery: string;
  incoterms: string;
  transportMode: '' | 'Air' | 'Sea' | 'Road' | 'Courier';
  awbNo: string;
  blNo: string;
  countryOfOrigin: string;
};

export const DEFAULT_EXPORT: ExportConfig = {
  enabled: false,
  type: 'lut',
  currency: 'USD',
  rate: 83.25,
  portCode: '',
  shippingBillNo: '',
  shippingBillDate: '',
  portOfLoading: '',
  portOfDischarge: '',
  placeOfDelivery: '',
  incoterms: '',
  transportMode: '',
  awbNo: '',
  blNo: '',
  countryOfOrigin: 'India',
};

export const CURRENCIES = [
  { code: 'INR', symbol: '₹', name: 'Indian Rupee', rate: 1 },
  { code: 'USD', symbol: '$', name: 'US Dollar', rate: 83.25 },
  { code: 'EUR', symbol: '€', name: 'Euro', rate: 90.1 },
  { code: 'GBP', symbol: '£', name: 'British Pound', rate: 105.4 },
  { code: 'AED', symbol: 'AED ', name: 'UAE Dirham', rate: 22.67 },
  { code: 'SGD', symbol: 'S$', name: 'Singapore Dollar', rate: 61.8 },
];

export const INCOTERMS = [
  { code: 'EXW', label: 'Ex Works' },
  { code: 'FCA', label: 'Free Carrier' },
  { code: 'FOB', label: 'Free On Board' },
  { code: 'CFR', label: 'Cost and Freight' },
  { code: 'CIF', label: 'Cost, Insurance & Freight' },
  { code: 'DDP', label: 'Delivered Duty Paid' },
];

export function fx(amount: number, currency: string): string {
  const c = CURRENCIES.find((x) => x.code === currency);
  if (!c || c.code === 'INR') return inr(amount);
  return `${c.symbol}${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export const CATALOG: CatalogItem[] = [
  { id: 'i1', name: 'LED Panel Light 18W', code: 'LED18', hsn: '9405', category: 'Lighting', unit: 'PCS', salesPrice: 420, purchasePrice: 310, gstPct: 18, stock: 142, lowStockAt: 20 },
  { id: 'i2', name: 'LED Bulb 9W (Pack of 4)', code: 'LEDB9', hsn: '9405', category: 'Lighting', unit: 'PACK', salesPrice: 360, purchasePrice: 255, gstPct: 12, stock: 64, lowStockAt: 10 },
  { id: 'i3', name: 'Copper Wire 1.5 sq mm (90 m)', code: 'CW15', hsn: '8544', category: 'Wires', unit: 'ROLL', salesPrice: 1850, purchasePrice: 1520, gstPct: 18, stock: 36, lowStockAt: 10 },
  { id: 'i4', name: 'Copper Wire 2.5 sq mm (90 m)', code: 'CW25', hsn: '8544', category: 'Wires', unit: 'ROLL', salesPrice: 2950, purchasePrice: 2480, gstPct: 18, stock: 7, lowStockAt: 10 },
  { id: 'i5', name: 'Modular Switch 6A', code: 'SW6A', hsn: '8536', category: 'Switchgear', unit: 'PCS', salesPrice: 65, purchasePrice: 38, gstPct: 18, stock: 980, lowStockAt: 100 },
  { id: 'i6', name: 'MCB 32A Double Pole', code: 'MCB32', hsn: '8536', category: 'Switchgear', unit: 'PCS', salesPrice: 540, purchasePrice: 560, gstPct: 18, stock: 8, lowStockAt: 10 },
  { id: 'i7', name: 'Distribution Board 8-Way', code: 'DB8', hsn: '8537', category: 'Switchgear', unit: 'PCS', salesPrice: 1650, purchasePrice: 1180, gstPct: 18, stock: -2, lowStockAt: 5 },
  { id: 'i8', name: 'PVC Conduit Pipe 20 mm', code: 'PVC20', hsn: '3917', category: 'Plumbing', unit: 'MTR', salesPrice: 28, purchasePrice: 17, gstPct: 18, stock: 1200, lowStockAt: 200 },
  { id: 'i9', name: 'Bathroom Commode (English)', code: 'BCE01', hsn: '6910', category: 'Plumbing', unit: 'NOS', salesPrice: 0, purchasePrice: 2300, gstPct: 18, stock: 2, lowStockAt: 1 },
  { id: 'i10', name: 'Flush Tank Push Button', code: 'FTPB', hsn: '3922', category: 'Plumbing', unit: 'SET', salesPrice: 380, purchasePrice: 240, gstPct: 18, stock: 0, lowStockAt: 3 },
  { id: 'i11', name: 'Ceiling Fan 1200 mm', code: 'FAN12', hsn: '8414', category: 'Fans', unit: 'PCS', salesPrice: 2450, purchasePrice: 1890, gstPct: 18, stock: 22, lowStockAt: 5 },
  { id: 'i12', name: 'Installation / Labour Charge', code: 'LAB', hsn: '9987', category: 'Services', unit: 'HRS', salesPrice: 300, purchasePrice: 0, gstPct: 18, stock: 9999, lowStockAt: 0 },
];

export const CATEGORIES = Array.from(new Set(CATALOG.map((c) => c.category)));

export const GST_RATES = [0, 5, 12, 18, 28];

export const PAYMENT_MODES = ['Cash', 'UPI', 'Card', 'Bank', 'Cheque'] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];

export const PAYMENT_TERMS = [
  { days: 0, label: 'On receipt' },
  { days: 7, label: '7 days' },
  { days: 15, label: '15 days' },
  { days: 30, label: '30 days' },
];

export type RecurringFrequency = 'weekly' | 'monthly' | 'quarterly' | 'yearly';

export type RecurringConfig = {
  enabled: boolean;
  frequency: RecurringFrequency;
  /** fixed: issue + send as-is. review: create a draft so quantities can be edited first. */
  quantityMode: 'fixed' | 'review';
  ends: 'never' | 'count';
  count: number;
};

export const DEFAULT_RECURRING: RecurringConfig = {
  enabled: false,
  frequency: 'monthly',
  quantityMode: 'review',
  ends: 'never',
  count: 12,
};

export const RECURRING_FREQUENCIES: { id: RecurringFrequency; label: string; adverb: string }[] = [
  { id: 'weekly', label: 'Weekly', adverb: 'every week' },
  { id: 'monthly', label: 'Monthly', adverb: 'every month' },
  { id: 'quarterly', label: 'Quarterly', adverb: 'every quarter' },
  { id: 'yearly', label: 'Yearly', adverb: 'every year' },
];

export function nextRecurringDate(iso: string, frequency: RecurringFrequency): Date {
  const d = new Date(`${iso}T00:00:00`);
  if (frequency === 'weekly') d.setDate(d.getDate() + 7);
  else if (frequency === 'monthly') d.setMonth(d.getMonth() + 1);
  else if (frequency === 'quarterly') d.setMonth(d.getMonth() + 3);
  else d.setFullYear(d.getFullYear() + 1);
  return d;
}

export function inr(n: number, fractionDigits = 2): string {
  const sign = n < 0 ? '−' : '';
  return (
    sign +
    '₹' +
    Math.abs(n).toLocaleString('en-IN', {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    })
  );
}

export function toLine(item: CatalogItem, qty: number): LineItem {
  return {
    lineId: `${item.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    itemId: item.id,
    name: item.name,
    code: item.code,
    hsn: item.hsn,
    unit: item.unit,
    qty,
    rate: item.salesPrice,
    purchasePrice: item.purchasePrice,
    discount: 0,
    discountType: 'pct',
    gstPct: item.gstPct,
    stock: item.stock,
  };
}

/** zeroRated: export under LUT, IGST charged at 0% regardless of the item's GST rate. */
export function calcLine(l: LineItem, zeroRated = false) {
  const gross = l.qty * l.rate;
  const discount =
    l.discountType === 'pct' ? (gross * Math.min(100, l.discount)) / 100 : Math.min(l.discount, gross);
  const taxable = gross - discount;
  const tax = zeroRated ? 0 : (taxable * l.gstPct) / 100;
  return { gross, discount, taxable, tax, amount: taxable + tax };
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}

export function addDays(iso: string, days: number): Date {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d;
}

export function fmtDate(d: Date): string {
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function twoDigits(n: number): string {
  if (n < 20) return ONES[n]!;
  return TENS[Math.floor(n / 10)]! + (n % 10 ? ` ${ONES[n % 10]}` : '');
}

function threeDigits(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  return [h ? `${ONES[h]} Hundred` : '', r ? twoDigits(r) : ''].filter(Boolean).join(' ');
}

/** Indian numbering (lakh / crore), e.g. "Rupees Twelve Thousand Four Hundred Only". */
export function amountInWords(amount: number): string {
  const rupees = Math.floor(Math.abs(amount));
  const paise = Math.round((Math.abs(amount) - rupees) * 100);
  let n = rupees;
  const crore = Math.floor(n / 1e7);
  n %= 1e7;
  const lakh = Math.floor(n / 1e5);
  n %= 1e5;
  const thousand = Math.floor(n / 1000);
  n %= 1000;
  const parts: string[] = [];
  if (crore) parts.push(`${threeDigits(crore)} Crore`);
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
  if (n) parts.push(threeDigits(n));
  let words = `Rupees ${parts.length ? parts.join(' ') : 'Zero'}`;
  if (paise) words += ` and ${twoDigits(paise)} Paise`;
  return `${words} Only`;
}

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}
