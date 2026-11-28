// One-off SANDBOX recording for the e-invoice endpoints (generate, duplicate, by document, e-way bill by IRN, cancel).
// Prints endpoint names and response codes only; never credentials, tokens or request bodies.
// Separate from sandbox-smoke.ts so re-running the e-way script does not overwrite these fixtures. At most 12 calls.
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { gspBaseUrl, gspLogin } from '../../lib/gsp/mastersindia/client';

dotenv.config({ path: '.env.local' });

const OUT = path.join(__dirname, '..', '..', 'tests', 'fixtures', 'gsp');
const MAX_CALLS = 12;

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
  const SELLER = process.env.MASTERSINDIA_SANDBOX_EINVOICE_GSTIN || '';
  const BUYER = process.env.MASTERSINDIA_SANDBOX_EINVOICE_BUYER_GSTIN || '';
  if (!username || !password || !SELLER || !BUYER) throw new Error('Sandbox env vars missing');
  const token = await gspLogin({ username, password });
  console.log('login ok');

  let calls = 0;
  // POST: one request, no retry. GET: one retry, only on a network error.
  async function call(name: string, method: 'GET' | 'POST', p: string, body: unknown, fixture?: string) {
    if (++calls > MAX_CALLS) throw new Error('Call budget exceeded');
    const url = method === 'GET' ? `${base}/${p}?${new URLSearchParams(body as Record<string, string>).toString()}` : `${base}/${p}`;
    const init = {
      method,
      headers: { Authorization: `JWT ${token}`, 'Content-Type': 'application/json' },
      body: method === 'POST' ? JSON.stringify(body) : undefined,
    };
    let res: Response;
    try {
      res = await fetch(url, init);
    } catch {
      if (method !== 'GET') throw new Error(`${name}: network error`);
      if (++calls > MAX_CALLS) throw new Error('Call budget exceeded');
      res = await fetch(url, init);
    }
    const json: any = await res.json();
    if (fixture) fs.writeFileSync(path.join(OUT, fixture), JSON.stringify(json, null, 2) + '\n');
    console.log(`${name}: http ${res.status}, code ${json?.results?.code ?? json?.code ?? '-'}${fixture ? ' -> ' + fixture : ''}`);
    return json;
  }

  const freshDoc = () => `KH${String(Date.now()).slice(-10)}`;
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const irnOf = (b: any) => {
    const m = b?.results?.message;
    return m && typeof m === 'object' && typeof m.Irn === 'string' ? m.Irn : null;
  };

  // Same keys, types and omissions as buildEinvoice produces for an inter-state B2B sale.
  const invoice = (doc: string, extra: Record<string, unknown> = {}, sellerPin = 201301) => ({
    user_gstin: SELLER,
    data_source: 'erp',
    transaction_details: { supply_type: 'B2B', charge_type: 'N', igst_on_intra: 'N', ecommerce_gstin: '' },
    document_details: { document_type: 'INV', document_number: doc, document_date: today() },
    seller_details: {
      gstin: SELLER, legal_name: 'Welton Traders', address1: 'Sector 62', address2: '', location: 'Noida',
      pincode: sellerPin, state_code: '09',
    },
    buyer_details: {
      gstin: BUYER, legal_name: 'Sthuthya Stores', address1: 'Mall Road', address2: '', location: 'Haldwani',
      pincode: 263001, state_code: '05', place_of_supply: '05',
    },
    value_details: {
      total_assessable_value: 1000, total_cgst_value: 0, total_sgst_value: 0, total_igst_value: 50, total_cess_value: 0,
      total_discount: 0, total_other_charge: 0, round_off_amount: 0, total_invoice_value: 1050,
    },
    item_list: [{
      item_serial_number: '1', product_description: 'Wheat', is_service: 'N', hsn_code: '100190', quantity: 100, unit: 'KGS',
      unit_price: 10.0, total_amount: 1000, discount: 0, assessable_value: 1000, gst_rate: 5,
      igst_amount: 50, cgst_amount: 0, sgst_amount: 0, cess_amount: 0, total_item_value: 1050,
    }],
    ...extra,
  });
  const transport = {
    transporter_id: '', transporter_name: '', transportation_mode: '1', transportation_distance: 270,
    transporter_document_number: '', transporter_document_date: '', vehicle_number: 'UP16AB1234', vehicle_type: 'R',
  };

  // 1. generate, no e-way details
  const doc1 = freshDoc();
  const body1 = invoice(doc1);
  const g1 = await call('generate', 'POST', 'einvoice/', body1, 'einvoice-generate-ok.json');
  const irn1 = irnOf(g1);
  if (!irn1) return console.log('No IRN from the first generate; stopping');

  // 2. the same document again
  await call('generate again (same document)', 'POST', 'einvoice/', body1, 'einvoice-duplicate.json');

  // 3. by document
  await call('get by document', 'GET', 'get-einvoice-bydoc', {
    user_gstin: SELLER, document_type: 'INV', document_number: doc1, document_date: today(),
  }, 'einvoice-by-doc.json');

  // 4. e-way bill by IRN
  await call('e-way bill by IRN', 'POST', 'gen-ewb-by-irn/', {
    user_gstin: SELLER, irn: irn1, transporter_id: '', transportation_mode: '1', transporter_document_number: '',
    transporter_document_date: '', vehicle_number: 'UP16AB1234', distance: 270, vehicle_type: 'R', transporter_name: '',
    data_source: 'erp',
  }, 'ewb-by-irn-ok.json');

  // 5. generate with e-way details
  await wait(1100);
  await call('generate with e-way bill', 'POST', 'einvoice/', invoice(freshDoc(), { ewaybill_details: transport }), 'einvoice-generate-with-ewb.json');

  // 6. generate then cancel
  await wait(1100);
  const g3 = await call('generate (to cancel)', 'POST', 'einvoice/', invoice(freshDoc()));
  const irn3 = irnOf(g3);
  if (irn3) {
    await call('cancel', 'POST', 'cancel-einvoice/', {
      user_gstin: SELLER, irn: irn3, cancel_reason: '1', cancel_remarks: 'Wrong entry', ewaybill_cancel: '',
    }, 'einvoice-cancel-ok.json');
  } else console.log('No IRN for the third document; skipping cancel');

  // 7. deliberately wrong request
  await wait(1100);
  await call('generate (seller pincode 999999)', 'POST', 'einvoice/', invoice(freshDoc(), {}, 999999), 'einvoice-rejected.json');

  // 8. document that does not exist
  await call('get by document (missing)', 'GET', 'get-einvoice-bydoc', {
    user_gstin: SELLER, document_type: 'INV', document_number: 'KH9999999999', document_date: today(),
  }, 'einvoice-by-doc-missing.json');
  console.log(`done, ${calls} calls`);
}

main().catch((e) => {
  console.error('FAILED:', e?.name, e?.kind || '', e?.message);
  process.exit(1);
});
