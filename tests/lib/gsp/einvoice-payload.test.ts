import { buildEinvoice } from '@/lib/gsp/mastersindia/einvoice-payload';

const GSTIN_KA = '29AAACR5055K1ZO';

type Line = Record<string, any>;
type Ship = { address: string; city: string; state: string; pincode: string };
type O = {
  invoiceNumber?: string; supplyType?: string; exportType?: string | null; documentType?: string; status?: string; irnStatus?: string | null;
  customerGstin?: string | null; customerPincode?: string | null; pos?: string | null; reverseCharge?: boolean; ecommerce?: string | null;
  lines?: Line[]; grandTotal?: number; docShipping?: string | null; shipping?: Ship; godown?: boolean; noGstin?: boolean; customerState?: string | null; sellerPincode?: string;
};

const baseLine: Line = {
  item_id: 'it1', item_name: 'Steel rod', hsn_sac: '7214', quantity: 1, unit_price: 1000, discount_amount: 0, unit_factor: 1, uqc: 'NOS',
  taxable_value: 1000, tax_rate: 18, cgst_amount: 90, sgst_amount: 90, igst_amount: 0, cess_amount: 0, location_id: null,
};

function db(o: O = {}) {
  const lines = (o.lines ?? [{}]).map((l) => ({ ...baseLine, ...l }));
  const sum = lines.reduce((s, l) => s + l.taxable_value + l.cgst_amount + l.sgst_amount + l.igst_amount + l.cess_amount, 0);
  const biz = { gstin: o.noGstin ? null : GSTIN_KA, state: 'Karnataka', state_code: '29', address_line1: 'MG Road', city: 'Bengaluru', pincode: o.sellerPincode ?? '560001', name: 'Acme Traders' };
  return {
    query: async (sql: string) => {
      if (sql.includes('FROM invoices')) {
        return { rows: [{
          id: 'inv', status: o.status ?? 'final', invoice_number: o.invoiceNumber ?? 'INV-001', invoice_date: '2026-10-01', branch_id: 'br', customer_id: 'c',
          document_type: o.documentType ?? 'tax_invoice', supply_type: o.supplyType ?? 'b2b', export_type: o.exportType ?? null,
          irn_status: o.irnStatus ?? null, customer_gstin: o.customerGstin === undefined ? '33ADVFS4469F1ZJ' : o.customerGstin,
          place_of_supply_state_code: o.pos === undefined ? '29' : o.pos, is_reverse_charge: !!o.reverseCharge, ecommerce_operator_gstin: o.ecommerce ?? null,
          shipping_bill_number: 'SB123', shipping_bill_date: '2026-10-02', port_code: 'INMAA1',
          shipping_address: o.docShipping ?? null, grand_total: o.grandTotal ?? sum,
        }] };
      }
      if (sql.includes('FROM invoice_items')) return { rows: lines.map((l) => ({ ...l, location_id: l.location_id ?? (o.godown ? 'hosur' : null) })) };
      if (sql.includes('FROM customers')) {
        return { rows: [{
          gstin: o.customerGstin === undefined ? '33ADVFS4469F1ZJ' : o.customerGstin, name: 'Chennai Buyer', st: o.customerState === undefined ? '33' : o.customerState, billing: 'Anna Salai', city: 'Chennai',
          pin: o.customerPincode === undefined ? '600002' : o.customerPincode,
          ship_addr: o.shipping?.address ?? null, ship_city: o.shipping?.city ?? null, ship_state: o.shipping?.state ?? null, ship_pin: o.shipping?.pincode ?? null,
        }] };
      }
      if (sql.includes('br.gstin AS br_gstin')) {
        return { rows: [{
          b_gstin: biz.gstin, b_state: biz.state, b_state_code: biz.state_code, b_address: biz.address_line1, b_address2: 'Near Park', b_city: biz.city, b_pincode: biz.pincode,
          b_phone: '+91 98450 12345', b_email: 'acme@example.com',
          br_gstin: null, br_state: biz.state, br_state_code: '29', br_address1: null, br_city: null, br_pincode: null,
        }] };
      }
      if (sql.includes('LEFT JOIN warehouses w')) {
        return { rows: [{
          name: biz.name,
          w_a1: o.godown ? 'SIPCOT Phase 2' : null, w_city: o.godown ? 'Hosur' : null, w_pin: o.godown ? '635109' : null, w_state: o.godown ? 'Tamil Nadu' : null, w_gstin: null,
          br_a1: null, br_city: null, br_pin: null, br_state: biz.state, br_state_code: '29',
        }] };
      }
      throw new Error(`unexpected query: ${sql.slice(0, 60)}`);
    },
  } as any;
}

