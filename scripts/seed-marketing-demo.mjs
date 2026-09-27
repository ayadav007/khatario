/**
 * Seeds a realistic, fully fictional demo business for marketing screenshots.
 * Everything is created through the app's own APIs so GST, numbering, stock and
 * payment records are exactly what a real shop would see.
 *
 * Prerequisite: dev server running with OTP skipped, e.g.
 *   $env:PLATFORM_SKIP_OTP='1'; npm run dev
 * Run:
 *   node scripts/seed-marketing-demo.mjs
 *
 * Local only. Do not point DEMO_BASE_URL at production.
 */

const BASE = process.env.DEMO_BASE_URL || 'http://localhost:3000';
const PHONE = process.env.DEMO_PHONE || '9000000001';
const PASSWORD = process.env.DEMO_PASSWORD || 'Demo@12345';

if (/khatario\.com/i.test(BASE) && !/staging\./i.test(BASE)) {
  console.error('Refusing to seed demo data into production.');
  process.exit(1);
}

const BUSINESS = {
  name: 'Shree Ganesh Kirana & General Stores',
  email: 'hello@shreeganeshkirana.example',
  phone: '9000000002',
  address_line1: 'Shop 4, Laxmi Market, Karve Road',
  address_line2: 'Kothrud',
  city: 'Pune',
  state: 'Maharashtra',
  state_code: '27',
  pincode: '411038',
  gstin: '27AAPFS4821K1Z6',
  pan: 'AAPFS4821K',
  gst_registration_type: 'regular',
};

const CATEGORIES = ['Grains & Staples', 'Oils & Ghee', 'Tea, Coffee & Beverages', 'Snacks', 'Personal Care', 'Household', 'Dairy', 'Dry Fruits'];

// Prices are before GST; price + GST stays at or under MRP. Rates follow the Sept 2025 GST revision.
const ITEMS = [
  ['Basmati Rice 5kg', 'Grains & Staples', '10063020', 5, 590, 650, 480, 'BAG', 60],
  ['Whole Wheat Atta 10kg', 'Grains & Staples', '11010000', 5, 460, 499, 390, 'BAG', 45],
  ['Toor Dal 1kg', 'Grains & Staples', '07136000', 5, 165, 180, 135, 'PCS', 80],
  ['Sugar 1kg', 'Grains & Staples', '17019990', 5, 48, 52, 40, 'PCS', 120],
  ['Sunflower Oil 1L', 'Oils & Ghee', '15121910', 5, 145, 160, 120, 'PCS', 70],
  ['Mustard Oil 1L', 'Oils & Ghee', '15149120', 5, 175, 190, 148, 'PCS', 50],
  ['Desi Ghee 500ml', 'Oils & Ghee', '04059020', 5, 330, 360, 280, 'PCS', 36],
  ['Tea Powder 500g', 'Tea, Coffee & Beverages', '09024020', 5, 260, 285, 210, 'PCS', 40],
  ['Instant Coffee 100g', 'Tea, Coffee & Beverages', '21011120', 5, 310, 340, 255, 'PCS', 30],
  ['Mineral Water 1L', 'Tea, Coffee & Beverages', '22011010', 5, 19, 20, 14, 'PCS', 200],
  ['Glucose Biscuits 800g', 'Snacks', '19053100', 5, 90, 100, 72, 'PCS', 70],
  ['Aloo Bhujia 400g', 'Snacks', '21069099', 5, 105, 115, 84, 'PCS', 60],
  ['Bath Soap (Pack of 4)', 'Personal Care', '34011190', 5, 160, 180, 128, 'PCS', 60],
  ['Toothpaste 150g', 'Personal Care', '33061020', 5, 95, 105, 76, 'PCS', 60],
  ['Shampoo 340ml', 'Personal Care', '33051090', 5, 210, 235, 170, 'PCS', 35],
  ['Detergent Powder 1kg', 'Household', '34022090', 18, 165, 199, 132, 'PCS', 70],
  ['Floor Cleaner 1L', 'Household', '34029099', 18, 185, 225, 150, 'PCS', 40],
  ['Dishwash Liquid 500ml', 'Household', '34022090', 18, 90, 110, 70, 'PCS', 50],
  ['Toned Milk 1L', 'Dairy', '04012000', 0, 56, 56, 50, 'PCS', 60],
  ['Paneer 200g', 'Dairy', '04069000', 0, 90, 95, 75, 'PCS', 30],
  // Deliberately low so dashboards show a low-stock alert.
  ['Cashew Nuts 250g', 'Dry Fruits', '08013220', 5, 280, 310, 235, 'PCS', 3, 10],
];

