/**
 * Industry ledger packs added on top of the core chart (create_default_chart_of_accounts +
 * ensure_standard_account_heads). Packs only add ledgers and expense categories: posting keeps
 * using the core codes (4101 sales, 5101 purchases, 1104 inventory, GST 1110-1115 / 2150-2158),
 * so nothing here may reuse a core code. Every pack code lives in a reserved range below and
 * means the same ledger in every pack.
 *
 * Tax references follow the law as of October 2026: GST rates after the 22-Sep-2025
 * rationalisation, TDS/TCS under sections 393/394 of the Income-tax Act 2025, and RoDTEP /
 * RoSCTL as extended to 31-Dec-2026. Ledger names carry no section numbers or GST rates.
 */
import type { PlSection } from '@/lib/accounting/pl-sections';

export type PackGroupCode = '1100' | '1200' | '2100' | '4100' | '4200' | '5100' | '5200';

export const RESERVED_RANGES: ReadonlyArray<{ group: PackGroupCode; from: number; to: number }> = [
  { group: '1100', from: 1140, to: 1169 },
  { group: '1200', from: 1210, to: 1229 },
  { group: '2100', from: 2120, to: 2149 },
  { group: '4100', from: 4110, to: 4139 },
  { group: '4200', from: 4210, to: 4239 },
  { group: '5100', from: 5110, to: 5159 },
  { group: '5200', from: 5230, to: 5279 },
];

const GROUP_TYPE: Record<PackGroupCode, { account_type: string; nature: 'debit' | 'credit' }> = {
  '1100': { account_type: 'asset', nature: 'debit' },
  '1200': { account_type: 'asset', nature: 'debit' },
  '2100': { account_type: 'liability', nature: 'credit' },
  '4100': { account_type: 'income', nature: 'credit' },
  '4200': { account_type: 'income', nature: 'credit' },
  '5100': { account_type: 'expense', nature: 'debit' },
  '5200': { account_type: 'expense', nature: 'debit' },
};

interface LedgerDef {
  name: string;
  group: PackGroupCode;
  plSection?: PlSection;
  description?: string;
}

