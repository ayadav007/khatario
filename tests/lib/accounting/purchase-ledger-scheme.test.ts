/**
 * createPurchaseLedgerEntries: s.10(4) recipient scheme (Run 11 L2) and RCM without ITC.
 */
const ACCOUNT_CODES = ['1101', '1102', '1104', '2101', '5101', '1110', '1111', '1112', '1113', '2150', '2151', '2152', '2153', '2155'];
const accountByCode = (code: string) => ({ id: `acc-${code}`, account_code: code, business_id: 'biz', nature: 'debit', account_name: code });

jest.mock('@/lib/db', () => ({
  getPool: jest.fn(),
  queryOne: jest.fn(async (sql: string, params: unknown[]) => {
    if (/account_code = \$2/.test(sql)) {
      const code = String(params[1]);
      return ACCOUNT_CODES.includes(code) ? accountByCode(code) : null;
    }
    return null;
  }),
  queryRows: jest.fn(async () => []),
}));
jest.mock('@/lib/account-mappings', () => ({ getMappedAccountId: jest.fn(async () => null) }));

import type { PoolClient } from 'pg';
import { createPurchaseLedgerEntries, createPurchaseReturnLedgerEntries } from '@/lib/ledger-utils';

type Line = { account: string; debit: number; credit: number };

function fakeClient(opts: { registrationType: string; gstin: string | null }) {
  const lines: Line[] = [];
  const updates: string[] = [];
  const client = {
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      if (/INSERT INTO ledger_entry_lines/.test(sql)) {
        lines.push({ account: String(params[3]).replace('acc-', ''), debit: Number(params[5]), credit: Number(params[6]) });
        return { rows: [{ id: `l${lines.length}` }] };
      }
      if (/FROM branches/.test(sql)) return { rows: [{ id: 'br', is_active: true }] };
      if (/SELECT business_id, nature, account_name FROM accounts/.test(sql)) {
        return { rows: [{ business_id: 'biz', nature: 'debit', account_name: 'x' }] };
      }
      if (/FROM businesses b/.test(sql)) {
        return { rows: [{ b_gstin: opts.gstin, b_state_code: '29', br_gstin: null }] };
      }
      if (/gst_registration_type FROM businesses/.test(sql)) {
        return { rows: [{ gst_registration_type: opts.registrationType }] };
      }
      if (/UPDATE purchases SET itc_eligible = false/.test(sql)) {
        updates.push(String(params[0]));
        return { rows: [] };
      }
      if (/itc_type = 'capital_goods'/.test(sql)) return { rows: [{ total: '0', account_id: null }] };
      return { rows: [] };
    }),
  } as unknown as PoolClient;
  return { client, lines, updates };
}

const sum = (lines: Line[], k: 'debit' | 'credit') => Math.round(lines.reduce((s, l) => s + l[k], 0) * 100) / 100;
const net = (lines: Line[], code: string) =>
  Math.round(lines.filter((l) => l.account === code).reduce((s, l) => s + l.debit - l.credit, 0) * 100) / 100;

const bill = {
  businessId: 'biz',
  purchaseId: 'p1',
  purchaseNumber: 'B-1',
  purchaseDate: '2026-09-01',
  itcClaimDate: '2026-09-28',
  grandTotal: 1180,
  supplierId: 's1',
  isCashPurchase: false,
  branchId: 'br',
  taxableValue: 1000,
  cgstTotal: 90,
  sgstTotal: 90,
};

describe('createPurchaseLedgerEntries — recipient scheme', () => {
  it('regular recipient: Input CGST/SGST debited', async () => {
    const f = fakeClient({ registrationType: 'regular', gstin: '29AABCU9603R1ZM' });
    await createPurchaseLedgerEntries({ ...bill, poolClient: f.client });
    expect(net(f.lines, '1110')).toBe(90);
    expect(net(f.lines, '1111')).toBe(90);
    expect(net(f.lines, '5101')).toBe(1000);
    expect(net(f.lines, '2101')).toBe(-1180);
    expect(f.updates).toEqual([]);
    expect(sum(f.lines, 'debit')).toBe(sum(f.lines, 'credit'));
  });

  it.each([
    ['composition', '29AABCU9603R1ZM'],
    ['unregistered', null],
    ['regular', null],
  ])('%s recipient (gstin=%s): no Input GST, tax is cost, flag aligned', async (registrationType, gstin) => {
    const f = fakeClient({ registrationType, gstin });
    await createPurchaseLedgerEntries({ ...bill, poolClient: f.client, itcEligible: true });
    for (const code of ['1110', '1111', '1112', '1113']) expect(net(f.lines, code)).toBe(0);
    expect(net(f.lines, '5101')).toBe(1180);
    expect(net(f.lines, '2101')).toBe(-1180);
    expect(f.updates).toEqual(['p1']);
    expect(sum(f.lines, 'debit')).toBe(sum(f.lines, 'credit'));
  });
});

