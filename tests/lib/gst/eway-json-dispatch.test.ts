import { ewayBulkJson } from '@/lib/gst/eway-json';

const GSTIN_KA = '29AAACR5055K1ZO';

type Branch = { gstin: string | null; state: string | null; state_code: string | null; address_line1: string | null; city: string | null; pincode: string | null };

function fakeDb(opts: { branch: Branch; warehouse?: { address_line1: string; city: string; pincode: string; state: string } | null; lineLocation?: string | null }) {
  const biz = { gstin: GSTIN_KA, state: 'Karnataka', state_code: '29', address_line1: 'MG Road', city: 'Bengaluru', pincode: '560001', name: 'Acme Traders' };
  const w = opts.warehouse ?? null;
  return {
    query: async (sql: string) => {
      if (sql.includes('FROM invoices')) {
        return { rows: [{ id: 'inv', status: 'final', invoice_number: 'INV-001', invoice_date: '2026-10-01', branch_id: 'br', customer_id: 'c', document_type: 'tax_invoice' }] };
      }
      if (sql.includes('FROM invoice_items')) {
        return { rows: [{ location_id: opts.lineLocation ?? null, hsn_sac: '8471', taxable_value: 100000, igst_amount: 18000, tax_rate: 18, quantity: 1 }] };
      }
      if (sql.includes('FROM customers')) {
        return { rows: [{ gstin: '33ADVFS4469F1ZJ', name: 'Chennai Buyer', a1: 'Anna Salai', city: 'Chennai', pin: '600002', st: '33' }] };
      }
      if (sql.includes('br.gstin AS br_gstin')) {
        // resolveSupplierRegistration
        const b = opts.branch;
        return {
          rows: [{
            b_gstin: biz.gstin, b_state: biz.state, b_state_code: biz.state_code, b_address: biz.address_line1, b_city: biz.city, b_pincode: biz.pincode,
            br_gstin: b.gstin, br_state: b.state, br_state_code: b.state_code, br_address1: b.address_line1, br_city: b.city, br_pincode: b.pincode,
          }],
        };
      }
      if (sql.includes('LEFT JOIN warehouses w')) {
        const b = opts.branch;
        return {
          rows: [{
            name: biz.name,
            w_a1: w?.address_line1 ?? null, w_city: w?.city ?? null, w_pin: w?.pincode ?? null, w_state: w?.state ?? null, w_gstin: null,
            br_a1: b.address_line1, br_city: b.city, br_pin: b.pincode, br_state: b.state, br_state_code: b.state_code,
          }],
        };
      }
      throw new Error(`unexpected query: ${sql.slice(0, 60)}`);
    },
  } as any;
}

const bangalore: Branch = { gstin: null, state: 'Karnataka', state_code: '29', address_line1: 'MG Road', city: 'Bengaluru', pincode: '560001' };

describe('e-way bill JSON dispatch-from', () => {
  it('uses the godown address and state as the actual dispatch place, keeping the GSTIN state', async () => {
    const db = fakeDb({
      branch: bangalore,
      warehouse: { address_line1: 'SIPCOT Phase 2', city: 'Hosur', pincode: '635109', state: 'Tamil Nadu' },
      lineLocation: 'hosur',
    });
    const bill = (await ewayBulkJson(db, 'biz', 'invoice', 'inv', { distanceKm: 40 })).billLists[0];
    expect(bill.fromGstin).toBe(GSTIN_KA);
    expect(bill.fromStateCode).toBe(29);
    expect(bill.actFromStateCode).toBe(33);
    expect(bill.fromPlace).toBe('Hosur');
    expect(bill.fromPincode).toBe(635109);
  });

  it('a branch without its own GSTIN keeps the business GSTIN state as fromStateCode (no 29 + 33 pairing)', async () => {
    const db = fakeDb({
      branch: { gstin: null, state: 'Tamil Nadu', state_code: '33', address_line1: 'Bagalur Road', city: 'Hosur', pincode: '635109' },
    });
    const bill = (await ewayBulkJson(db, 'biz', 'invoice', 'inv', { distanceKm: 40 })).billLists[0];
    expect(bill.fromGstin).toBe(GSTIN_KA);
    expect(bill.fromStateCode).toBe(29);
    expect(bill.actFromStateCode).toBe(33);
  });

  it('with no godown, dispatches from the branch address', async () => {
    const db = fakeDb({ branch: bangalore });
    const bill = (await ewayBulkJson(db, 'biz', 'invoice', 'inv', { distanceKm: 300 })).billLists[0];
    expect(bill.fromStateCode).toBe(29);
    expect(bill.actFromStateCode).toBe(29);
    expect(bill.fromPlace).toBe('Bengaluru');
  });
});