export const PACK_LEDGERS = {
  // Current assets 1140-1169
  '1140': { name: 'GST Refund Receivable', group: '1100', description: 'IGST refund on exports and inverted-duty refunds claimed on the GST portal.' },
  '1141': { name: 'RoDTEP Receivable', group: '1100' },
  '1142': { name: 'RoSCTL Receivable', group: '1100', description: 'Rebate on apparel and made-ups exports.' },
  '1143': { name: 'Duty Drawback Receivable', group: '1100' },
  '1144': { name: 'Supplier Scheme & Rate Difference Claims', group: '1100', description: 'Credit notes due from suppliers or brands for schemes, price protection and rate differences.' },
  '1145': { name: 'Expiry & Breakage Claims Receivable', group: '1100', description: 'Expired or damaged stock returned to the supplier, pending credit note.' },
  '1146': { name: 'Finance Company Receivable', group: '1100', description: 'Consumer-loan sales awaiting settlement from the finance company.' },
  '1147': { name: 'Delivery Platform Receivable', group: '1100', description: 'Settlements due from Swiggy, Zomato, ONDC and similar platforms.' },
  '1148': { name: 'OEM Warranty Claims Receivable', group: '1100' },
  '1149': { name: 'OEM Incentives Receivable', group: '1100' },
  '1150': { name: 'Retention Money Receivable', group: '1100', description: 'Amount held back by clients from running bills until defect liability ends.' },
  '1151': { name: 'EMD & Security Deposits with Clients', group: '1100' },
  '1152': { name: 'Unbilled Revenue', group: '1100', description: 'Work done but not yet invoiced.' },
  '1153': { name: 'Advances to Job Workers', group: '1100' },
  '1154': { name: 'Advances to Sub-contractors', group: '1100' },
  '1155': { name: 'Card & UPI Settlements Receivable', group: '1100', description: 'Card and UPI collections not yet credited to the bank.' },
  '1156': { name: 'Reimbursable Expenses Recoverable', group: '1100', description: 'Costs paid as pure agent on behalf of clients.' },

  // Fixed assets 1210-1229
  '1210': { name: 'Land & Building', group: '1200' },
  '1211': { name: 'Plant & Machinery', group: '1200' },
  '1212': { name: 'Furniture & Fixtures', group: '1200' },
  '1213': { name: 'Computers & Software', group: '1200' },
  '1214': { name: 'Vehicles', group: '1200' },
  '1215': { name: 'Electrical Installations', group: '1200' },
  '1216': { name: 'Demo Vehicles', group: '1200' },
  '1217': { name: 'Construction Equipment & Shuttering', group: '1200' },
  '1218': { name: 'Kitchen Equipment', group: '1200' },
  '1219': { name: 'Lab & QC Equipment', group: '1200' },

  // Current liabilities 2120-2149
  '2120': { name: 'Packing Credit Loan', group: '2100', description: 'Pre-shipment export finance (PCFC / packing credit).' },
  '2121': { name: 'Mobilisation Advance from Clients', group: '2100' },
  '2122': { name: 'Retention Money Payable', group: '2100', description: 'Amount held back from sub-contractor bills.' },
  '2123': { name: 'Labour Welfare Cess Payable', group: '2100', description: 'Building and other construction workers (BOCW) cess.' },
  '2124': { name: 'Bonus Payable', group: '2100' },
  '2125': { name: 'Gratuity Payable', group: '2100' },
  '2126': { name: 'RTO & Registration Collections', group: '2100', description: 'Collected from buyers and paid to the RTO. Not income.' },
  '2127': { name: 'Insurance Premium Collected', group: '2100', description: 'Collected from buyers for the insurer. Not income.' },
  '2128': { name: 'Security Deposits from Distributors', group: '2100' },
  '2129': { name: 'Gift Vouchers Outstanding', group: '2100' },
  '2130': { name: 'Service Charge Payable to Staff', group: '2100' },

  // Operating income 4110-4139
  '4110': { name: 'Export Incentive - RoDTEP', group: '4100' },
  '4111': { name: 'Export Incentive - RoSCTL', group: '4100' },
  '4112': { name: 'Duty Drawback Income', group: '4100' },
  '4113': { name: 'Insurance & Finance Commission', group: '4100' },
  '4114': { name: 'Supplier Schemes & Target Incentives', group: '4100' },
  '4115': { name: 'Warranty Claims from OEM', group: '4100' },

  // Direct costs 5110-5159
  '5110': { name: 'Job Work - Stitching', group: '5100' },
  '5111': { name: 'Job Work - Embroidery & Printing', group: '5100' },
  '5112': { name: 'Job Work - Dyeing & Processing', group: '5100' },
  '5113': { name: 'Job Work - Washing & Finishing', group: '5100' },
  '5114': { name: 'Weaving Charges', group: '5100' },
  '5115': { name: 'Sizing & Warping Charges', group: '5100' },
  '5116': { name: 'Piece-rate Wages', group: '5100' },
  '5117': { name: 'Factory Wages', group: '5100' },
  '5118': { name: 'Contract Labour', group: '5100' },
  '5119': { name: 'Power & Fuel', group: '5100' },
  '5120': { name: 'Consumable Stores & Spares', group: '5100' },
  '5121': { name: 'Repairs to Machinery', group: '5100' },
  '5122': { name: 'Sampling & Development', group: '5100' },
  '5123': { name: 'Testing & Inspection', group: '5100' },
  '5124': { name: 'Packing Material', group: '5100' },
  '5125': { name: 'Loan Licence Manufacturing Charges', group: '5100' },
  '5126': { name: 'Quality Control & Lab Expenses', group: '5100' },
  '5127': { name: 'Sub-contractor Charges', group: '5100' },
  '5128': { name: 'Site Expenses', group: '5100' },
  '5129': { name: 'Machinery Hire Charges', group: '5100' },
  '5130': { name: 'Labour Welfare Cess', group: '5100' },
  '5131': { name: 'Kitchen Consumables', group: '5100' },
  '5132': { name: 'Kitchen Gas & Fuel', group: '5100' },
  '5133': { name: 'Wastage & Spoilage', group: '5100' },
  '5134': { name: 'Workshop Consumables', group: '5100' },
  '5135': { name: 'Cold Storage Charges', group: '5100' },
  '5136': { name: 'Freight to Job Workers', group: '5100' },

  // Indirect costs 5230-5279
  '5230': { name: 'Brokerage on Sales', group: '5200', description: 'Dalali paid to agents.' },
  '5231': { name: 'Rate Difference & Buyer Claims', group: '5200', description: 'Kasar, quality and late-delivery claims allowed to buyers.' },
  '5232': { name: 'Export Freight & Clearing', group: '5200' },
  '5233': { name: 'Export Bank & LC Charges', group: '5200' },
  '5234': { name: 'Interest on Packing Credit', group: '5200', plSection: 'other_expense' },
  '5235': { name: 'Compliance Audits & Certifications', group: '5200' },
  '5236': { name: 'Trade Fairs & Exhibitions', group: '5200' },
  '5237': { name: 'Delivery Platform Commission', group: '5200' },
  '5238': { name: 'Card & UPI Charges', group: '5200' },
  '5239': { name: 'Finance Subvention Charges', group: '5200' },
  '5240': { name: 'Licence & Registration Fees', group: '5200' },
  '5241': { name: 'Trade Schemes to Customers', group: '5200' },
  '5242': { name: 'Software Subscriptions', group: '5200' },
  '5243': { name: 'Consultant & Sub-contractor Fees', group: '5200' },
  '5244': { name: 'ITC Reversal (Rule 42/43)', group: '5200', description: 'Input tax credit reversed for exempt or nil-rated supplies.' },
  '5245': { name: 'E-waste (EPR) Compliance', group: '5200' },
  '5246': { name: 'Cash Shortage & Excess', group: '5200' },
  '5247': { name: 'Bonus to Employees', group: '5200' },
  '5248': { name: 'Gratuity', group: '5200' },
  '5249': { name: 'Housekeeping & Pest Control', group: '5200' },
  '5250': { name: 'Insurance', group: '5200' },
} satisfies Record<string, LedgerDef>;

