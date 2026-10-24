/**
 * Diagnose bill-scan / purchase invoice extraction on server.
 *
 * Usage (on VPS, from repo root):
 *   node scripts/debug-invoice-extract.js                  # env + model check + OCR health + recent failures
 *   node scripts/debug-invoice-extract.js "Shalini"        # same, failures filtered by business name
 *   node scripts/debug-invoice-extract.js --check-models   # model check only (no DB); use after deploy / daily cron
 *   node scripts/debug-invoice-extract.js --test-ocr
 *
 * Exits 1 when a configured vision provider (GEMINI_API_KEY / GROQ_API_KEY set) has no working
 * model in its list, or when no vision provider is configured. API keys are never printed.
 */
require('dotenv').config({ path: '.env.production' });
require('dotenv').config({ path: '.env' });

// Keep in sync with lib/services/invoice-extract/pipeline/visionModelFallback.ts
const DEFAULT_GEMINI_VISION_MODELS = ['gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-3.8-flash'];
const DEFAULT_GROQ_VISION_MODELS = ['qwen/qwen3.8-27b'];

function parseModelList(list, single, defaults) {
  const fromList = (list || '')
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);
  const picked = fromList.length ? fromList : single && single.trim() ? [single.trim()] : defaults;
  return Array.from(new Set(picked));
}

function keyStatus(v) {
  if (!v || typeof v !== 'string' || !v.trim()) return '(not set)';
  return 'set';
}

/** Strip any echo of the key from provider error bodies before printing. */
function scrub(text, key) {
  let out = String(text || '');
  if (key) out = out.split(key).join('***');
  return out.slice(0, 300);
}

function readEnv() {
  const extractionMode = process.env.EXTRACTION_MODE || 'vision';
  const visionProvider = (process.env.INVOICE_VISION_PROVIDER || 'gemini').toLowerCase().trim();
  const groqKey = process.env.GROQ_API_KEY || '';
  const geminiKey = process.env.GEMINI_API_KEY || '';
  const googleKey = process.env.GOOGLE_VISION_API_KEY || '';

  return {
    extractionMode,
    visionProvider,
    geminiKey: keyStatus(geminiKey),
    geminiModels: parseModelList(process.env.GEMINI_MODELS, process.env.GEMINI_MODEL, DEFAULT_GEMINI_VISION_MODELS),
    groqKey: keyStatus(groqKey),
    groqVisionModels: parseModelList(
      process.env.GROQ_VISION_MODELS,
      process.env.GROQ_VISION_MODEL,
      DEFAULT_GROQ_VISION_MODELS,
    ),
    googleVisionKey: keyStatus(googleKey),
    ocrServiceUrl: process.env.OCR_SERVICE_URL || 'http://127.0.0.1:4000',
    imagePath: `Photo → ${visionProvider} first, then Gemini → Groq vision → OCR service (each walks its model list)`,
    pdfPath: 'PDF → local OCR service at OCR_SERVICE_URL',
    hasGeminiKey: Boolean(geminiKey.trim()),
    hasGroqKey: Boolean(groqKey.trim()),
  };
}