const msgs = (b: { problems: { message: string }[] }) => b.problems.map((x) => x.message);
const ewb = { distanceKm: 120, transport: { mode: 'road' as const, vehicleNumber: 'ka 01 ab 1234' } };
const pune: Ship = { address: 'Plot 9, MIDC', city: 'Pune', state: 'Maharashtra', pincode: '411019' };
const nashik = { place: 'Nashik', pincode: '422001', stateCode: '27' };
const inter = (extra: O = {}): O => ({ pos: '33', lines: [{ cgst_amount: 0, sgst_amount: 0, igst_amount: 180 }], ...extra });

describe('buildEinvoice', () => {
  it('builds an intra-state B2B invoice with stored totals and round-off', async () => {
    const b = await buildEinvoice(db({ lines: [{ taxable_value: 1000, tax_rate: 18, cgst_amount: 90, sgst_amount: 90 }], grandTotal: 1180 }), 'biz', 'inv');
    expect(b.problems).toEqual([]);
    const p: any = b.payload;
    expect(p.user_gstin).toBe(GSTIN_KA);
    expect(p.data_source).toBe('erp');
    expect(p.transaction_details).toEqual({ supply_type: 'B2B', charge_type: 'N', igst_on_intra: 'N', ecommerce_gstin: '' });
    expect(p.document_details).toEqual({ document_type: 'INV', document_number: 'INV-001', document_date: '01/10/2026' });
    expect(p.item_list[0]).toMatchObject({ item_serial_number: '1', gst_rate: 18, assessable_value: 1000, cgst_amount: 90, sgst_amount: 90, igst_amount: 0, total_item_value: 1180 });
    expect(p.value_details).toMatchObject({ total_assessable_value: 1000, total_cgst_value: 90, total_sgst_value: 90, total_igst_value: 0, total_cess_value: 0, total_discount: 0, total_other_charge: 0, total_invoice_value: 1180, round_off_amount: 0 });
    expect([b.sellerGstin, b.docNumber, b.docDate]).toEqual([GSTIN_KA, 'INV-001', '01/10/2026']);
  });

  it('maps seller and buyer blocks', async () => {
    const p: any = (await buildEinvoice(db({ ecommerce: '07AAACA1234A1Z5' }), 'biz', 'inv')).payload;
    expect(p.seller_details).toEqual({
      gstin: GSTIN_KA, legal_name: 'Acme Traders', address1: 'MG Road', address2: 'Near Park', location: 'Bengaluru', pincode: 560001, state_code: '29',
      phone_number: '919845012345', email: 'acme@example.com',
    });
    expect(p.buyer_details).toEqual({
      gstin: '33ADVFS4469F1ZJ', legal_name: 'Chennai Buyer', address1: 'Anna Salai', address2: '', location: 'Chennai', pincode: 600002, state_code: '33', place_of_supply: '29',
    });
    expect(p.transaction_details.ecommerce_gstin).toBe('07AAACA1234A1Z5');
    expect(p.dispatch_details).toBeUndefined();
    expect(p.ship_details).toBeUndefined();
    expect(p.export_details).toBeUndefined();
    expect(p.ewaybill_details).toBeUndefined();
  });

  it('carries the stored round-off', async () => {
    const b = await buildEinvoice(db(inter({ lines: [{ taxable_value: 999.5, tax_rate: 18, cgst_amount: 0, sgst_amount: 0, igst_amount: 179.91 }], grandTotal: 1179 })), 'biz', 'inv');
    expect(b.problems).toEqual([]);
    expect((b.payload as any).value_details.round_off_amount).toBe(-0.41);
  });

  it('builds an export invoice without any typed buyer details', async () => {
    const b = await buildEinvoice(db({ supplyType: 'export', exportType: 'wop', customerGstin: null, customerPincode: null, pos: '96', lines: [{ tax_rate: 0, cgst_amount: 0, sgst_amount: 0 }] }), 'biz', 'inv');
    expect(b.problems).toEqual([]);
    const p: any = b.payload;
    expect(p.transaction_details.supply_type).toBe('EXPWOP');
    expect(p.buyer_details).toMatchObject({ gstin: 'URP', state_code: '96', place_of_supply: '96', pincode: 999999 });
    expect(p.export_details).toEqual({ ship_bill_number: 'SB123', ship_bill_date: '02/10/2026', port_code: 'INMAA1', refund_claim: 'N' });
  });

  it('uses EXPWP for an export with payment', async () => {
    const b = await buildEinvoice(db({ supplyType: 'export', exportType: 'wp', customerGstin: null, pos: '96', lines: [{ cgst_amount: 0, sgst_amount: 0, igst_amount: 180 }] }), 'biz', 'inv');
    expect((b.payload as any).transaction_details.supply_type).toBe('EXPWP');
  });

  it.each([
    ['sez', 'wp', 'SEZWP'], ['sez', 'wop', 'SEZWOP'], ['sez', null, 'SEZWP'], ['deemed_export', null, 'DEXP'],
  ])('maps %s with export type %s to %s and still needs the buyer GSTIN', async (supplyType, exportType, code) => {
    const o = inter({ supplyType, exportType });
    const b = await buildEinvoice(db(o), 'biz', 'inv');
    expect(b.problems).toEqual([]);
    expect((b.payload as any).transaction_details.supply_type).toBe(code);
    expect((b.payload as any).buyer_details.gstin).toBe('33ADVFS4469F1ZJ');
    expect(msgs(await buildEinvoice(db({ ...o, customerGstin: null }), 'biz', 'inv'))).toEqual(["Add the customer's GSTIN"]);
  });

  it('sets charge_type Y for reverse charge', async () => {
    const b = await buildEinvoice(db({ reverseCharge: true }), 'biz', 'inv');
    expect((b.payload as any).transaction_details.charge_type).toBe('Y');
  });

  it('never builds a B2C invoice', async () => {
    const b = await buildEinvoice(db({ supplyType: 'b2c_small' }), 'biz', 'inv');
    expect(b.payload).toBeNull();
    expect(msgs(b)).toEqual(['This invoice does not need an e-invoice']);
  });

  it.each(['proforma_invoice', 'bill_of_supply'])('does not need an e-invoice for a %s', async (documentType) => {
    expect(msgs(await buildEinvoice(db({ documentType }), 'biz', 'inv'))).toEqual(['This invoice does not need an e-invoice']);
  });

  it('asks to finalise a draft and refuses an invoice that already has an IRN', async () => {
    expect(msgs(await buildEinvoice(db({ status: 'draft' }), 'biz', 'inv'))).toEqual(['Finalise the invoice first']);
    expect(msgs(await buildEinvoice(db({ irnStatus: 'active' }), 'biz', 'inv'))).toEqual(['This invoice already has an e-invoice']);
    expect((await buildEinvoice(db({ irnStatus: 'cancelled' }), 'biz', 'inv')).problems).toEqual([]);
  });

  it.each([
    ['0INV/1', /cannot be used for an e-invoice/], ['INV/2026-27/000123', /at most 16 characters/], ['INV#1', /cannot be used/], ['-INV1', /cannot be used/], ['/INV1', /cannot be used/],
  ])('refuses the document number %s', async (no, re) => {
    const b = await buildEinvoice(db({ invoiceNumber: no }), 'biz', 'inv');
    expect(b.problems[0].message).toMatch(re);
    expect(b.problems[0].message).toBe(`Invoice number ${no} cannot be used for an e-invoice. It must be at most 16 characters, use only letters, digits, / and -, and not start with 0, / or -.`);
    expect(b.payload).toBeNull();
  });

  it('accepts a 14-character number with / and -', async () => {
    expect((await buildEinvoice(db({ invoiceNumber: 'A/2026-27/0001' }), 'biz', 'inv')).problems).toEqual([]);
  });

  it('lists every missing master field at once, with the record to fix', async () => {
    const b = await buildEinvoice(db({ customerGstin: null, customerPincode: null, lines: [{ hsn_sac: '', item_id: 'it1', item_name: 'Steel rod' }] }), 'biz', 'inv');
    expect(b.problems.map((x) => [x.message, x.fix?.kind])).toEqual([
      ["Add the customer's GSTIN", 'customer'], ['Add the PIN code of Chennai Buyer', 'customer'], ['Add the HSN code for Steel rod', 'item'],
    ]);
    expect(b.problems.map((x) => x.fix?.id)).toEqual(['c', 'c', 'it1']);
    expect(b.payload).toBeNull();
  });

  it('flags the seller GSTIN and PIN code against the business', async () => {
    const b = await buildEinvoice(db({ noGstin: true, sellerPincode: '5600' }), 'biz', 'inv');
    expect(b.problems.map((x) => [x.message, x.fix?.kind, x.fix?.id])).toEqual([
      ['Add your GSTIN in Business settings', 'business', null], ['Add the PIN code of your business address', 'business', null],
    ]);
    expect(b.sellerGstin).toBeNull();
  });

  it('asks for the place of supply when neither it nor the buyer state is known', async () => {
    const b = await buildEinvoice(db({ pos: null, customerGstin: null, customerState: null }), 'biz', 'inv');
    expect(msgs(b)).toEqual(["Add the customer's GSTIN", 'Choose the place of supply']);
    expect(b.problems[1].fix).toEqual({ kind: 'invoice', id: 'inv' });
    // With a buyer GSTIN the buyer state stands in for a blank place of supply.
    const ok: any = (await buildEinvoice(db({ pos: null, lines: [{ cgst_amount: 0, sgst_amount: 0, igst_amount: 180 }] }), 'biz', 'inv')).payload;
    expect(ok.buyer_details.place_of_supply).toBe('33');
  });

  it('flags goods lines with no quantity but not services, and free-text lines have a null fix id', async () => {
    const b = await buildEinvoice(db({ lines: [{ quantity: 0, item_id: null, item_name: 'Loose bolts' }, { hsn_sac: '9965', quantity: 0, item_name: 'Freight' }] }), 'biz', 'inv');
    expect(b.problems.map((x) => [x.message, x.fix?.kind, x.fix?.id])).toEqual([['Enter the quantity for Loose bolts', 'item', null]]);
  });

  it('flags an HSN that is not 4 to 8 digits', async () => {
    expect(msgs(await buildEinvoice(db({ lines: [{ hsn_sac: '72' }] }), 'biz', 'inv'))).toEqual(['Add the HSN code for Steel rod']);
    expect(msgs(await buildEinvoice(db({ lines: [{ hsn_sac: '721411111' }] }), 'biz', 'inv'))).toEqual(['Add the HSN code for Steel rod']);
  });

  it('reports a total outside the round-off tolerance', async () => {
    const b = await buildEinvoice(db({ grandTotal: 1300 }), 'biz', 'inv');
    expect(msgs(b)).toEqual(['The invoice total differs from its lines by more than ₹99.99']);
    expect(b.problems[0].fix).toEqual({ kind: 'invoice', id: 'inv' });
    expect((await buildEinvoice(db({ grandTotal: 1279.99 }), 'biz', 'inv')).problems).toEqual([]);
  });

  it('reports CGST on an inter-state supply', async () => {
    const b = await buildEinvoice(db({ pos: '33' }), 'biz', 'inv');
    expect(msgs(b)).toEqual(['This is an inter-state supply, so it must carry IGST']);
  });

  it('reports IGST on a supply within the state', async () => {
    const b = await buildEinvoice(db({ lines: [{ cgst_amount: 0, sgst_amount: 0, igst_amount: 180 }] }), 'biz', 'inv');
    expect(msgs(b)).toEqual(['This is a supply within the state, so it must carry CGST and SGST']);
  });

  it('treats an SEZ supply as inter-state even when the place of supply is the seller state', async () => {
    const b = await buildEinvoice(db({ supplyType: 'sez', pos: '29' }), 'biz', 'inv');
    expect(msgs(b)).toEqual(['This is an inter-state supply, so it must carry IGST']);
  });

  it('does not trigger the tax-type problem for a zero-rated line on an inter-state invoice', async () => {
    const b = await buildEinvoice(db(inter({ lines: [{ tax_rate: 0, cgst_amount: 0, sgst_amount: 0, igst_amount: 0 }] })), 'biz', 'inv');
    expect(b.problems).toEqual([]);
  });

  it('allows at most 1000 lines', async () => {
    const many = (n: number) => Array.from({ length: n }, () => ({ taxable_value: 1, cgst_amount: 0.09, sgst_amount: 0.09 }));
    expect(msgs(await buildEinvoice(db({ lines: many(1001), grandTotal: 1181.18 }), 'biz', 'inv'))).toEqual(['An e-invoice can carry at most 1000 items']);
    expect((await buildEinvoice(db({ lines: many(1000), grandTotal: 1180 }), 'biz', 'inv')).problems).toEqual([]);
  });

  it('multiplies a quantity sold in an alternate unit by its factor', async () => {
    const p: any = (await buildEinvoice(db({ lines: [{ quantity: 5, unit_factor: 12, unit_price: 120, taxable_value: 600, cgst_amount: 54, sgst_amount: 54, uqc: 'PCS' }] }), 'biz', 'inv')).payload;
    expect(p.item_list[0]).toMatchObject({ quantity: 60, unit: 'PCS', unit_price: 10, total_amount: 600 });
  });

  it('maps a line with a discount, and OTH when the item has no UQC', async () => {
    const p: any = (await buildEinvoice(db({ lines: [{ quantity: 2, unit_price: 500, discount_amount: 100, taxable_value: 900, cgst_amount: 81, sgst_amount: 81, cess_amount: 5, uqc: null }] }), 'biz', 'inv')).payload;
    expect(p.item_list[0]).toEqual({
      item_serial_number: '1', product_description: 'Steel rod', is_service: 'N', hsn_code: '7214', quantity: 2, unit: 'OTH', unit_price: 500,
      total_amount: 1000, discount: 100, assessable_value: 900, gst_rate: 18, igst_amount: 0, cgst_amount: 81, sgst_amount: 81, cess_amount: 5, total_item_value: 1067,
    });
    expect(p.value_details.total_cess_value).toBe(5);
  });

  it('includes a charge line with a 99 HSN as a service', async () => {
    const b = await buildEinvoice(db({ lines: [{}, { charge_line: true, item_id: null, item_name: 'Freight', hsn_sac: '9965', quantity: 1, taxable_value: 100, cgst_amount: 9, sgst_amount: 9 }] }), 'biz', 'inv');
    expect(b.problems).toEqual([]);
    const items = (b.payload as any).item_list;
    expect(items).toHaveLength(2);
    expect(items[1]).toMatchObject({ item_serial_number: '2', product_description: 'Freight', is_service: 'Y', hsn_code: '9965' });
  });

  it('adds ewaybill_details only when asked, and refuses when there are no goods', async () => {
    expect((await buildEinvoice(db(), 'biz', 'inv')).payload).not.toHaveProperty('ewaybill_details');
    const p: any = (await buildEinvoice(db(), 'biz', 'inv', {
      ewb: { distanceKm: 120, transport: { mode: 'road', vehicleNumber: 'ka 01 ab 1234', transporterId: '29AAACT1234A1Z5', transporterName: 'Fast Lines', isOdc: false } },
    })).payload;
    expect(p.ewaybill_details).toEqual({
      transporter_id: '29AAACT1234A1Z5', transporter_name: 'Fast Lines', transportation_mode: '1', transportation_distance: 120,
      transporter_document_number: '', transporter_document_date: '', vehicle_number: 'KA01AB1234', vehicle_type: 'R',
    });
    const rail: any = (await buildEinvoice(db(), 'biz', 'inv', {
      ewb: { distanceKm: 300, transport: { mode: 'rail', docNumber: 'RR77', docDate: '2026-10-03', isOdc: true } },
    })).payload;
    expect(rail.ewaybill_details).toMatchObject({ transportation_mode: '2', transporter_document_number: 'RR77', transporter_document_date: '03/10/2026', vehicle_type: 'O' });
    const svc = await buildEinvoice(db({ lines: [{ hsn_sac: '9983' }] }), 'biz', 'inv', { ewb });
    expect(msgs(svc)).toEqual(['An e-way bill needs at least one goods line']);
    expect((await buildEinvoice(db({ lines: [{ hsn_sac: '9983' }] }), 'biz', 'inv')).problems).toEqual([]);
  });

  it('adds dispatch_details only when goods leave from another pincode', async () => {
    const p: any = (await buildEinvoice(db({ godown: true }), 'biz', 'inv')).payload;
    expect(p.dispatch_details).toEqual({ company_name: 'Acme Traders', address1: 'SIPCOT Phase 2', address2: '', location: 'Hosur', pincode: 635109, state_code: '33' });
    expect(p.seller_details.pincode).toBe(560001);
  });

  describe('ship_details', () => {
    it('adds them when goods go to the customer saved shipping address', async () => {
      const p: any = (await buildEinvoice(db({ shipping: pune, docShipping: 'Plot 9, MIDC' }), 'biz', 'inv')).payload;
      expect(p.ship_details).toEqual({ gstin: '33ADVFS4469F1ZJ', legal_name: 'Chennai Buyer', address1: 'Plot 9, MIDC', address2: '', location: 'Pune', pincode: 411019, state_code: '27' });
    });
    it('leaves them out when the shipping address is the billing address', async () => {
      const p: any = (await buildEinvoice(db({ docShipping: 'anna  salai.' }), 'biz', 'inv')).payload;
      expect(p.ship_details).toBeUndefined();
    });
    it('uses the typed ship-to place for an unsaved document address', async () => {
      const p: any = (await buildEinvoice(db({ docShipping: 'Gate 4, Chakan', shipping: pune }), 'biz', 'inv', { shipTo: nashik })).payload;
      expect(p.ship_details).toMatchObject({ address1: 'Gate 4, Chakan', location: 'Nashik', pincode: 422001, state_code: '27' });
    });
    it('is silent about an unsaved document address unless an e-way bill is asked for', async () => {
      const d = () => db({ docShipping: 'Gate 4, Chakan', shipping: pune });
      const plain = await buildEinvoice(d(), 'biz', 'inv');
      expect(plain.problems).toEqual([]);
      expect((plain.payload as any).ship_details).toBeUndefined();
      const withEwb = await buildEinvoice(d(), 'biz', 'inv', { ewb });
      expect(withEwb.problems).toEqual([{ field: 'ship_to', message: 'Enter the ship-to city, PIN code and state', fix: { kind: 'invoice', id: 'inv' } }]);
      expect(withEwb.payload).toBeNull();
    });
  });
});