export type PackLedgerCode = keyof typeof PACK_LEDGERS;

export interface PackExpenseCategory {
  name: string;
  code: PackLedgerCode;
  itcBlocked?: boolean;
}

export interface BusinessProfile {
  industry: string | null;
  businessType: string | null;
  businessModel: string | null;
}

export interface CoaPack {
  key: string;
  label: string;
  appliesTo: (p: BusinessProfile) => boolean;
  ledgers: PackLedgerCode[];
  expenseCategories?: PackExpenseCategory[];
  /** Standalone restaurants pay 5% GST without input tax credit, so every category starts blocked. */
  blocksItcByDefault?: boolean;
}

const TRADING_TYPES = new Set(['retail', 'wholesaler', 'distributor']);
const isType = (p: BusinessProfile, ...types: string[]) => types.includes(p.businessType ?? '');
const isIndustry = (p: BusinessProfile, ...industries: string[]) => industries.includes(p.industry ?? '');
const isRestaurant = (p: BusinessProfile) => isIndustry(p, 'food_beverages') && isType(p, 'retail', 'service');

export const COA_PACKS: ReadonlyArray<CoaPack> = [
  {
    key: 'type:manufacturer',
    label: 'Manufacturing',
    appliesTo: (p) => isType(p, 'manufacturer'),
    ledgers: ['1210', '1211', '1215', '2124', '2125', '5117', '5118', '5119', '5120', '5121', '5124', '5247', '5248', '5250'],
    expenseCategories: [
      { name: 'Factory Wages', code: '5117' },
      { name: 'Contract Labour', code: '5118' },
      { name: 'Power & Fuel', code: '5119' },
      { name: 'Consumable Stores & Spares', code: '5120' },
      { name: 'Repairs to Machinery', code: '5121' },
      { name: 'Packing Material', code: '5124' },
      { name: 'Insurance', code: '5250' },
    ],
  },
  {
    key: 'type:trading',
    label: 'Trading',
    appliesTo: (p) => TRADING_TYPES.has(p.businessType ?? ''),
    ledgers: ['1144', '1212', '1214', '4114', '5241', '5250'],
    expenseCategories: [{ name: 'Insurance', code: '5250' }],
  },
  {
    key: 'type:retail',
    label: 'Retail counter',
    appliesTo: (p) => isType(p, 'retail'),
    ledgers: ['1155', '2129', '5238', '5246'],
    expenseCategories: [{ name: 'Card & UPI Charges', code: '5238' }],
  },
  {
    key: 'type:service',
    label: 'Services',
    appliesTo: (p) => isType(p, 'service') || isIndustry(p, 'services'),
    ledgers: ['1152', '1156', '1212', '1213', '5242', '5243'],
    expenseCategories: [
      { name: 'Software Subscriptions', code: '5242' },
      { name: 'Consultant Fees', code: '5243' },
    ],
  },
  {
    key: 'industry:garments',
    label: 'Garments',
    appliesTo: (p) => isIndustry(p, 'garments'),
    ledgers: ['1140', '1153', '5110', '5111', '5113', '5116', '5122', '5123', '5124', '5136', '5231', '5235'],
    expenseCategories: [
      { name: 'Stitching Job Work', code: '5110' },
      { name: 'Embroidery & Printing Job Work', code: '5111' },
      { name: 'Washing & Finishing Job Work', code: '5113' },
      { name: 'Piece-rate Wages', code: '5116' },
      { name: 'Sampling & Development', code: '5122' },
      { name: 'Testing & Inspection', code: '5123' },
      { name: 'Freight to Job Workers', code: '5136' },
      { name: 'Compliance Audits & Certifications', code: '5235' },
    ],
  },
  {
    key: 'industry:textiles',
    label: 'Textiles',
    appliesTo: (p) => isIndustry(p, 'textiles'),
    ledgers: ['1140', '1153', '5112', '5114', '5115', '5119', '5136', '5230', '5231'],
    expenseCategories: [
      { name: 'Dyeing & Processing Charges', code: '5112' },
      { name: 'Weaving Charges', code: '5114' },
      { name: 'Sizing & Warping Charges', code: '5115' },
      { name: 'Brokerage (Dalali)', code: '5230' },
      { name: 'Freight to Job Workers', code: '5136' },
    ],
  },
  {
    key: 'industry:pharmaceuticals',
    label: 'Pharmaceuticals',
    appliesTo: (p) => isIndustry(p, 'pharmaceuticals'),
    ledgers: ['1144', '1145', '5135', '5240', '5241', '5244'],
    expenseCategories: [
      { name: 'Drug Licence & Registration Fees', code: '5240' },
      { name: 'Cold Storage Charges', code: '5135' },
    ],
  },
  {
    key: 'industry:pharmaceuticals:manufacturer',
    label: 'Pharma manufacturing',
    appliesTo: (p) => isIndustry(p, 'pharmaceuticals') && isType(p, 'manufacturer'),
    ledgers: ['1219', '5125', '5126'],
    expenseCategories: [
      { name: 'Loan Licence Manufacturing', code: '5125' },
      { name: 'QC & Lab Expenses', code: '5126' },
    ],
  },
  {
    key: 'industry:electronics',
    label: 'Electronics',
    appliesTo: (p) => isIndustry(p, 'electronics'),
    ledgers: ['1144', '1146', '4114', '4115', '5238', '5239', '5245'],
    expenseCategories: [
      { name: 'Finance Subvention Charges', code: '5239' },
      { name: 'E-waste (EPR) Compliance', code: '5245' },
    ],
  },
  {
    key: 'industry:food_beverages:restaurant',
    label: 'Restaurant',
    appliesTo: isRestaurant,
    ledgers: ['1147', '1218', '2130', '5131', '5132', '5133', '5237', '5240', '5249'],
    blocksItcByDefault: true,
    expenseCategories: [
      { name: 'Kitchen Consumables', code: '5131', itcBlocked: true },
      { name: 'Kitchen Gas & Fuel', code: '5132', itcBlocked: true },
      { name: 'Delivery Platform Commission', code: '5237', itcBlocked: true },
      { name: 'Housekeeping & Pest Control', code: '5249', itcBlocked: true },
      { name: 'FSSAI & Licence Fees', code: '5240', itcBlocked: true },
    ],
  },
  {
    key: 'industry:food_beverages:fmcg',
    label: 'Food & beverage products',
    appliesTo: (p) => isIndustry(p, 'food_beverages') && !isRestaurant(p),
    ledgers: ['1144', '2128', '5133', '5135', '5240', '5241'],
    expenseCategories: [
      { name: 'Cold Storage Charges', code: '5135' },
      { name: 'FSSAI & Licence Fees', code: '5240' },
    ],
  },
  {
    key: 'industry:automotive',
    label: 'Automotive',
    appliesTo: (p) => isIndustry(p, 'automotive'),
    ledgers: ['1148', '1149', '1216', '2126', '2127', '4113', '4114', '4115', '5134'],
    expenseCategories: [{ name: 'Workshop Consumables', code: '5134' }],
  },
  {
    key: 'industry:construction',
    label: 'Construction',
    appliesTo: (p) => isIndustry(p, 'construction'),
    ledgers: ['1150', '1151', '1152', '1154', '1217', '2121', '2122', '2123', '5118', '5127', '5128', '5129', '5130'],
    expenseCategories: [
      { name: 'Sub-contractor Charges', code: '5127' },
      { name: 'Site Expenses', code: '5128' },
      { name: 'Machinery Hire', code: '5129' },
      { name: 'Contract Labour', code: '5118' },
    ],
  },
  {
    key: 'model:export',
    label: 'Exports',
    appliesTo: (p) => p.businessModel === 'export',
    ledgers: ['1140', '1141', '1143', '2120', '4110', '4112', '5232', '5233', '5234', '5236'],
    expenseCategories: [
      { name: 'Export Freight & Clearing', code: '5232' },
      { name: 'Export Bank & LC Charges', code: '5233' },
    ],
  },
  {
    key: 'model:export:textiles',
    label: 'Apparel & made-ups exports',
    appliesTo: (p) => p.businessModel === 'export' && isIndustry(p, 'garments', 'textiles'),
    ledgers: ['1142', '4111'],
  },
];

