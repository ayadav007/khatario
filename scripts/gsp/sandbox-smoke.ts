// Records Masters India SANDBOX responses as fixtures. Prints endpoint names and response codes only.
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { gspBaseUrl, gspLogin } from '../../lib/gsp/mastersindia/client';

dotenv.config({ path: '.env.local' });

const OUT = path.join(__dirname, '..', '..', 'tests', 'fixtures', 'gsp');
const notes: string[] = [];

function today(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

async function main() {
  const base = gspBaseUrl();
  if (!base.includes('sandb-api')) throw new Error('Refusing to run: base URL is not the sandbox');
  const username = process.env.MASTERSINDIA_SANDBOX_USERNAME || '';
  const password = process.env.MASTERSINDIA_SANDBOX_PASSWORD || '';
  const G1 = process.env.MASTERSINDIA_SANDBOX_GSTIN || '';
  const G2 = process.env.MASTERSINDIA_SANDBOX_GSTIN_2 || '';
  if (!username || !password || !G1 || !G2) throw new Error('Sandbox env vars missing');
  const token = await gspLogin({ username, password });
  console.log('login ok');

  async function call(
    name: string,
    method: 'GET' | 'POST',
    p: string,
    opts: { query?: Record<string, string>; body?: unknown; fixture?: string },
  ) {
    let url = `${base}/${p}`;
    if (opts.query) url += '?' + new URLSearchParams(opts.query).toString();
    const doit = () =>
      fetch(url, {
        method,
        headers: { Authorization: `JWT ${token}`, 'Content-Type': 'application/json' },
        body: method === 'POST' ? JSON.stringify(opts.body ?? {}) : undefined,
      });
    let res: Response;
    try {
      res = await doit();
    } catch {
      res = await doit();
    }
    const body: any = await res.json();
    if (opts.fixture) fs.writeFileSync(path.join(OUT, opts.fixture), JSON.stringify(body, null, 2) + '\n');
    const code = body?.results?.code ?? body?.code ?? res.status;
    console.log(`${name}: code ${code}${opts.fixture ? ' -> ' + opts.fixture : ''}`);
    return body;
  }

  let seq = 0;
  const docNo = () => `KH/${Math.floor(Date.now() / 1000)}${seq++}`.slice(0, 16);
  const genBody = (doc: string, over: Record<string, any> = {}) => ({
    userGstin: G1, supply_type: 'outward', sub_supply_type: 'Supply', sub_supply_description: '',
    document_type: 'Tax Invoice', document_number: doc, document_date: today(),
    gstin_of_consignor: G1, legal_name_of_consignor: 'Welton',
    address1_of_consignor: 'The Taj Mahal Palace,Apollo Bandar', address2_of_consignor: 'Colaba,Mumbai',
    place_of_consignor: 'Mumbai', pincode_of_consignor: 400001, state_of_consignor: 'UTTARAKHAND',
    actual_from_state_name: 'MAHARASHTRA',
    gstin_of_consignee: G2, legal_name_of_consignee: 'Sthuthya',
    address1_of_consignee: 'Shree Nilaya', address2_of_consignee: 'Dasarahosahalli',
    place_of_consignee: 'Dehradun', pincode_of_consignee: 248001, state_of_supply: 'UTTARAKHAND',
    actual_to_state_name: 'UTTARAKHAND', transaction_type: 3, ship_to_gstin: '', ship_to_tradename: '',
    other_value: 0, total_invoice_value: 560, taxable_amount: 500, cgst_amount: 30, sgst_amount: 30,
    igst_amount: 0, cess_amount: 0, cess_nonadvol_value: 0,
    transporter_id: G1, transporter_name: '', transporter_document_number: '', transporter_document_date: '',
    transportation_mode: 'Road', transportation_distance: '1769', vehicle_number: 'WXX2121', vehicle_type: 'Regular',
    generate_status: 1, data_source: 'erp', user_ref: '', location_code: '', eway_bill_status: 'ABC',
    auto_print: 'N', email: '', delete_record: 'N',
    itemList: [{
      product_name: 'Wheat', product_description: 'Wheat', hsn_code: '1001', quantity: 5, unit_of_product: 'BOX',
      cgst_rate: 6, sgst_rate: 6, igst_rate: 0, cess_rate: 0, cessNonAdvol: 0, taxable_amount: 500,
    }],
    ...over,
  });
  const ewbNo = (b: any) => {
    const m = b?.results?.message;
    return m && typeof m === 'object' ? (m.ewayBillNo ?? m.eway_bill_number ?? m.ewb_no ?? null) : null;
  };
  const msg = (b: any) => {
    const m = b?.results?.message;
    return typeof m === 'string' ? m : JSON.stringify(b?.results ?? b).slice(0, 300);
  };
  const ok = (b: any) => b?.results?.code === 200;
  const record = (what: string, b: any) => notes.push(`${what}: ${ok(b) ? 'accepted' : 'rejected - ' + msg(b)}`);

  // Main flow
  let docA = docNo();
  let gA = await call('generate', 'POST', 'ewayBillsGenerate/', { body: genBody(docA), fixture: 'eway-generate-ok.json' });
  const same = { place_of_consignor: 'Dehradun', pincode_of_consignor: 248001, actual_from_state_name: 'UTTARAKHAND', transaction_type: 1 };
  let base1: Record<string, any> = {};
  if (!ok(gA)) {
    notes.push(`MAIN: sample request rejected (${msg(gA)}); retried same-state`);
    fs.writeFileSync(path.join(OUT, 'eway-generate-sample-rejected.json'), JSON.stringify(gA, null, 2) + '\n');
    base1 = same;
    docA = docNo();
    gA = await call('generate (same-state)', 'POST', 'ewayBillsGenerate/', { body: genBody(docA, same), fixture: 'eway-generate-ok.json' });
  }
  const noA = ewbNo(gA);
  if (!noA) {
    console.log('No eway bill number obtained; stopping');
    return finish();
  }

  await call('generate duplicate', 'POST', 'ewayBillsGenerate/', { body: genBody(docA, base1), fixture: 'eway-generate-duplicate.json' });
  await call('get', 'GET', 'getEwayBillData/', { query: { action: 'GetEwayBill', gstin: G1, eway_bill_number: String(noA) }, fixture: 'eway-get.json' });
  await call('by consigner', 'GET', 'getEwayBillData/', { query: { action: 'GetEwayBillGeneratedByConsigner', gstin: G1, document_number: docA, document_type: 'Tax Invoice' }, fixture: 'eway-by-consigner.json' });

  const partB = (reasonCode: string, veh = 'JJK8977') => ({
    userGstin: G1, eway_bill_number: Number(noA), vehicle_number: veh, vehicle_type: 'r',
    place_of_consignor: base1.place_of_consignor ?? 'Mumbai', state_of_consignor: 'Uttarakhand',
    reason_code_for_vehicle_updation: reasonCode, reason_for_vehicle_updation: '',
    transporter_document_number: '14456', transporter_document_date: today(), mode_of_transport: 1, data_source: '',
  });
  const pb = await call('part B', 'POST', 'updateVehicleNumber/', { body: partB('due to break down'), fixture: 'eway-partb-ok.json' });
  record('reason_code_for_vehicle_updation "due to break down"', pb);

  for (const r of ['Due to Break Down', 'Due to Transhipment', 'Others', 'First Time']) {
    const x = await call(`probe partB reason ${r}`, 'POST', 'updateVehicleNumber/', { body: partB(r, 'JJK8978') });
    record(`reason_code_for_vehicle_updation "${r}"`, x);
  }

  let b = await call('probe state numeric', 'POST', 'ewayBillsGenerate/', { body: genBody(docNo(), { ...base1, state_of_consignor: 5 }) });
  record('state_of_consignor 5 (numeric)', b);
  for (const v of ['ODC', 'Over Dimensional Cargo']) {
    b = await call(`probe vehicle_type ${v}`, 'POST', 'ewayBillsGenerate/', { body: genBody(docNo(), { ...base1, vehicle_type: v }) });
    record(`vehicle_type "${v}"`, b);
  }
  for (const s of ['Job Work', 'For Own Use', 'Exhibition or fairs', 'Line Sales', 'Recipient not known', 'SKD/CKD']) {
    b = await call(`probe sub_supply_type ${s}`, 'POST', 'ewayBillsGenerate/', { body: genBody(docNo(), { ...base1, sub_supply_type: s }) });
    record(`sub_supply_type "${s}"`, b);
  }

  const cancelBody = (no: any, reason: string) => ({
    userGstin: G1, eway_bill_number: Number(no), reason_of_cancel: reason, cancel_remark: 'Cancelled the order', data_source: 'erp',
  });
  const c = await call('cancel', 'POST', 'ewayBillCancel/', { body: cancelBody(noA, 'Others'), fixture: 'eway-cancel-ok.json' });
  record('reason_of_cancel "Others"', c);
  for (const r of ['Duplicate', 'Order Cancelled', 'Data Entry Mistake']) {
    const x = await call(`probe cancel reason ${r} (already cancelled bill)`, 'POST', 'ewayBillCancel/', { body: cancelBody(noA, r) });
    notes.push(`reason_of_cancel "${r}" (sent for an already cancelled bill; only a validation message is informative): ${msg(x)}`);
  }

  await call('rejected (wrong pincode)', 'POST', 'ewayBillsGenerate/', { body: genBody(docNo(), { ...base1, pincode_of_consignor: 999999 }), fixture: 'eway-generate-rejected.json' });

  const g2 = await call('generate 2', 'POST', 'ewayBillsGenerate/', { body: genBody(docNo(), base1) });
  const no2 = ewbNo(g2);
  if (no2) {
    await call('closure', 'POST', 'ewayBillClosure/', {
      body: { userGstin: G1, eway_bill_number: Number(no2), closure_date: today(), remarks: 'Closure EWB', data_source: 'erp' },
      fixture: 'eway-close.json',
    });
  }
  finish();

  function finish() {
    console.log(notes.join('\n'));
    console.log('done');
  }
}

main().catch((e) => {
  console.error('FAILED:', e?.name, e?.kind || '', e?.message);
  process.exit(1);
});
