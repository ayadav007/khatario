/**
 * Test the invoice extraction pipeline against a local image file.
 *
 * Usage:
 *   node scripts/test-invoice-extract.mjs <path-to-image>
 *   node scripts/test-invoice-extract.mjs  (uses default test image if set below)
 *
 * Requires the Next.js dev server to be running on http://localhost:3000
 */

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

const BUSINESS_ID = '3c349e4a-6031-45c0-a189-c570466f2758';
const BASE_URL = process.env.EXTRACT_BASE_URL || 'http://localhost:3000';

const imagePath = process.argv[2];
if (!imagePath) {
  console.error('Usage: node scripts/test-invoice-extract.mjs <path-to-image>');
  process.exit(1);
}

const fileBytes = readFileSync(imagePath);
const fileName = basename(imagePath);
const mimeType = fileName.match(/\.png$/i)
  ? 'image/png'
  : fileName.match(/\.(jpg|jpeg)$/i)
  ? 'image/jpeg'
  : 'application/octet-stream';

console.log('\n====================================================');
console.log('  Khatario Invoice Extraction — Pipeline Test');
console.log('====================================================');
console.log(`  File  : ${fileName} (${(fileBytes.length / 1024).toFixed(1)} KB)`);
console.log(`  Server: ${BASE_URL}`);
console.log(`  Biz   : ${BUSINESS_ID}`);
console.log('----------------------------------------------------\n');

const form = new FormData();
form.append('file', new Blob([fileBytes], { type: mimeType }), fileName);
form.append('business_id', BUSINESS_ID);

const t0 = Date.now();
let res;
try {
  res = await fetch(`${BASE_URL}/api/invoices/extract`, {
    method: 'POST',
    body: form,
  });
} catch (err) {
  console.error('❌  Could not reach the server:', err.message);
  console.error('    Is `npm run dev` running on port 3000?');
  process.exit(1);
}

const elapsed = Date.now() - t0;
const body = await res.json();

if (!res.ok || !body.success) {
  console.error(`❌  API error ${res.status}:`);
  console.error(JSON.stringify(body, null, 2));
  process.exit(1);
}

const d = body.data;
const g = body.gst_extraction;

// ─── Header ──────────────────────────────────────────────────────────────────
console.log('📄  SUPPLIER');
console.log(`    Name  : ${d.supplier?.name ?? '—'}`);
console.log(`    GSTIN : ${d.supplier?.gstin ?? '—'}`);

console.log('\n🧾  INVOICE');
console.log(`    Number    : ${d.invoice?.bill_number ?? '—'}`);
console.log(`    Date      : ${d.invoice?.bill_date ?? '—'}`);
console.log(`    Tax type  : ${d.invoice?.tax_type ?? '—'}`);
console.log(`    Price mode: ${d.invoice?.price_mode ?? '—'}`);
console.log(`    Place of supply: ${d.invoice?.place_of_supply ?? '—'}`);

// ─── Line items ───────────────────────────────────────────────────────────────
console.log('\n📦  LINE ITEMS');
const items = d.items ?? [];
if (!items.length) {
  console.log('    (none)');
} else {
  items.forEach((it, i) => {
    const disc = it.discount_amount > 0
      ? ` | disc ₹${it.discount_amount.toFixed(2)}${it.discount_on_tax_inclusive ? ' (off MRP)' : ''}`
      : '';
    console.log(`    [${i + 1}] ${it.item_name ?? '—'}`);
    console.log(`        HSN   : ${it.hsn_sac ?? '—'}`);
    console.log(`        Qty   : ${it.quantity}  Unit price: ₹${it.unit_price?.toFixed(2) ?? '—'}${disc}`);
    console.log(`        GST   : ${it.tax_rate ?? 0}%  Amount: ₹${it.amount?.toFixed(2) ?? '—'}`);
    if (it.cgst_amount != null) console.log(`        CGST  : ₹${it.cgst_amount.toFixed(2)}  SGST: ₹${it.sgst_amount?.toFixed(2)}`);
    if (it.igst_amount != null) console.log(`        IGST  : ₹${it.igst_amount.toFixed(2)}`);
  });
}

// ─── Totals ───────────────────────────────────────────────────────────────────
const t = d.totals ?? {};
console.log('\n💰  TOTALS');
console.log(`    Subtotal (taxable) : ₹${t.subtotal?.toFixed(2) ?? '—'}`);
if (t.cgst != null)  console.log(`    CGST               : ₹${t.cgst.toFixed(2)}`);
if (t.sgst != null)  console.log(`    SGST               : ₹${t.sgst.toFixed(2)}`);
if (t.igst != null)  console.log(`    IGST               : ₹${t.igst.toFixed(2)}`);
if (t.round_off != null && t.round_off !== 0) console.log(`    Round off          : ₹${t.round_off.toFixed(2)}`);
console.log(`    Grand Total        : ₹${t.grand_total?.toFixed(2) ?? '—'}`);

// ─── GST summary ─────────────────────────────────────────────────────────────
const slabs = t.gst_summary ?? [];
if (slabs.length) {
  console.log('\n📊  GST SUMMARY');
  slabs.forEach((s) => {
    console.log(
      `    ${s.gst_rate}%  taxable ₹${s.taxable_value?.toFixed(2)}  CGST ₹${s.cgst?.toFixed(2)}  SGST ₹${s.sgst?.toFixed(2)}  IGST ₹${s.igst?.toFixed(2)}  total tax ₹${s.total_tax?.toFixed(2)}`,
    );
  });
}

// ─── Pipeline metadata ────────────────────────────────────────────────────────
console.log('\n⚙️   PIPELINE');
console.log(`    Method    : ${body.extraction_method}`);
console.log(`    Time      : ${body.processing_time_ms} ms (total: ${elapsed} ms)`);
if (body.extraction_confidence) {
  const conf = body.extraction_confidence;
  console.log(`    Confidence: ${(conf.score * 100).toFixed(0)}%  (${conf.tier})`);
  if (conf.warnings?.length) console.log(`    Warnings  : ${conf.warnings.join(', ')}`);
}
if (body.debug?.spatial_table_injected != null) {
  console.log(`    Spatial table reconstructed: ${body.debug.spatial_table_injected ? '✅ YES' : '⬜ no (row-by-row or thermal)'}`);
}
if (body.debug?.layout_strategy) {
  console.log(`    Layout strategy: ${body.debug.layout_strategy}`);
}
if (body.debug?.ocr_preprocess) {
  const p = body.debug.ocr_preprocess;
  console.log(`    Preprocess: profile=${p.profile}  ${p.original_width}×${p.original_height} → ${p.width}×${p.height}`);
  console.log(`    Steps: ${(p.steps ?? []).join(', ')}`);
}

// ─── Math check ───────────────────────────────────────────────────────────────
console.log('\n🔢  MATH CHECK');
const expectedGrand = t.grand_total ?? 0;
const sub = t.subtotal ?? 0;
const tax = (t.cgst ?? 0) + (t.sgst ?? 0) + (t.igst ?? 0);
const ro = t.round_off ?? 0;
const computed = sub + tax + ro;
const ok = Math.abs(computed - expectedGrand) <= Math.max(2, expectedGrand * 0.01);
console.log(`    subtotal ₹${sub.toFixed(2)} + tax ₹${tax.toFixed(2)} + ro ₹${ro.toFixed(2)} = ₹${computed.toFixed(2)}  (grand total ₹${expectedGrand.toFixed(2)})  ${ok ? '✅' : '❌ mismatch'}`);

console.log('\n====================================================\n');