const CUSTOMERS = [
  { name: 'Sharma & Sons', company_name: 'Sharma & Sons', phone: '9000000101', gstin: '27AAFFS2345K1Z8', city: 'Pune', state: 'Maharashtra', pincode: '411004', address: '12, FC Road, Shivajinagar', credit_days: 15, b2b: true },
  { name: 'Patil Tiffin Services', company_name: 'Patil Tiffin Services', phone: '9000000102', gstin: '27ABCPP4567L1Z3', city: 'Pune', state: 'Maharashtra', pincode: '411052', address: 'Warje Malwadi Road', credit_days: 15, b2b: true },
  { name: 'Hotel Sai Palace', company_name: 'Hotel Sai Palace', phone: '9000000103', gstin: '27AAKFH7890M1Z2', city: 'Nashik', state: 'Maharashtra', pincode: '422002', address: 'College Road', credit_days: 30, b2b: true },
  { name: 'Deshmukh Caterers', company_name: 'Deshmukh Caterers', phone: '9000000104', gstin: '27AAQFD1234N1Z6', city: 'Pune', state: 'Maharashtra', pincode: '411030', address: 'Sadashiv Peth', credit_days: 15, b2b: true },
  { name: 'Green Leaf Café', company_name: 'Green Leaf Café', phone: '9000000105', gstin: '29AAHFG5678P1Z4', city: 'Bengaluru', state: 'Karnataka', pincode: '560034', address: '80 Feet Road, Koramangala', credit_days: 30, b2b: true },
  { name: 'Rohan Kulkarni', phone: '9000000106', city: 'Pune', state: 'Maharashtra', pincode: '411038' },
  { name: 'Sneha Joshi', phone: '9000000107', city: 'Pune', state: 'Maharashtra', pincode: '411029' },
  { name: 'Amit Verma', phone: '9000000108', city: 'Pune', state: 'Maharashtra', pincode: '411045' },
  { name: 'Priya Iyer', phone: '9000000109', city: 'Pune', state: 'Maharashtra', pincode: '411007' },
  { name: 'Farhan Shaikh', phone: '9000000110', city: 'Pune', state: 'Maharashtra', pincode: '411001' },
];

const SUPPLIERS = [
  { name: 'Pune Wholesale Traders', phone: '9000000201', gstin: '27AAECP1111Q1Z9', city: 'Pune', state: 'Maharashtra', address: 'Market Yard, Gultekdi' },
  { name: 'Deccan FMCG Distributors', phone: '9000000202', gstin: '27AAGFD2222R1Z1', city: 'Pune', state: 'Maharashtra', address: 'Bhosari MIDC' },
];

// ---------------------------------------------------------------------------

const jar = new Map();

function storeCookies(res) {
  const raw = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  for (const line of raw) {
    const [pair] = line.split(';');
    const i = pair.indexOf('=');
    if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
}

async function api(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
  });
  storeCookies(res);
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text.slice(0, 300) }; }
  return { status: res.status, json };
}

async function must(method, path, body, okStatuses = [200, 201]) {
  const r = await api(method, path, body);
  if (!okStatuses.includes(r.status)) {
    throw new Error(`${method} ${path} → ${r.status}: ${JSON.stringify(r.json).slice(0, 400)}`);
  }
  return r.json;
}

function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260927);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const between = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));

function isoDaysAgo(days) {
  const d = new Date(Date.now() + 5.5 * 3600_000);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}
