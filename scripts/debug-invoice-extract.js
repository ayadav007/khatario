/**
 * Diagnose bill-scan / purchase invoice extraction on server.
 *
 * Usage (on VPS, from repo root):
 *   node scripts/debug-invoice-extract.js
 *   node scripts/debug-invoice-extract.js "Shalini"
 *   node scripts/debug-invoice-extract.js --test-groq
 *   node scripts/debug-invoice-extract.js --test-ocr
 */
require('dotenv').config({ path: '.env.production' });
require('dotenv').config({ path: '.env' });

const { Pool } = require('pg');
const { getMigrationDbConfig } = require('./db-config');

const pool = new Pool(getMigrationDbConfig());

function maskSecret(v) {
  if (!v || typeof v !== 'string') return '(not set)';
  const t = v.trim();
  if (!t) return '(empty)';
  if (t.length <= 8) return '***';
  return `${t.slice(0, 4)}…${t.slice(-4)} (${t.length} chars)`;
}

function readEnv() {
  const extractionMode = process.env.EXTRACTION_MODE || 'vision';
  const visionProvider = (process.env.INVOICE_VISION_PROVIDER || 'groq').toLowerCase().trim();
  const groqKey = process.env.GROQ_API_KEY || '';
  const googleKey = process.env.GOOGLE_VISION_API_KEY || '';
  const ocrUrl = process.env.OCR_SERVICE_URL || 'http://127.0.0.1:4000';

  const useGoogle = visionProvider === 'google' && Boolean(googleKey) && Boolean(groqKey);
  const useGroqVision = visionProvider !== 'google' && Boolean(groqKey);

  return {
    extractionMode,
    visionProvider,
    groqKey: maskSecret(groqKey),
    groqVisionModel: process.env.GROQ_VISION_MODEL || 'meta-llama/llama-4-scout-17b-16e-instruct',
    groqTextModel: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
    googleVisionKey: googleKey ? maskSecret(googleKey) : '(not set)',
    ocrServiceUrl: ocrUrl,
    ocrPythonPath: process.env.OCR_PYTHON_PATH || 'ocr-service/.venv/Scripts/python.exe (default — wrong on Linux!)',
    imagePath:
      'Camera/photo → Groq vision (if GROQ_API_KEY) or Google OCR+Groq (if configured)',
    pdfPath: 'PDF → local OCR service at OCR_SERVICE_URL',
    cameraWillUse:
      extractionMode === 'ocr' || (!useGroqVision && !useGoogle)
        ? 'OCR service (needs ocr-service running + Python/Paddle)'
        : useGoogle
          ? 'Google Vision OCR + Groq text'
          : 'Groq vision model',
    hasGroqKey: Boolean(groqKey.trim()),
    hasGoogleKey: Boolean(googleKey.trim()),
  };
}

async function testGroq() {
  const key = process.env.GROQ_API_KEY;
  if (!key?.trim()) {
    console.log('\n❌ GROQ_API_KEY not set — photo extraction will fail in vision mode.');
    return;
  }
  const model = process.env.GROQ_VISION_MODEL || 'meta-llama/llama-4-scout-17b-16e-instruct';
  try {
    const res = await fetch('https://api.groq.com/openai/v1/models', {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(15000),
    });
    const body = await res.text();
    if (!res.ok) {
      console.log(`\n❌ Groq API HTTP ${res.status}:`, body.slice(0, 300));
      return;
    }
    const json = JSON.parse(body);
    const ids = (json.data || []).map((m) => m.id);
    const ok = ids.includes(model);
    console.log(`\n✅ Groq API reachable. Models: ${ids.length}. Vision model "${model}": ${ok ? 'OK' : 'NOT FOUND'}`);
    if (!ok) {
      console.log('   Available (sample):', ids.slice(0, 8).join(', '));
    }
  } catch (e) {
    console.log('\n❌ Groq connectivity failed:', e.message);
  }
}

async function testOcr() {
  const base = (process.env.OCR_SERVICE_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');
  try {
    const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(5000) });
    const text = await res.text();
    console.log(`\n${res.ok ? '✅' : '❌'} OCR service ${base}/health → HTTP ${res.status}: ${text.slice(0, 200)}`);
  } catch (e) {
    console.log(`\n❌ OCR service not reachable at ${base}/health —`, e.message);
    console.log('   PDF extraction and OCR fallback will fail. Start: cd ocr-service && npm start (or pm2).');
  }
}

async function recentFailures(businessName) {
  const name = businessName || null;
  const r = await pool.query(
    `SELECT j.id, j.file_name, j.file_type, j.status, j.error_message,
            j.extraction_method, j.processing_time_ms, j.created_at, b.name AS business_name
     FROM invoice_extraction_jobs j
     JOIN businesses b ON b.id = j.business_id
     WHERE j.status = 'failed'
       ${name ? 'AND b.name ILIKE $1' : ''}
     ORDER BY j.created_at DESC
     LIMIT 15`,
    name ? [`%${name}%`] : [],
  );
  console.log(`\n--- Recent failed extractions${name ? ` (${name})` : ''} (${r.rows.length}) ---`);
  if (r.rows.length === 0) {
    console.log('(none in DB — error may be before job insert, or client network issue)');
    return;
  }
  for (const row of r.rows) {
    console.log({
      at: row.created_at,
      business: row.business_name,
      file: row.file_name,
      type: row.file_type,
      error: row.error_message,
    });
  }
}

async function main() {
  const args = process.argv.slice(2);
  const runGroqTest = args.includes('--test-groq');
  const runOcrTest = args.includes('--test-ocr');
  const nameArg = args.find((a) => !a.startsWith('--'));

  console.log('=== Invoice extract diagnostics ===\n');
  console.log('Environment (secrets masked):');
  console.log(JSON.stringify(readEnv(), null, 2));

  if (!readEnv().hasGroqKey) {
    console.log('\n⚠️  Missing GROQ_API_KEY in .env.production — most common cause for camera bill scan on VPS.');
  }

  if (runGroqTest || args.length === 0) await testGroq();
  if (runOcrTest || args.length === 0) await testOcr();

  await recentFailures(nameArg);

  console.log('\n--- What to check on VPS ---');
  console.log('1. pm2 logs (Next.js app):  pm2 logs khatario-staging --lines 200 | grep -i extract');
  console.log('2. Failed jobs in DB:       (this script, or invoice_extraction_jobs.error_message)');
  console.log('3. Groq key in production:  grep GROQ_API_KEY .env.production');
  console.log('4. OCR service (PDF/fallback): curl -s http://127.0.0.1:4000/health');
  console.log('5. Browser/network:           DevTools → Network → POST /api/invoices/extract → response body');

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
