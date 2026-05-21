/**
 * Direct extraction pipeline test — no HTTP, no auth.
 * Calls runGoogleVisionGroqTextPipeline directly with a local image file.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register scripts/test-extract-direct.ts <image-path>
 */

import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { runGoogleVisionGroqTextPipeline } from '../lib/services/invoice-extract/pipeline/googleVisionGroqTextPipeline';
import { runGeminiVisionPipeline } from '../lib/services/invoice-extract/pipeline/geminiVisionPipeline';
import { runGroqVisionPipeline } from '../lib/services/invoice-extract/pipeline/groqVisionPipeline';
import type { ExtractionPipelineResult } from '../lib/services/invoice-extract/pipeline/extractionPipelineTypes';

const imagePath = process.argv[2];
if (!imagePath) {
  console.error('Usage: npx ts-node -r tsconfig-paths/register scripts/test-extract-direct.ts <image-path>');
  process.exit(1);
}

const absPath = path.resolve(imagePath);
const fileBytes = fs.readFileSync(absPath);
const fileName = path.basename(absPath);
const mimeType = /\.png$/i.test(fileName) ? 'image/png' : 'image/jpeg';

const provider = (process.env.INVOICE_VISION_PROVIDER || 'gemini').toLowerCase().trim();
const modelLabel =
  provider === 'gemini'
    ? `GEMINI_MODEL=${process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite'}`
    : provider === 'groq'
    ? `GROQ_VISION_MODEL=${process.env.GROQ_VISION_MODEL || 'meta-llama/llama-4-scout-17b-16e-instruct'}`
    : `GROQ_MODEL=${process.env.GROQ_MODEL}`;

console.log('\n====================================================');
console.log('  Khatario Invoice Extraction — Direct Pipeline Test');
console.log('====================================================');
console.log(`  File  : ${fileName} (${(fileBytes.length / 1024).toFixed(1)} KB)`);
console.log(`  Mode  : INVOICE_VISION_PROVIDER=${provider}`);
console.log(`  Model : ${modelLabel}`);
if (provider !== 'gemini') {
  console.log(`  Preprocess: INVOICE_IMAGE_PREPROCESS_PROFILE=${process.env.INVOICE_IMAGE_PREPROCESS_PROFILE ?? 'off'}`);
  console.log(`  Layout intelligence: INVOICE_LAYOUT_INTELLIGENCE=${process.env.INVOICE_LAYOUT_INTELLIGENCE ?? 'false'}`);
}
console.log('----------------------------------------------------\n');

