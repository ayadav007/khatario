import { readFileSync } from 'fs';
import { join } from 'path';
import { GspError, clearGspTokenCache } from '@/lib/gsp/mastersindia/client';
import {
  miCancelEway, miCloseEway, miExtendEway, miFindEwayByDocument, miGenerateEway, miGetEwayStatus,
  miUpdatePartB, toMiEwayPayload,
} from '@/lib/gsp/mastersindia/eway';
import { EwayBillInputError } from '@/lib/gst/eway-bills';

const creds = { username: 'u@x.co', password: 'p' };
const G = '05AAABB0639G1Z8';
const jwt = (exp: number) => `h.${Buffer.from(JSON.stringify({ exp })).toString('base64url')}.s`;
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const loginOk = json({ token: jwt(9e9) });
const fixture = (name: string) => json(JSON.parse(readFileSync(join(__dirname, '../../fixtures/gsp', name), 'utf8')));
const ok = (message: unknown) => json({ results: { message, status: 'Success', code: 200 } });

// Replies are cloned so one shared `loginOk` can answer every test's login.
function replyWith(...queued: Response[]) {
  const replies = queued.map((r) => r.clone());
  const calls: Array<{ url: string; method: string; body: any }> = [];
  const fn = (async (url: any, init: any) => {
    const r = replies.shift();
    if (!r) throw new Error('no reply queued');
    calls.push({ url: String(url), method: init.method, body: init.body ? JSON.parse(init.body) : undefined });
    return r;
  }) as unknown as typeof fetch;
  return Object.assign(fn, { calls });
}
// The first call is the login; the second is the API call under test.
const apiCall = (f: ReturnType<typeof replyWith>) => f.calls[1];

beforeEach(() => clearGspTokenCache());

const bill = (over: Record<string, unknown> = {}) => ({
  supplyType: 'O', subSupplyType: 1, subSupplyDesc: '', docType: 'INV', docNo: 'KH/1', docDate: '27/11/2026',
  fromGstin: G, fromTrdName: 'Welton', fromAddr1: 'Taj', fromAddr2: 'Colaba', fromPlace: 'Mumbai', fromPincode: 400001,
  actFromStateCode: 27, fromStateCode: 5,
  toGstin: '29AAABC0181E1ZE', toTrdName: 'Sthuthya', toAddr1: 'Nilaya', toAddr2: 'Dasa', toPlace: 'Bengaluru', toPincode: 560001,
  actToStateCode: 29, toStateCode: 29,
  transactionType: 2, otherValue: 1, totalValue: 500, cgstValue: 0, sgstValue: 0, igstValue: 90, cessValue: 2, cessNonAdvolValue: 3,
  totInvValue: 596, transporterId: '', transporterName: '', transDocNo: '', transMode: '1', transDistance: '1769',
  transDocDate: '', vehicleNo: '', vehicleType: 'R', mainHsnCode: 1001,
  itemList: [{
    itemNo: 1, productName: 'Wheat', productDesc: 'Wheat flour', hsnCode: 1001, quantity: 5, qtyUnit: 'BOX',
    cgstRate: 0, sgstRate: 0, igstRate: 18, cessRate: 1, cessNonadvol: 2, taxableAmount: 500,
  }],
  shipToGstin: '07AAABC0181E1ZX', shipToTradeName: 'Ship Co',
  ...over,
}) as any;

