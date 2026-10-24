import {
  COA_PACKS,
  PACK_LEDGERS,
  RESERVED_RANGES,
  resolveIndustryPacks,
  resolveLedger,
  type BusinessProfile,
  type PackLedgerCode,
} from '@/lib/accounting/industry-coa';
import { isAllowedPlSection } from '@/lib/accounting/pl-sections';

const CORE_CODES = new Set([
  '1101', '1102', '1103', '1104', '1105', '1106', '1107', '1108', '1109', '1110', '1111', '1112', '1113',
  '1114', '1115', '1116', '1117', '1118', '1130', '1131', '1132', '1133', '1201', '1202',
  '2101', '2102', '2103', '2104', '2105', '2106', '2107', '2108', '2109', '2110', '2111', '2112', '2113',
  '2114', '2115', '2116', '2117', '2118', '2150', '2151', '2152', '2153', '2154', '2155', '2156', '2157', '2158',
  '2201', '2202', '2203', '3001', '3002', '3003', '3100',
  '4101', '4102', '4103', '4201', '4202', '4203', '4204', '4205',
  '5101', '5102', '5103', '5104', '5105', '5106',
  '5201', '5202', '5203', '5204', '5205', '5206', '5207', '5208', '5209', '5210', '5211',
  '5212', '5213', '5214', '5215', '5216', '5217', '5218', '5299',
]);

const INDUSTRIES = ['pharmaceuticals', 'textiles', 'garments', 'electronics', 'food_beverages', 'automotive', 'construction', 'services', 'other', null];
const TYPES = ['retail', 'wholesaler', 'distributor', 'manufacturer', 'service', 'other', null];
const MODELS = ['b2b', 'b2c', 'b2b2c', 'export', 'mixed', null];

const allProfiles: BusinessProfile[] = INDUSTRIES.flatMap((industry) =>
  TYPES.flatMap((businessType) => MODELS.map((businessModel) => ({ industry, businessType, businessModel })))
);

const codes = (p: BusinessProfile) => resolveIndustryPacks(p).ledgers.map((l) => l.code);
const packKeys = (p: BusinessProfile) => resolveIndustryPacks(p).packs.map((x) => x.key);

describe('industry chart of accounts packs', () => {
  it('never reuses a core account code', () => {
    for (const code of Object.keys(PACK_LEDGERS)) expect(CORE_CODES.has(code)).toBe(false);
  });

  it('keeps every ledger inside the reserved range of its group', () => {
    for (const [code, def] of Object.entries(PACK_LEDGERS)) {
      const range = RESERVED_RANGES.find((r) => r.group === def.group)!;
      expect(Number(code)).toBeGreaterThanOrEqual(range.from);
      expect(Number(code)).toBeLessThanOrEqual(range.to);
    }
  });

  it('gives every income and expense ledger an allowed P&L section', () => {
    for (const code of Object.keys(PACK_LEDGERS) as PackLedgerCode[]) {
      const l = resolveLedger(code);
      if (l.account_type === 'income' || l.account_type === 'expense') {
        expect(l.plSection).not.toBeNull();
        expect(isAllowedPlSection(l.account_type, l.plSection!)).toBe(true);
      } else {
        expect(l.plSection).toBeNull();
      }
    }
  });

  it('only maps expense categories to expense ledgers', () => {
    for (const pack of COA_PACKS) {
      for (const c of pack.expenseCategories ?? []) expect(resolveLedger(c.code).account_type).toBe('expense');
    }
  });

  it('uses no section numbers or GST rates in ledger names', () => {
    for (const def of Object.values(PACK_LEDGERS)) {
      expect(def.name).not.toMatch(/\b(19[2-6][A-Z]?|206C|39[2-4])\b/);
      expect(def.name).not.toMatch(/\d+\s?%/);
    }
  });

  it('resolves every profile without duplicate codes or category names', () => {
    for (const p of allProfiles) {
      const r = resolveIndustryPacks(p);
      expect(new Set(r.ledgers.map((l) => l.code)).size).toBe(r.ledgers.length);
      expect(new Set(r.expenseCategories.map((c) => c.name.toLowerCase())).size).toBe(r.expenseCategories.length);
      const ledgerCodes = new Set(r.ledgers.map((l) => l.code));
      for (const c of r.expenseCategories) expect(ledgerCodes.has(c.code)).toBe(true);
    }
  });

  it('adds nothing for an unclassified business', () => {
    expect(resolveIndustryPacks({ industry: 'other', businessType: 'other', businessModel: null }).ledgers).toEqual([]);
  });

  it('builds a garment exporter-manufacturer chart', () => {
    const p = { industry: 'garments', businessType: 'manufacturer', businessModel: 'export' };
    expect(packKeys(p)).toEqual(['type:manufacturer', 'industry:garments', 'model:export', 'model:export:textiles']);
    expect(codes(p)).toEqual(expect.arrayContaining(['5110', '5116', '5117', '1141', '1142', '4110', '4111', '2120']));
  });

  it('adds RoSCTL only for apparel and textile exporters', () => {
    expect(codes({ industry: 'garments', businessType: 'manufacturer', businessModel: 'b2b' })).not.toContain('1142');
    expect(codes({ industry: 'electronics', businessType: 'distributor', businessModel: 'export' })).not.toContain('1142');
    expect(codes({ industry: 'textiles', businessType: 'wholesaler', businessModel: 'export' })).toContain('1142');
  });

  it('treats retail or service food businesses as restaurants with input credit blocked', () => {
    const r = resolveIndustryPacks({ industry: 'food_beverages', businessType: 'retail', businessModel: 'b2c' });
    expect(r.packs.map((p) => p.key)).toContain('industry:food_beverages:restaurant');
    expect(r.blocksItcByDefault).toBe(true);
    expect(r.expenseCategories.every((c) => c.itcBlocked)).toBe(true);

    const fmcg = resolveIndustryPacks({ industry: 'food_beverages', businessType: 'manufacturer', businessModel: 'b2b' });
    expect(fmcg.packs.map((p) => p.key)).toContain('industry:food_beverages:fmcg');
    expect(fmcg.blocksItcByDefault).toBe(false);
    expect(fmcg.expenseCategories.some((c) => c.itcBlocked)).toBe(false);
  });

  it('adds pharma manufacturing ledgers only for manufacturers', () => {
    expect(codes({ industry: 'pharmaceuticals', businessType: 'distributor', businessModel: null })).not.toContain('5125');
    expect(codes({ industry: 'pharmaceuticals', businessType: 'manufacturer', businessModel: null })).toContain('5125');
    expect(codes({ industry: 'pharmaceuticals', businessType: 'retail', businessModel: null })).toContain('5244');
  });

  it('keeps automotive pass-through collections as liabilities', () => {
    const r = resolveIndustryPacks({ industry: 'automotive', businessType: 'retail', businessModel: null });
    expect(r.ledgers.find((l) => l.code === '2126')?.account_type).toBe('liability');
    expect(r.ledgers.find((l) => l.code === '2127')?.account_type).toBe('liability');
  });

  it('places interest on packing credit below operating profit', () => {
    expect(resolveLedger('5234').plSection).toBe('other_expense');
  });
});