async function main() {
const file = new File([fileBytes], fileName, { type: mimeType });

const t0 = Date.now();
let result: ExtractionPipelineResult;
if (provider === 'gemini') {
  result = await runGeminiVisionPipeline(file, true, {
    businessId: '3c349e4a-6031-45c0-a189-c570466f2758',
  });
} else if (provider === 'groq') {
  result = await runGroqVisionPipeline(file, true, {
    businessId: '3c349e4a-6031-45c0-a189-c570466f2758',
  });
} else {
  result = await runGoogleVisionGroqTextPipeline(file, true, {
    businessId: '3c349e4a-6031-45c0-a189-c570466f2758',
  });
}
const elapsed = Date.now() - t0;

const e = result.data;

// ─── Header ──────────────────────────────────────────────────────────────────
console.log('📄  SUPPLIER');
console.log(`    Name  : ${e.supplier_name ?? '—'}`);
console.log(`    GSTIN : ${e.supplier_gstin ?? '—'}`);

console.log('\n🧾  INVOICE');
console.log(`    Number    : ${e.invoice_number ?? '—'}`);
console.log(`    Date      : ${e.invoice_date ?? '—'}`);
console.log(`    Tax type  : ${e.tax_type ?? '—'}`);
console.log(`    Price mode: ${e.price_mode ?? '—'}`);
console.log(`    Place of supply: ${e.place_of_supply ?? '—'}`);
console.log(`    Buyer GSTIN: ${e.buyer_gstin ?? '—'}`);

// ─── Line items ───────────────────────────────────────────────────────────────
console.log('\n📦  LINE ITEMS');
if (!e.items?.length) {
  console.log('    (none)');
} else {
  e.items.forEach((it, i) => {
    const disc = (it.discount_amount ?? 0) > 0
      ? ` | disc ₹${it.discount_amount!.toFixed(2)}${it.discount_on_tax_inclusive ? ' (off MRP)' : ''}`
      : '';
    console.log(`    [${i + 1}] ${it.description ?? '—'}`);
    console.log(`        HSN       : ${it.hsn_code ?? '—'}`);
    console.log(`        Qty/Unit  : ${it.qty} ${it.unit ?? 'PCS'}  Rate: ₹${it.rate?.toFixed(2) ?? '—'}${disc}`);
    console.log(`        GST rate  : ${it.gst_rate ?? '?'}%`);
    console.log(`        Taxable   : ₹${it.taxable_value?.toFixed(2) ?? '—'}`);
    console.log(`        CGST      : ₹${it.cgst_amount?.toFixed(2) ?? '—'}  SGST: ₹${it.sgst_amount?.toFixed(2) ?? '—'}  IGST: ₹${it.igst_amount?.toFixed(2) ?? '—'}`);
    console.log(`        Line total: ₹${it.line_total?.toFixed(2) ?? '—'}`);
  });
}

// ─── Totals ───────────────────────────────────────────────────────────────────
console.log('\n💰  TOTALS');
console.log(`    Subtotal (taxable) : ₹${e.subtotal?.toFixed(2) ?? '—'}`);
if ((e.total_cgst ?? 0) > 0)  console.log(`    CGST               : ₹${e.total_cgst!.toFixed(2)}`);
if ((e.total_sgst ?? 0) > 0)  console.log(`    SGST               : ₹${e.total_sgst!.toFixed(2)}`);
if ((e.total_igst ?? 0) > 0)  console.log(`    IGST               : ₹${e.total_igst!.toFixed(2)}`);
if (e.round_off != null && e.round_off !== 0) console.log(`    Round off          : ₹${e.round_off.toFixed(2)}`);
console.log(`    Grand Total        : ₹${e.grand_total?.toFixed(2) ?? '—'}`);

// ─── GST summary ─────────────────────────────────────────────────────────────
if (e.gst_summary?.length) {
  console.log('\n📊  GST SUMMARY');
  e.gst_summary.forEach((s) => {
    console.log(
      `    ${s.gst_rate}%  taxable ₹${s.taxable_value?.toFixed(2)}  CGST ₹${s.cgst?.toFixed(2)}  SGST ₹${s.sgst?.toFixed(2)}  IGST ₹${s.igst?.toFixed(2)}  total tax ₹${s.total_tax?.toFixed(2)}`,
    );
  });
}

// ─── Pipeline metadata ────────────────────────────────────────────────────────
console.log('\n⚙️   PIPELINE');
console.log(`    Provider  : ${result.provider}`);
console.log(`    Model     : ${result.model}`);
console.log(`    Time      : ${elapsed} ms`);
if (result.ocrGstSummary) {
  const o = result.ocrGstSummary;
  console.log(`    OCR GST   : ${o.override_count} overrides, confidence ${(o.validation_confidence * 100).toFixed(0)}%, ${o.validation_warnings} warnings`);
}
const debug = result.debug as Record<string, unknown> | undefined;
if (debug?.spatial_table_injected != null) {
  console.log(`    Spatial table : ${debug.spatial_table_injected ? '✅ reconstructed (column fix applied)' : '⬜ not triggered (row-by-row or thermal)'}`);
}
if (debug?.ocr_preprocess) {
  const p = debug.ocr_preprocess as Record<string, unknown>;
  console.log(`    Preprocess: profile=${p.profile}  ${p.original_width}×${p.original_height} → ${p.width}×${p.height}`);
  console.log(`    Steps: ${(p.steps as string[] ?? []).join(', ')}`);
}
if (result.repairNotes?.length) {
  console.log(`    Repairs   : ${result.repairNotes.join('; ')}`);
}

// ─── Raw OCR ─────────────────────────────────────────────────────────────────
if (debug?.raw_ocr_text) {
  console.log('\n📝  RAW OCR TEXT (first 3000 chars)');
  console.log('----------------------------------------------------');
  console.log((debug.raw_ocr_text as string).slice(0, 3000));
  console.log('----------------------------------------------------');
}

// ─── Math check ───────────────────────────────────────────────────────────────
console.log('\n🔢  MATH CHECK');
const grand = e.grand_total ?? 0;
const sub = e.subtotal ?? 0;
const tax = (e.total_cgst ?? 0) + (e.total_sgst ?? 0) + (e.total_igst ?? 0);
const ro = e.round_off ?? 0;
const computed = Math.round((sub + tax + ro) * 100) / 100;
const ok = Math.abs(computed - grand) <= Math.max(2, grand * 0.01);
console.log(
  `    ₹${sub.toFixed(2)} (taxable) + ₹${tax.toFixed(2)} (tax) + ₹${ro.toFixed(2)} (ro) = ₹${computed.toFixed(2)}  vs grand ₹${grand.toFixed(2)}  ${ok ? '✅ OK' : '❌ MISMATCH'}`,
);

// Expected values from the invoice image
console.log('\n🎯  EXPECTED (from invoice image)');
console.log('    Supplier    : FASHION DREAM');
console.log('    GSTIN       : 24GZLPP9129C1Z9 (Gujarat)');
console.log('    Tax type    : IGST (inter-state: Gujarat → Karnataka)');
console.log('    GST rate    : 5% IGST');
console.log('    Item        : Girls Square Neck Basic Jumpsuit');
console.log('    HSN         : 61119090');
console.log('    Gross amt   : ₹2299.00');
console.log('    Discount    : ₹1787.00 (approx, off MRP)');
console.log('    Taxable     : ₹487.62');
console.log('    IGST 5%     : ₹24.38');
console.log('    Grand Total : ₹512.00');

console.log('\n====================================================\n');
}

main().catch((err) => {
  console.error('❌ Extraction failed:', err.message ?? err);
  process.exit(1);
});