describe('toMiEwayPayload', () => {
  it('maps every key for a type-2 inter-state bill', () => {
    const p: any = toMiEwayPayload(bill(), {
      mode: 'road', vehicleNumber: 'MH12AB1234', transporterId: '05AAABB0639G1Z8', transporterName: 'Fast Co',
      docNumber: 'LR1', docDate: '2026-11-25',
    });
    const { itemList, ...rest } = p;
    expect(rest).toEqual({
      userGstin: G, gstin_of_consignor: G, supply_type: 'outward', sub_supply_type: 'Supply', sub_supply_description: '',
      document_type: 'Tax Invoice', document_number: 'KH/1', document_date: '27/11/2026',
      legal_name_of_consignor: 'Welton', address1_of_consignor: 'Taj', address2_of_consignor: 'Colaba',
      place_of_consignor: 'Mumbai', pincode_of_consignor: 400001,
      state_of_consignor: 'UTTARAKHAND', actual_from_state_name: 'MAHARASHTRA',
      gstin_of_consignee: '29AAABC0181E1ZE', legal_name_of_consignee: 'Sthuthya', address1_of_consignee: 'Nilaya',
      address2_of_consignee: 'Dasa', place_of_consignee: 'Bengaluru', pincode_of_consignee: 560001,
      state_of_supply: 'KARNATAKA', actual_to_state_name: 'KARNATAKA',
      transaction_type: 2, ship_to_gstin: '07AAABC0181E1ZX', ship_to_tradename: 'Ship Co',
      other_value: 1, total_invoice_value: 596, taxable_amount: 500, cgst_amount: 0, sgst_amount: 0, igst_amount: 90,
      cess_amount: 2, cess_nonadvol_value: 3,
      transporter_id: '05AAABB0639G1Z8', transporter_name: 'Fast Co',
      transporter_document_number: 'LR1', transporter_document_date: '25/11/2026',
      transportation_mode: 'Road', transportation_distance: '1769', vehicle_number: 'MH12AB1234', vehicle_type: 'Regular',
      generate_status: 1, data_source: 'erp', user_ref: '', location_code: '', eway_bill_status: 'ABC',
      auto_print: 'N', email: '', delete_record: 'N',
    });
    expect(itemList).toEqual([{
      product_name: 'Wheat', product_description: 'Wheat flour', hsn_code: 1001, quantity: 5, unit_of_product: 'BOX',
      cgst_rate: 0, sgst_rate: 0, igst_rate: 18, cess_rate: 1, cessNonAdvol: 2, taxable_amount: 500,
    }]);
  });

  it('maps document types, sub supply types, modes, ODC and blanks', () => {
    const t = { mode: 'ship' as const, docNumber: 'BL1', docDate: '2026-11-25', isOdc: true };
    const p: any = toMiEwayPayload(bill({ docType: 'CHL', subSupplyType: 4, shipToGstin: null, shipToTradeName: null }), t);
    expect(p).toMatchObject({
      document_type: 'Delivery Challan', sub_supply_type: 'Job Work', transportation_mode: 'Ship', vehicle_type: 'ODC',
      ship_to_gstin: '', ship_to_tradename: '', vehicle_number: '', transporter_id: '',
    });
    expect((toMiEwayPayload(bill({ docType: 'BIL', subSupplyType: 3 }), t) as any)).toMatchObject({ document_type: 'Bill of Supply', sub_supply_type: 'Export' });
    const sub = (n: number) => (toMiEwayPayload(bill({ subSupplyType: n }), t) as any).sub_supply_type;
    expect([5, 8, 9, 10, 11, 12].map(sub)).toEqual([
      'For Own Use', 'Others', 'SKD/CKD', 'Line Sales', 'Recipient not known', 'Exhibition or fairs',
    ]);
    expect((toMiEwayPayload(bill(), { mode: 'rail', docNumber: 'R1', docDate: '2026-11-25' }) as any).transportation_mode).toBe('Rail');
    expect((toMiEwayPayload(bill(), { mode: 'air', docNumber: 'A1', docDate: '2026-11-25' }) as any).transportation_mode).toBe('Air');
  });

  it('refuses a road bill with neither vehicle nor transporter', () => {
    expect(() => toMiEwayPayload(bill(), { mode: 'road' })).toThrow(
      new EwayBillInputError("Enter the vehicle number, or the transporter's GSTIN to generate Part A only"),
    );
  });
  it('refuses rail, air or ship without a document number and date', () => {
    for (const mode of ['rail', 'air', 'ship'] as const) {
      expect(() => toMiEwayPayload(bill(), { mode, docNumber: 'X' })).toThrow('Enter the transport document number and date');
    }
  });
  it('refuses more than 250 items', () => {
    const item = bill().itemList[0];
    expect(() => toMiEwayPayload(bill({ itemList: Array(251).fill(item) }), { mode: 'road', vehicleNumber: 'MH12AB1234' })).toThrow(
      'An e-way bill can carry at most 250 items',
    );
    expect(() => toMiEwayPayload(bill({ itemList: Array(250).fill(item) }), { mode: 'road', vehicleNumber: 'MH12AB1234' })).not.toThrow();
  });
  it('refuses a state code with no name', () => {
    expect(() => toMiEwayPayload(bill({ fromStateCode: 0 }), { mode: 'road', vehicleNumber: 'X' })).toThrow('Unknown state code 0');
  });
});