export interface ResolvedLedger {
  code: PackLedgerCode;
  name: string;
  group: PackGroupCode;
  account_type: string;
  nature: 'debit' | 'credit';
  plSection: PlSection | null;
  description: string | null;
}

export interface ResolvedPacks {
  packs: Array<{ key: string; label: string }>;
  ledgers: ResolvedLedger[];
  expenseCategories: Array<{ name: string; code: PackLedgerCode; itcBlocked: boolean }>;
  blocksItcByDefault: boolean;
}

function defaultSection(group: PackGroupCode): PlSection | null {
  if (group === '4100') return 'operating_income';
  if (group === '4200') return 'other_income';
  if (group === '5100') return 'cost_of_goods_sold';
  if (group === '5200') return 'operating_expense';
  return null;
}

export function resolveLedger(code: PackLedgerCode): ResolvedLedger {
  const def: LedgerDef = PACK_LEDGERS[code];
  return {
    code,
    name: def.name,
    group: def.group,
    ...GROUP_TYPE[def.group],
    plSection: def.plSection ?? defaultSection(def.group),
    description: def.description ?? null,
  };
}

/** Packs for a business profile, with ledgers deduplicated by code and categories by name. */
export function resolveIndustryPacks(profile: BusinessProfile): ResolvedPacks {
  const packs = COA_PACKS.filter((p) => p.appliesTo(profile));
  const codes = new Set<PackLedgerCode>();
  const categories = new Map<string, { name: string; code: PackLedgerCode; itcBlocked: boolean }>();
  const blocksItcByDefault = packs.some((p) => p.blocksItcByDefault);

  for (const pack of packs) {
    pack.ledgers.forEach((c) => codes.add(c));
    for (const c of pack.expenseCategories ?? []) {
      codes.add(c.code);
      const key = c.name.toLowerCase();
      if (!categories.has(key)) {
        categories.set(key, { name: c.name, code: c.code, itcBlocked: blocksItcByDefault || !!c.itcBlocked });
      }
    }
  }

  return {
    packs: packs.map((p) => ({ key: p.key, label: p.label })),
    ledgers: [...codes].sort().map(resolveLedger),
    expenseCategories: [...categories.values()],
    blocksItcByDefault,
  };
}
