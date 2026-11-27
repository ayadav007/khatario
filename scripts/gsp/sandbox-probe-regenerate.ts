// One-off SANDBOX probe: can a document number get a new e-way bill after its bill is cancelled?
// Login, generate, cancel, generate again on the same document number: 4 calls at most.
// Prints endpoint names and response codes only; never credentials, tokens or request bodies.
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { gspBaseUrl, gspLogin } from '../../lib/gsp/mastersindia/client';

dotenv.config({ path: '.env.local' });

const OUT = path.join(__dirname, '..', '..', 'tests', 'fixtures', 'gsp');

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

  // One request each, no retry, so the call count stays at 4.
  async function call(name: string, p: string, body: unknown, fixture?: string) {
    const res = await fetch(`${base}/${p}`, {
      method: 'POST',
      headers: { Authorization: `JWT ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json: any = await res.json();
    if (fixture) fs.writeFileSync(path.join(OUT, fixture), JSON.stringify(json, null, 2) + '\n');
    console.log(`${name}: http ${res.status}, code ${json?.results?.code ?? json?.code ?? '-'}${fixture ? ' -> ' + fixture : ''}`);
    return json;
  }
  const ewbNo = (b: any) => {
    const m = b?.results?.message;
    return m && typeof m === 'object' ? (m.ewayBillNo ?? m.eway_bill_number ?? null) : null;
  };

  const doc = `KR/${Math.floor(Date.now() / 1000)}`.slice(0, 16);
  const genBody = {
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
  };

  const first = await call('generate', 'ewayBillsGenerate/', genBody);
  const no1 = ewbNo(first);
  if (!no1) return console.log('No e-way bill number from the first generate; stopping');
  const cancelled = await call('cancel', 'ewayBillCancel/', {
    userGstin: G1, eway_bill_number: Number(no1), reason_of_cancel: 'Others', cancel_remark: 'Probe', data_source: 'erp',
  });
  if (cancelled?.results?.code !== 200) return console.log('Cancel not accepted; stopping');
  const third = await call('generate again (same document number)', 'ewayBillsGenerate/', genBody, 'eway-regenerate-after-cancel.json');
  const no3 = ewbNo(third);
  console.log(no3 == null ? 'third call: no e-way bill number' : String(no3) === String(no1) ? 'third call: SAME number as the cancelled bill' : 'third call: NEW number');
  console.log(`third call alert present: ${typeof third?.results?.message?.alert === 'string' && !!third.results.message.alert.trim()}`);
}

main().catch((e) => {
  console.error('FAILED:', e?.name, e?.kind || '', e?.message);
  process.exit(1);
});
