import { parseGstr2bJson, totalEligibleItc, normalizePortalDate } from '@/lib/gst/gstr2b-portal-parser';

const portal = {
  chksum: 'x',
  data: {
    gstin: '29AABCT1332L1ZL',
    rtnprd: '092026',
    docdata: {
      b2b: [
        {
          ctin: '29AAACR5055K1Z5',
          trdnm: 'Supplier One',
          inv: [
            {
              inum: 'S1/001',
              typ: 'R',
              dt: '05-09-2026',
              val: 11800,
              pos: '29',
              rev: 'N',
              itcavl: 'Y',
              rsn: '',
              txval: 10000,
              igst: 0,
              cgst: 900,
              sgst: 900,
              cess: 0,
              items: [
                { num: 1, rt: 18, txval: 6000, igst: 0, cgst: 540, sgst: 540, cess: 0 },
                { num: 2, rt: 18, txval: 4000, igst: 0, cgst: 360, sgst: 360, cess: 0 },
              ],
            },
            {
              inum: 'S1/002',
              dt: '06-09-2026',
              rev: 'Y',
              itcavl: 'N',
              rsn: 'P',
              items: [
                { num: 1, rt: 5, txval: 1000, igst: 50, cgst: 0, sgst: 0, cess: 0 },
                { num: 2, rt: 12, txval: 500, igst: 60, cgst: 0, sgst: 0, cess: 0 },
              ],
            },
          ],
        },
      ],
      cdnr: [
        {
          ctin: '29AAACR5055K1Z5',
          trdnm: 'Supplier One',
          nt: [{ ntnum: 'CN-7', typ: 'C', dt: '10-09-2026', itcavl: 'Y', txval: 1000, cgst: 90, sgst: 90, igst: 0, cess: 0 }],
        },
      ],
      impg: [{ refdt: '12-09-2026', portcode: 'INMAA1', boenum: '1234567', boedt: '11-09-2026', txval: 50000, igst: 9000, cess: 0 }],
    },
  },
};

describe('parseGstr2bJson (portal format)', () => {
  const { rows, returnPeriod, recipientGstin } = parseGstr2bJson(portal);

  it('reads the return period and recipient', () => {
    expect(returnPeriod).toBe('2026-09');
    expect(recipientGstin).toBe('29AABCT1332L1ZL');
  });

  it('keeps one row per document with header totals', () => {
    const inv = rows.find((r) => r.invoice_number === 'S1/001')!;
    expect(inv).toMatchObject({
      invoice_date: '2026-09-05',
      document_type: 'invoice',
      taxable_value: 10000,
      cgst_amount: 900,
      sgst_amount: 900,
      itc_eligibility: 'eligible',
      reverse_charge: 'N',
    });
  });

  it('sums item amounts when header totals are missing, and reads rev/itcavl', () => {
    const inv = rows.find((r) => r.invoice_number === 'S1/002')!;
    expect(inv.taxable_value).toBe(1500);
    expect(inv.igst_amount).toBe(110);
    expect(inv.reverse_charge).toBe('Y');
    expect(inv.itc_eligibility).toBe('ineligible');
  });

  it('parses credit notes and imports of goods', () => {
    expect(rows.find((r) => r.invoice_number === 'CN-7')).toMatchObject({ document_type: 'credit_note', invoice_date: '2026-09-10' });
    expect(rows.find((r) => r.document_type === 'import_goods')).toMatchObject({
      invoice_number: 'INMAA1/1234567',
      igst_amount: 9000,
      invoice_date: '2026-09-11',
    });
  });

  it('nets credit notes out of eligible ITC and ignores ineligible documents', () => {
    expect(totalEligibleItc(rows)).toBe(1800 - 180 + 9000);
  });
});

describe('parseGstr2bJson (legacy layout)', () => {
  it('aggregates itms per invoice', () => {
    const { rows } = parseGstr2bJson({
      b2b: [
        {
          ctin: '27AAACR5055K1Z5',
          inv: [
            {
              inum: 'L-1',
              idt: '01-08-2026',
              itms: [{ itm_det: { txval: 100, iamt: 18 } }, { itm_det: { txval: 200, iamt: 36 } }],
            },
          ],
        },
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ taxable_value: 300, igst_amount: 54, invoice_date: '2026-08-01' });
  });

  it('returns no rows for an unrelated file', () => {
    expect(parseGstr2bJson({ foo: 1 }).rows).toHaveLength(0);
  });
});

describe('normalizePortalDate', () => {
  it('handles portal and ISO dates', () => {
    expect(normalizePortalDate('31-03-2026')).toBe('2026-03-31');
    expect(normalizePortalDate('2026-03-31')).toBe('2026-03-31');
    expect(normalizePortalDate('bad')).toBeNull();
  });
});
