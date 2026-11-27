import { buildEwayBill, ewayBulkJson, splitAddress } from '@/lib/gst/eway-json';

const GSTIN_KA = '29AAACR5055K1ZO';
type Ship = { address: string; city: string; state: string; pincode: string };

function db(o: {
  invoiceNumber?: string; customerGstin?: string | null; customerPincode?: string; shipping?: Ship; docShipping?: string;
  grandTotal?: number; godown?: boolean;
}) {
  const biz = { gstin: GSTIN_KA, state: 'Karnataka', state_code: '29', address_line1: 'MG Road', city: 'Bengaluru', pincode: '560001', name: 'Acme Traders' };
  const branch = { gstin: null, state: 'Karnataka', state_code: '29', address_line1: 'MG Road', city: 'Bengaluru', pincode: '560001' };
  return {
    query: async (sql: string) => {
      if (sql.includes('FROM invoices')) {
        return { rows: [{
          id: 'inv', status: 'final', invoice_number: o.invoiceNumber ?? 'INV-001', invoice_date: '2026-10-01', branch_id: 'br', customer_id: 'c',
          document_type: 'tax_invoice', shipping_address: o.docShipping ?? null, grand_total: o.grandTotal ?? 0,
        }] };
      }
      if (sql.includes('FROM invoice_items')) {
        return { rows: [{ location_id: o.godown ? 'hosur' : null, hsn_sac: '8471', taxable_value: 100000, igst_amount: 18000, tax_rate: 18, quantity: 1 }] };
      }
      if (sql.includes('FROM customers')) {
        return { rows: [{
          gstin: o.customerGstin === undefined ? '33ADVFS4469F1ZJ' : o.customerGstin, name: 'Chennai Buyer', st: '33',
          billing: 'Anna Salai', city: 'Chennai', pin: o.customerPincode ?? '600002',
          ship_addr: o.shipping?.address ?? null, ship_city: o.shipping?.city ?? null, ship_state: o.shipping?.state ?? null, ship_pin: o.shipping?.pincode ?? null,
        }] };
      }
      if (sql.includes('br.gstin AS br_gstin')) {
        return { rows: [{
          b_gstin: biz.gstin, b_state: biz.state, b_state_code: biz.state_code, b_address: biz.address_line1, b_city: biz.city, b_pincode: biz.pincode,
          br_gstin: branch.gstin, br_state: branch.state, br_state_code: branch.state_code, br_address1: branch.address_line1, br_city: branch.city, br_pincode: branch.pincode,
        }] };
      }
      if (sql.includes('LEFT JOIN warehouses w')) {
        return { rows: [{
          name: biz.name,
          w_a1: o.godown ? 'SIPCOT Phase 2' : null, w_city: o.godown ? 'Hosur' : null, w_pin: o.godown ? '635109' : null, w_state: o.godown ? 'Tamil Nadu' : null, w_gstin: null,
          br_a1: branch.address_line1, br_city: branch.city, br_pin: branch.pincode, br_state: branch.state, br_state_code: branch.state_code,
        }] };
      }
      throw new Error(`unexpected query: ${sql.slice(0, 60)}`);
    },
  } as any;
}

const pune: Ship = { address: 'Plot 9, MIDC', city: 'Pune', state: 'Maharashtra', pincode: '411019' };
const nashik = { place: 'Nashik', pincode: '422001', stateCode: '27' };
const run = (d: any, extra: { shipToGstin?: string | null; shipTo?: typeof nashik | null } = {}) => buildEwayBill(d, 'biz', 'invoice', 'inv', { distanceKm: 10, ...extra });