async function listGeminiModels(key) {
  const byName = new Map();
  let pageToken = '';
  do {
    const url = `https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
    const res = await fetch(url, { headers: { 'x-goog-api-key': key }, signal: AbortSignal.timeout(15000) });
    const body = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${scrub(body, key)}`);
    const json = JSON.parse(body);
    for (const m of json.models || []) {
      byName.set(String(m.name || '').replace(/^models\//, ''), m.supportedGenerationMethods || []);
    }
    pageToken = json.nextPageToken || '';
  } while (pageToken);
  return byName;
}

async function listGroqModels(key) {
  const res = await fetch('https://api.groq.com/openai/v1/models', {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(15000),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${scrub(body, key)}`);
  const json = JSON.parse(body);
  const active = new Map();
  for (const m of json.data || []) active.set(m.id, m.active !== false);
  return active;
}

/** Returns { provider, configured, working: string[], lines: string[] }. */
async function checkProviderModels(provider, key, models, list, isUsable) {
  const lines = [];
  if (!key) return { provider, configured: false, working: [], lines: [`${provider}: no API key — skipped`] };
  let available;
  try {
    available = await list(key);
  } catch (e) {
    return { provider, configured: true, working: [], lines: [`❌ ${provider}: model list failed — ${scrub(e.message, key)}`] };
  }
  const working = [];
  for (const model of models) {
    const ok = isUsable(available, model);
    if (ok) working.push(model);
    lines.push(`   ${ok ? '✅' : '❌'} ${model}${ok ? '' : ' — not available (retired, renamed, or not enabled for this key)'}`);
  }
  lines.unshift(
    `${working.length ? '✅' : '❌'} ${provider}: ${working.length}/${models.length} configured models available`,
  );
  return { provider, configured: true, working, lines };
}

async function checkModels() {
  const env = readEnv();
  const results = [
    await checkProviderModels(
      'Gemini',
      (process.env.GEMINI_API_KEY || '').trim(),
      env.geminiModels,
      listGeminiModels,
      (available, model) => (available.get(model) || []).includes('generateContent'),
    ),
    await checkProviderModels(
      'Groq',
      (process.env.GROQ_API_KEY || '').trim(),
      env.groqVisionModels,
      listGroqModels,
      (available, model) => available.get(model) === true,
    ),
  ];

  console.log('\n--- Vision model check ---');
  for (const r of results) console.log(r.lines.join('\n'));

  const configured = results.filter((r) => r.configured);
  const broken = configured.filter((r) => r.working.length === 0);
  if (configured.length === 0) {
    console.log('\n❌ No vision provider configured (set GEMINI_API_KEY and/or GROQ_API_KEY). Photo scans will only use the OCR service.');
    return false;
  }
  if (broken.length) {
    console.log(
      `\n❌ No working model for: ${broken.map((r) => r.provider).join(', ')}. Update GEMINI_MODELS / GROQ_VISION_MODELS (see provider deprecation pages) and restart the app.`,
    );
    return false;
  }
  console.log('\n✅ Every configured vision provider has at least one working model.');
  return true;
}

async function testOcr() {
  const base = (process.env.OCR_SERVICE_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');
  try {
    const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(5000) });
    const text = await res.text();
    console.log(`\n${res.ok ? '✅' : '❌'} OCR service ${base}/health → HTTP ${res.status}: ${text.slice(0, 200)}`);
  } catch (e) {
    console.log(`\n❌ OCR service not reachable at ${base}/health —`, e.message);
    console.log('   PDF extraction and the last-resort OCR fallback will fail. Start: cd ocr-service && npm start (or pm2).');
  }
}

async function recentFailures(businessName) {
  const { Pool } = require('pg');
  const { getMigrationDbConfig } = require('./db-config');
  const pool = new Pool(getMigrationDbConfig());
  try {
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
  } finally {
    await pool.end();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const modelsOnly = args.includes('--check-models');
  const runOcrTest = args.includes('--test-ocr');
  const nameArg = args.find((a) => !a.startsWith('--'));

  console.log('=== Invoice extract diagnostics ===\n');
  console.log('Environment (keys are never printed):');
  const { hasGeminiKey, hasGroqKey, ...shown } = readEnv();
  console.log(JSON.stringify(shown, null, 2));

  const modelsOk = await checkModels();
  if (modelsOnly) {
    process.exitCode = modelsOk ? 0 : 1;
    return;
  }

  if (runOcrTest || args.length === 0 || nameArg) await testOcr();
  await recentFailures(nameArg);

  console.log('\n--- What to check on VPS ---');
  console.log('1. pm2 logs (Next.js app):  pm2 logs <app> --lines 200 | grep -i "invoices/extract"');
  console.log('2. Failed jobs in DB:       invoice_extraction_jobs.error_message has one line per provider tried');
  console.log('3. Models:                  node scripts/debug-invoice-extract.js --check-models');
  console.log('4. OCR service (PDF/fallback): curl -s http://127.0.0.1:4000/health');
  console.log('5. Browser/network:           DevTools → Network → POST /api/invoices/extract → response body');

  process.exitCode = modelsOk ? 0 : 1;
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