describe('createPurchaseLedgerEntries — s.16(4) time limit (Run 11 L8)', () => {
  it('FY 2024-25 bill claimed on 1 Dec 2025: no Input GST, reason returned', async () => {
    const f = fakeClient({ registrationType: 'regular', gstin: '29AABCU9603R1ZM' });
    const r = await createPurchaseLedgerEntries({
      ...bill,
      purchaseDate: '2025-02-10',
      itcClaimDate: '2025-12-01',
      poolClient: f.client,
    });
    expect(r.itcEligible).toBe(false);
    expect(r.itcBlockedReason).toMatch(/s\.16\(4\)/);
    expect(net(f.lines, '1110') + net(f.lines, '1111')).toBe(0);
    expect(net(f.lines, '5101')).toBe(1180);
    expect(f.updates).toEqual(['p1']);
  });

  it('same bill claimed on 30 Nov 2025: ITC allowed', async () => {
    const f = fakeClient({ registrationType: 'regular', gstin: '29AABCU9603R1ZM' });
    const r = await createPurchaseLedgerEntries({
      ...bill,
      purchaseDate: '2025-02-10',
      itcClaimDate: '2025-11-30',
      poolClient: f.client,
    });
    expect(r.itcEligible).toBe(true);
    expect(net(f.lines, '1110') + net(f.lines, '1111')).toBe(180);
  });
});

describe('createPurchaseLedgerEntries — RCM', () => {
  it('RCM with ITC: supplier owed taxable only, RCM output credited, ITC debited', async () => {
    const f = fakeClient({ registrationType: 'regular', gstin: '29AABCU9603R1ZM' });
    await createPurchaseLedgerEntries({ ...bill, poolClient: f.client, isReverseCharge: true });
    expect(net(f.lines, '2101')).toBe(-1000);
    expect(net(f.lines, '2155')).toBe(-180);
    expect(net(f.lines, '1110') + net(f.lines, '1111')).toBe(180);
    expect(sum(f.lines, 'debit')).toBe(sum(f.lines, 'credit'));
  });

  it('RCM with blocked ITC: supplier owed taxable only, RCM still payable, tax to cost', async () => {
    const f = fakeClient({ registrationType: 'regular', gstin: '29AABCU9603R1ZM' });
    await createPurchaseLedgerEntries({ ...bill, poolClient: f.client, isReverseCharge: true, itcEligible: false });
    expect(net(f.lines, '2101')).toBe(-1000);
    expect(net(f.lines, '2155')).toBe(-180);
    expect(net(f.lines, '5101')).toBe(1180);
    expect(net(f.lines, '1110') + net(f.lines, '1111')).toBe(0);
    expect(sum(f.lines, 'debit')).toBe(sum(f.lines, 'credit'));
  });

  it.each([
    ['ITC claimed', true],
    ['ITC blocked', false],
  ])('full RCM purchase return (%s) nets the bill to zero on every account', async (_label, itcEligible) => {
    const f = fakeClient({ registrationType: 'regular', gstin: '29AABCU9603R1ZM' });
    await createPurchaseLedgerEntries({ ...bill, poolClient: f.client, isReverseCharge: true, itcEligible });
    await createPurchaseReturnLedgerEntries({
      businessId: 'biz',
      purchaseReturnId: 'r1',
      returnNumber: 'PR-1',
      returnDate: '2026-09-10',
      grandTotal: 1180,
      supplierId: 's1',
      branchId: 'br',
      taxableValue: 1000,
      cgstTotal: 90,
      sgstTotal: 90,
      itcEligible,
      isReverseCharge: true,
      poolClient: f.client,
    });
    for (const code of ['2101', '2155', '5101', '1110', '1111']) expect(net(f.lines, code)).toBe(0);
  });

  it('composition recipient under RCM: pays RCM in cash, no ITC', async () => {
    const f = fakeClient({ registrationType: 'composition', gstin: '29AABCU9603R1ZM' });
    await createPurchaseLedgerEntries({ ...bill, poolClient: f.client, isReverseCharge: true });
    expect(net(f.lines, '2155')).toBe(-180);
    expect(net(f.lines, '2101')).toBe(-1000);
    expect(net(f.lines, '1110') + net(f.lines, '1111')).toBe(0);
    expect(sum(f.lines, 'debit')).toBe(sum(f.lines, 'credit'));
  });
});