describe('e-way bill builder ship-to and dispatch-from', () => {
  it('refuses a document number over 16 characters', async () => {
    await expect(run(db({ invoiceNumber: 'INV/2026-27/000123' }))).rejects.toThrow(/longer than 16 characters/);
  });
  it('is a regular transaction when goods go to the billing address', async () => {
    const b = await run(db({}));
    expect([b.transactionType, b.shipToGstin]).toEqual([1, null]);
    expect([b.toAddr1, b.toPlace, b.toPincode]).toEqual(['Anna Salai', 'Chennai', 600002]);
  });
  it('is regular when the shipping address is the billing address written differently', async () => {
    const b = await run(db({ shipping: { address: 'anna  salai.', city: 'Chennai', state: 'Tamil Nadu', pincode: '600002' } }));
    expect(b.transactionType).toBe(1);
  });
  it('is Bill To - Ship To when the shipping address differs, with the ship-to state and pincode', async () => {
    const b = await run(db({ shipping: pune }));
    expect(b.transactionType).toBe(2);
    expect([b.toStateCode, b.actToStateCode, b.toPincode, b.toPlace]).toEqual([33, 27, 411019, 'Pune']);
    expect([b.shipToGstin, b.shipToTradeName]).toEqual(['33ADVFS4469F1ZJ', 'Chennai Buyer']);
  });
  it('prefers the document shipping address over the customer one', async () => {
    const b = await run(db({ docShipping: 'Gate 4, Chakan', shipping: pune }), { shipTo: nashik });
    expect([b.transactionType, b.toAddr1]).toEqual([2, 'Gate 4, Chakan']);
  });
  it('refuses a document address that is not the customer saved one, unless the ship-to place is typed', async () => {
    await expect(run(db({ docShipping: 'Gate 4, Chakan', shipping: pune }))).rejects.toThrow(/not saved on the customer/);
    const b = await run(db({ docShipping: 'Gate 4, Chakan', shipping: pune }), { shipTo: nashik });
    expect([b.transactionType, b.toPlace, b.toPincode, b.actToStateCode]).toEqual([2, 'Nashik', 422001, 27]);
  });
  it('uses the customer saved shipping place when the document address matches it, and a typed place wins', async () => {
    const same = db({ docShipping: 'plot 9 midc', shipping: pune });
    const b = await run(same);
    expect([b.toPlace, b.toPincode, b.actToStateCode]).toEqual(['Pune', 411019, 27]);
    const typed = await run(same, { shipTo: nashik });
    expect([typed.toPlace, typed.toPincode]).toEqual(['Nashik', 422001]);
  });
  it('uses URP when the customer has no GSTIN, and the typed GSTIN when one is given', async () => {
    expect((await run(db({ customerGstin: null, shipping: pune }))).shipToGstin).toBe('URP');
    expect((await run(db({ shipping: pune }), { shipToGstin: '27AAACR5055K1ZO' })).shipToGstin).toBe('27AAACR5055K1ZO');
  });
  it('leaves the ship-to name blank when the ship-to GSTIN is not the buyer one, and keeps it when it is', async () => {
    const other = await run(db({ shipping: pune }), { shipToGstin: '27AAACR5055K1ZO' });
    expect([other.shipToGstin, other.shipToTradeName]).toEqual(['27AAACR5055K1ZO', '']);
    const own = await run(db({ shipping: pune }), { shipToGstin: '33ADVFS4469F1ZJ' });
    expect([own.shipToGstin, own.shipToTradeName]).toEqual(['33ADVFS4469F1ZJ', 'Chennai Buyer']);
  });
  it('is Bill To - Ship To when a ship-to GSTIN is given even without a shipping address', async () => {
    const b = await run(db({}), { shipToGstin: '27AAACR5055K1ZO' });
    expect([b.transactionType, b.toAddr1]).toEqual([2, 'Anna Salai']);
  });
  it('is type 3 when only the dispatch godown differs and type 4 when both differ', async () => {
    const dispatch = await run(db({ godown: true }));
    expect([dispatch.transactionType, dispatch.shipToGstin, dispatch.fromPincode]).toEqual([3, null, 635109]);
    const both = await run(db({ godown: true, shipping: pune }));
    expect([both.transactionType, both.shipToGstin]).toEqual([4, '33ADVFS4469F1ZJ']);
  });
  it('never reports a total below the invoice grand total', async () => {
    expect((await run(db({ grandTotal: 118050 }))).totInvValue).toBe(118050);
    expect((await run(db({ grandTotal: 100 }))).totInvValue).toBe(118000);
  });
  it('splits a long address across two lines at a word boundary', () => {
    const [a, b] = splitAddress('A'.repeat(100) + ' ' + 'B'.repeat(60));
    expect([a.length, b.length]).toEqual([100, 60]);
    expect(splitAddress('  Short   one ')).toEqual(['Short one', '']);
    expect(splitAddress(null)).toEqual(['', '']);
    expect(splitAddress('AAAA, BBBB CCCC', 8)).toEqual(['AAAA,', 'BBBB CCC']);
  });
  it('puts the second part of a long billing address in addr2', async () => {
    const b = await run(db({ shipping: { ...pune, address: 'A'.repeat(100) + ' ' + 'B'.repeat(60) } }));
    expect([b.toAddr1.length, b.toAddr2.length]).toEqual([100, 60]);
  });
  it('the portal bulk JSON does not carry the ship-to fields', async () => {
    const j = await ewayBulkJson(db({ shipping: pune }), 'biz', 'invoice', 'inv', { distanceKm: 10 });
    expect(j.billLists[0]).not.toHaveProperty('shipToGstin');
    expect(j.billLists[0]).not.toHaveProperty('shipToTradeName');
    expect(j.billLists[0].transactionType).toBe(2);
  });
  it('the portal bulk JSON forwards the typed ship-to place', async () => {
    const j = await ewayBulkJson(db({ docShipping: 'Gate 4, Chakan', shipping: pune }), 'biz', 'invoice', 'inv', { distanceKm: 10, shipTo: nashik });
    expect([j.billLists[0].toPlace, j.billLists[0].toPincode]).toEqual(['Nashik', 422001]);
  });
});