function addDays(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------

async function signupOrLogin() {
  const signup = await api('POST', '/api/signup', {
    businessName: BUSINESS.name,
    businessEmail: BUSINESS.email,
    businessPhone: BUSINESS.phone,
    businessType: 'retail',
    industry: 'food_beverages',
    businessModel: 'mixed',
    userName: 'Ganesh Patil',
    userPhone: PHONE,
    password: PASSWORD,
    productLine: 'billing',
  });
  if (signup.status === 403 && signup.json?.code === 'OTP_REQUIRED') {
    throw new Error('Signup needs OTP. Restart the dev server with PLATFORM_SKIP_OTP=1 and run again.');
  }
  const fresh = signup.status === 201;
  if (!fresh && signup.status !== 409) {
    throw new Error(`Signup failed → ${signup.status}: ${JSON.stringify(signup.json)}`);
  }
  jar.clear();
  const login = await must('POST', '/api/auth/login', { phone: PHONE, password: PASSWORD });
  return { fresh, userId: login.user.id, businessId: login.business?.id ?? login.user.business_id };
}

async function main() {
  console.log(`Seeding demo business at ${BASE} …`);
  const { fresh, userId, businessId } = await signupOrLogin();

  const list = async (path, key) => {
    const r = await api('GET', path);
    return r.json?.[key] ?? r.json?.data ?? [];
  };
  const hasInvoices = (await list(`/api/invoices?business_id=${businessId}&limit=1`, 'invoices')).length > 0;
  if (!fresh && hasInvoices) {
    console.log('Demo business already has data — nothing to do.');
    printLogin();
    return;
  }

  await must('PATCH', `/api/business/${businessId}`, {
    ...BUSINESS,
    company_introduction: 'Your neighbourhood kirana since 1998 — groceries, staples and household essentials, with home delivery across Kothrud.',
  });
  console.log('✓ Business profile');

  const categoryIds = {};
  const known = await api('GET', `/api/categories?business_id=${businessId}`);
  for (const c of known.json?.categories ?? []) categoryIds[c.name] = c.id;
  for (const name of CATEGORIES) {
    if (categoryIds[name]) continue;
    const r = await must('POST', '/api/categories', { business_id: businessId, name, created_by_user_id: userId });
    categoryIds[name] = r.category.id;
  }
  console.log(`✓ ${CATEGORIES.length} categories`);

  const items = [];
  const knownItems = new Map((await list(`/api/items?business_id=${businessId}&limit=500`, 'items')).map((i) => [i.name, i]));
  for (const [name, cat, hsn, rate, price, mrp, cost, unit, stock, minStock = 5] of ITEMS) {
    if (knownItems.has(name)) {
      items.push({ ...knownItems.get(name), purchase_price: cost, stockLeft: stock, rate, price, hsn, unit, sellable: stock > minStock });
      continue;
    }
    const r = await must('POST', '/api/items', {
      business_id: businessId,
      created_by: userId,
      name,
      category_id: categoryIds[cat],
      hsn_sac: hsn,
      tax_rate: rate,
      selling_price: price,
      mrp,
      purchase_price: cost,
      unit,
      opening_stock: stock,
      min_stock: minStock,
      item_type: 'goods',
      show_in_store: true,
    });
    items.push({ ...r.item, stockLeft: stock, rate, price, hsn, unit, sellable: stock > minStock });
  }
  console.log(`✓ ${items.length} items`);

  const customers = [];
  const knownCustomers = new Map((await list(`/api/customers?business_id=${businessId}&limit=500`, 'customers')).map((c) => [c.name, c]));
  for (const c of CUSTOMERS) {
    const { b2b, ...body } = c;
    if (knownCustomers.has(body.name)) {
      customers.push({ ...knownCustomers.get(body.name), b2b: !!b2b, stateCode: body.gstin ? body.gstin.slice(0, 2) : '27' });
      continue;
    }
    const r = await must('POST', '/api/customers', {
      business_id: businessId,
      created_by: userId,
      ...body,
      billing_address: body.address ? `${body.address}, ${body.city} ${body.pincode}` : undefined,
    });
    customers.push({ ...r.customer, b2b: !!b2b, stateCode: body.gstin ? body.gstin.slice(0, 2) : '27' });
  }
  console.log(`✓ ${customers.length} customers`);

  const suppliers = [];
  const knownSuppliers = new Map((await list(`/api/suppliers?business_id=${businessId}&limit=500`, 'suppliers')).map((s) => [s.name, s]));
  for (const s of SUPPLIERS) {
    if (knownSuppliers.has(s.name)) { suppliers.push(knownSuppliers.get(s.name)); continue; }
    const r = await must('POST', '/api/suppliers', { business_id: businessId, created_by: userId, ...s });
    suppliers.push(r.supplier ?? r);
  }
  console.log(`✓ ${suppliers.length} suppliers`);

  // Two restock bills from suppliers earlier in the month.
  const restock = [
    { supplier: suppliers[0], days: 26, bill: 'PWT/2627/0412', lines: [['Basmati Rice 5kg', 20], ['Whole Wheat Atta 10kg', 15], ['Toor Dal 1kg', 30], ['Sugar 1kg', 50]] },
    { supplier: suppliers[1], days: 12, bill: 'DFD-7781', lines: [['Detergent Powder 1kg', 24], ['Bath Soap (Pack of 4)', 24], ['Toothpaste 150g', 24], ['Shampoo 340ml', 12]] },
  ];
  for (const bill of restock) {
    const lines = bill.lines.map(([name, qty]) => {
      const it = items.find((i) => i.name === name);
      it.stockLeft += qty;
      return { item_id: it.id, item_name: it.name, hsn_sac: it.hsn, quantity: qty, unit: it.unit, unit_price: Number(it.purchase_price), discount_percent: 0, tax_rate: it.rate };
    });
    await must('POST', '/api/purchases', {
      supplier_id: bill.supplier.id,
      bill_number: bill.bill,
      bill_date: isoDaysAgo(bill.days),
      status: 'final',
      created_by: userId,
      place_of_supply_state_code: '27',
      price_mode: 'exclusive',
      paid_amount: 0,
      items: lines,
    });
  }
  console.log(`✓ ${restock.length} purchase bills`);

  // ~28 invoices spread over the last four weeks, busier on recent days.
  const modes = ['upi', 'upi', 'upi', 'cash', 'cash', 'bank_transfer'];
  let invoiceCount = 0;
  let unpaid = 0;
  for (let n = 0; n < 28; n++) {
    const days = Math.max(0, Math.floor(27 * Math.pow(rand(), 1.4)));
    const date = isoDaysAgo(days);
    const walkIn = rand() < 0.2;
    const customer = walkIn ? null : pick(customers);
    const b2b = !!customer?.b2b;
    const lineCount = b2b ? between(3, 6) : between(1, 4);
    const pool = items.filter((i) => i.sellable);
    const chosen = new Set();
    while (chosen.size < lineCount) chosen.add(pick(pool));
    const lines = [];
    for (const it of chosen) {
      const qty = Math.min(b2b ? between(3, 10) : between(1, 3), Math.max(0, it.stockLeft - 6));
      if (qty <= 0) continue;
      it.stockLeft -= qty;
      lines.push({ item_id: it.id, item_name: it.name, hsn_sac: it.hsn, quantity: qty, unit: it.unit, unit_price: it.price, discount_percent: b2b && rand() < 0.3 ? 2 : 0, tax_rate: it.rate });
    }
    if (!lines.length) continue;

    const estimate = lines.reduce((s, l) => s + l.quantity * l.unit_price * (1 - l.discount_percent / 100) * (1 + l.tax_rate / 100), 0);
    const roll = rand();
    let paid = estimate;
    if (b2b && roll < 0.45) { paid = 0; unpaid++; }
    else if (b2b && roll < 0.65) paid = Math.round(estimate * 0.5 / 100) * 100;
    else if (!b2b && days < 3 && roll < 0.15) { paid = 0; unpaid++; }

    const r = await must('POST', '/api/invoices', {
      customer_id: customer?.id ?? null,
      invoice_date: date,
      due_date: addDays(date, b2b ? customer.credit_days || 15 : 0),
      status: 'final',
      document_type: 'tax_invoice',
      place_of_supply_state_code: customer?.stateCode ?? '27',
      items: lines,
      enable_round_off: true,
      notes: b2b ? 'Thank you for your business.' : '',
      payments: paid > 0 ? [{ amount: Math.round(paid), mode: pick(modes), date }] : [],
    });
    if (paid >= estimate && r.totals?.grand_total > paid) {
      await api('PATCH', `/api/invoices/${r.invoice.id}/payments`, { amount: +(r.totals.grand_total - Math.round(paid)).toFixed(2), payment_mode: 'upi', payment_date: date });
    }
    invoiceCount++;
  }
  console.log(`✓ ${invoiceCount} invoices (${unpaid} unpaid, rest paid or part-paid)`);

  const expenses = [
    { amount: 25000, days: 25, description: 'Shop rent — this month', payment_mode: 'bank_transfer' },
    { amount: 3840, days: 18, description: 'Electricity bill (MSEDCL)', payment_mode: 'upi' },
    { amount: 1200, days: 9, description: 'Delivery bike fuel', payment_mode: 'cash' },
  ];
  for (const e of expenses) {
    await must('POST', '/api/expenses', { amount: e.amount, expense_date: isoDaysAgo(e.days), description: e.description, payment_mode: e.payment_mode, created_by: userId });
  }
  console.log(`✓ ${expenses.length} expenses`);

  printLogin();
}

function printLogin() {
  console.log('\nDemo login (local only):');
  console.log(`  URL:      ${BASE}/login`);
  console.log(`  Phone:    ${PHONE}`);
  console.log(`  Password: ${PASSWORD}`);
}

main().catch((e) => {
  console.error('\nSeed failed:', e.message);
  process.exit(1);
});