describe('calls', () => {
  it('reads the generate response', async () => {
    const f = replyWith(loginOk, fixture('eway-generate-ok.json'));
    const r = await miGenerateEway(creds, { a: 1 }, { fetch: f });
    expect(r.ewbNumber).toBe('371010926768');
    expect(r.generatedAt.toISOString()).toBe('2026-11-27T15:40:00.000Z');
    expect(r.validUntil?.toISOString()).toBe('2026-12-06T18:29:00.000Z');
    expect(r.printUrl).toBe('https://sandb-api.mastersindia.co/api/v1/detailPrintPdf/b2N0X2RlY18yMDI2LTI3-6b09a46da157428ddc7e19f9/');
    expect(r.duplicate).toBe(false);
    expect(r.requestId).toBe('ERP1795794029_KH/17957940280');
    expect(apiCall(f)).toMatchObject({ method: 'POST', body: { a: 1 } });
    expect(apiCall(f).url).toMatch(/\/ewayBillsGenerate\/$/);
  });
  it('flags a duplicate generate', async () => {
    const r = await miGenerateEway(creds, {}, { fetch: replyWith(loginOk, fixture('eway-generate-duplicate.json')) });
    expect(r.duplicate).toBe(true);
    expect(r.ewbNumber).toBe('371010926768');
    expect(r.alert).toMatch(/already generated on this document number/);
  });
  it('passes a rejection through as a GspError', async () => {
    await expect(miGenerateEway(creds, {}, { fetch: replyWith(loginOk, fixture('eway-generate-rejected.json')) }))
      .rejects.toMatchObject({ kind: 'rejected', nicCode: '437' });
  });

  it('finds a bill by document number', async () => {
    const f = replyWith(loginOk, fixture('eway-by-consigner.json'));
    const r = await miFindEwayByDocument(creds, G, 'KH/1', 'CHL', { fetch: f });
    expect(r).toMatchObject({ ewbNumber: '371010926768', printUrl: null, duplicate: false });
    expect(r!.validUntil?.toISOString()).toBe('2026-12-06T18:29:59.000Z');
    const u = new URL(apiCall(f).url);
    expect(u.pathname).toMatch(/\/getEwayBillData\/$/);
    expect(Object.fromEntries(u.searchParams)).toEqual({
      action: 'GetEwayBillGeneratedByConsigner', gstin: G, document_number: 'KH/1', document_type: 'Delivery Challan',
    });
  });
  it('returns null when no bill exists for the document', async () => {
    const none = json({ results: { message: '418: No record found.', status: 'No Content', code: 204, nic_code: '418' } });
    expect(await miFindEwayByDocument(creds, G, 'X/1', 'INV', { fetch: replyWith(loginOk, none) })).toBeNull();
  });
  it('does not hide other find failures', async () => {
    const bad = json({ results: { message: '312: nope', status: 'No Content', code: 204, nic_code: '312' } });
    await expect(miFindEwayByDocument(creds, G, 'X/1', 'INV', { fetch: replyWith(loginOk, bad) })).rejects.toBeInstanceOf(GspError);
  });

  it('reads the status of a bill', async () => {
    // The token from the first call is cached, so later fakes need no login reply.
    const f = replyWith(loginOk, fixture('eway-get.json'));
    expect(await miGetEwayStatus(creds, G, '371010926768', { fetch: f })).toBe('active');
    expect(Object.fromEntries(new URL(apiCall(f).url).searchParams)).toEqual({
      action: 'GetEwayBill', gstin: G, eway_bill_number: '371010926768',
    });
    expect(await miGetEwayStatus(creds, G, '1', { fetch: replyWith(ok({ eway_bill_status: 'CANCELLED' })) })).toBe('cancelled');
    expect(await miGetEwayStatus(creds, G, '1', { fetch: replyWith(ok({ eway_bill_status: 'Rejected' })) })).toBe('other');
    expect(await miGetEwayStatus(creds, G, '1', { fetch: replyWith(ok({})) })).toBe('other');
  });

  it('cancels a bill', async () => {
    const f = replyWith(loginOk, fixture('eway-cancel-ok.json'));
    const r = await miCancelEway(creds, { gstin: G, ewbNumber: '371010926768', reason: 'data_entry', remark: 'Typo' }, { fetch: f });
    expect(r.cancelledAt.toISOString()).toBe('2026-11-27T15:41:00.000Z');
    expect(apiCall(f).url).toMatch(/\/ewayBillCancel\/$/);
    expect(apiCall(f).body).toEqual({
      userGstin: G, eway_bill_number: 371010926768, reason_of_cancel: 'Data Entry Mistake', cancel_remark: 'Typo', data_source: 'erp',
    });
  });

  it('sends Part B with the state as a name and the date as DD/MM/YYYY', async () => {
    const f = replyWith(loginOk, fixture('eway-partb-ok.json'));
    const r = await miUpdatePartB(creds, {
      gstin: G, ewbNumber: '371010926768', transport: { mode: 'road', vehicleNumber: 'JJK8977', docNumber: '14456', docDate: '2026-11-25' },
      fromPlace: 'Mumbai', fromStateCode: '27', reason: 'breakdown',
    }, { fetch: f });
    expect(apiCall(f).url).toMatch(/\/updateVehicleNumber\/$/);
    expect(apiCall(f).body).toEqual({
      userGstin: G, eway_bill_number: 371010926768, vehicle_number: 'JJK8977', vehicle_type: 'r',
      place_of_consignor: 'Mumbai', state_of_consignor: 'MAHARASHTRA',
      reason_code_for_vehicle_updation: 'Due to Break Down', reason_for_vehicle_updation: '',
      transporter_document_number: '14456', transporter_document_date: '25/11/2026', mode_of_transport: '1', data_source: 'erp',
    });
    expect(r.validUntil?.toISOString()).toBe('2026-12-06T18:29:00.000Z');
    expect(r.printUrl).toMatch(/^https:\/\/sandb-api\.mastersindia\.co\/.*detailPrintPdf/);
  });
  it('sends the other Part B reasons and modes', async () => {
    const f = replyWith(loginOk, ok({ validUpto: '06/12/2026 11:59:00 PM' }), ok({ validUpto: null }));
    const a = { gstin: G, ewbNumber: '1', fromPlace: 'X', fromStateCode: '05' };
    const r = await miUpdatePartB(creds, { ...a, transport: { mode: 'rail', docNumber: 'R', docDate: '2026-11-25' }, reason: 'first_time', remark: 'hi' }, { fetch: f });
    expect(r.printUrl).toBeNull();
    expect(apiCall(f).body).toMatchObject({
      reason_code_for_vehicle_updation: 'First Time', reason_for_vehicle_updation: 'hi', mode_of_transport: '2', vehicle_number: '',
    });
    await miUpdatePartB(creds, { ...a, transport: { mode: 'road', vehicleNumber: 'V' }, reason: 'transhipment' }, { fetch: f });
    expect(f.calls[2].body).toMatchObject({ reason_code_for_vehicle_updation: 'Due to Transhipment', transporter_document_date: '' });
  });
  it('refuses Part B for rail without document details', async () => {
    await expect(miUpdatePartB(creds, {
      gstin: G, ewbNumber: '1', fromPlace: 'X', fromStateCode: '05', transport: { mode: 'rail' }, reason: 'others',
    }, { fetch: replyWith() })).rejects.toThrow('Enter the transport document number and date');
  });

  it('extends validity', async () => {
    const reply = ok({ ewayBillNo: '331009219156', updatedDate: '20/09/2023 07:07:00 PM', validUpto: '21/09/2023 11:59:00 PM', error: false, url: 'https://x' });
    const f = replyWith(loginOk, reply);
    const r = await miExtendEway(creds, {
      gstin: G, ewbNumber: '331009219156', transport: { mode: 'road', vehicleNumber: 'KA01AB1234', docNumber: 'T1', docDate: '2023-09-19' },
      fromPlace: 'Dehradun', fromStateCode: '05', fromPincode: '248001', remainingKm: 120, reason: 'natural_calamity', remark: 'Flood',
    }, { fetch: f });
    expect(r.validUntil.toISOString()).toBe('2023-09-21T18:29:00.000Z');
    expect(apiCall(f).url).toMatch(/\/ewayBillValidityExtend\/$/);
    expect(apiCall(f).body).toEqual({
      userGstin: G, eway_bill_number: 331009219156, vehicle_number: 'KA01AB1234', place_of_consignor: 'Dehradun',
      state_of_consignor: 'UTTARAKHAND', remaining_distance: 120, transporter_document_number: 'T1',
      transporter_document_date: '19/09/2023', mode_of_transport: '1', extend_validity_reason: 'Natural Calamity',
      extend_remarks: 'Flood', consignment_status: 'M', from_pincode: 248001, transit_type: '',
      address_line1: 'Dehradun', address_line2: '', address_line3: '', data_source: 'erp',
    });
  });
  it('extends a bill that is in transit', async () => {
    const valid = () => ok({ validUpto: '21/09/2023 11:59:00 PM' });
    const f = replyWith(loginOk, valid(), valid(), valid(), valid());
    const base = { gstin: G, ewbNumber: '1', transport: { mode: 'road' as const, vehicleNumber: 'V' }, fromPlace: 'P', fromStateCode: '5', fromPincode: '248001', remainingKm: 1, remark: 'r' };
    await miExtendEway(creds, { ...base, reason: 'law_and_order', inTransit: 'warehouse' }, { fetch: f });
    await miExtendEway(creds, { ...base, reason: 'transhipment', inTransit: 'road' }, { fetch: f });
    await miExtendEway(creds, { ...base, reason: 'accident', inTransit: 'others' }, { fetch: f });
    await miExtendEway(creds, { ...base, reason: 'others' }, { fetch: f });
    const sent = f.calls.filter((c) => c.body?.consignment_status).map((c) => c.body);
    expect(sent.map((b) => [b.extend_validity_reason, b.transit_type, b.consignment_status, b.mode_of_transport])).toEqual([
      ['Law and Order Situation', 'W', 'T', '5'], ['Transhipment', 'R', 'T', '5'], ['Accident', 'O', 'T', '5'], ['Others', '', 'M', '1'],
    ]);
  });

  it('closes a bill', async () => {
    const f = replyWith(loginOk, fixture('eway-close.json'));
    const r = await miCloseEway(creds, { gstin: G, ewbNumber: '391010926777', closureDate: '2026-11-27', remark: 'Closure EWB' }, { fetch: f });
    expect(r.closedAt.toISOString()).toBe('2026-11-27T15:40:41.000Z');
    expect(apiCall(f).url).toMatch(/\/ewayBillClosure\/$/);
    expect(apiCall(f).body).toEqual({
      userGstin: G, eway_bill_number: 391010926777, closure_date: '27/11/2026', remarks: 'Closure EWB', data_source: 'erp',
    });
  });

  it('keeps a print URL that already has a scheme', async () => {
    const r = await miGenerateEway(creds, {}, { fetch: replyWith(loginOk, ok({
      ewayBillNo: 1, ewayBillDate: '27/11/2026 09:10:00 PM', url: 'http://h/p', alert: '',
    })) });
    expect(r.printUrl).toBe('http://h/p');
  });
});
