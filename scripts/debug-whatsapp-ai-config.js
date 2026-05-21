/**
 * Inspect WhatsApp AI / chatbot config for a business.
 *
 * Usage:
 *   node scripts/debug-whatsapp-ai-config.js
 *   node scripts/debug-whatsapp-ai-config.js "Shalini Traders"
 *   node scripts/debug-whatsapp-ai-config.js --all
 */
require('dotenv').config();
const { Pool } = require('pg');
const { getMigrationDbConfig } = require('./db-config');

const pool = new Pool(getMigrationDbConfig());

const TEST_MODE_SNIPPET = 'WhatsApp assistant is in test mode';

function redactKey(key) {
  if (!key || typeof key !== 'string') return null;
  if (key.length <= 8) return '***';
  return `${key.slice(0, 4)}…${key.slice(-4)} (${key.length} chars)`;
}

function parseAllowedPhones(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function interpretConfig(row) {
  const chatbotOn = row.chatbot_enabled !== false;
  const mode = row.mode || 'prod';
  const allowed = parseAllowedPhones(row.dev_allowed_phones);

  let botBehavior = 'unknown';
  if (!chatbotOn) {
    botBehavior = 'Chatbot OFF — no auto-replies';
  } else if (mode === 'prod') {
    botBehavior = 'Production — bot may reply to all incoming numbers (if AI key valid)';
  } else if (mode === 'dev' && allowed.length === 0) {
    botBehavior =
      'Dev mode, empty allow-list — BEFORE fix: spammed test-mode message to everyone; AFTER fix: silent (CRM only)';
  } else if (mode === 'dev') {
    botBehavior = `Dev mode — bot replies only to: ${allowed.join(', ')}`;
  }

  return { chatbotOn, mode, allowed, botBehavior };
}

async function fetchRecentTestModeReplies(businessId, limit = 10) {
  const r = await pool.query(
    `SELECT wcm.message_id, wcm.from_number, wcm.to_number, wcm.created_at,
            LEFT(wcm.message_text, 120) AS message_preview
     FROM whatsapp_conversation_messages wcm
     JOIN whatsapp_conversations wc ON wc.id = wcm.conversation_id
     WHERE wc.business_id = $1
       AND wcm.direction = 'outgoing'
       AND wcm.message_text ILIKE $2
     ORDER BY wcm.created_at DESC
     LIMIT $3`,
    [businessId, `%${TEST_MODE_SNIPPET}%`, limit],
  );
  return r.rows;
}

async function fetchBusinessRows(nameFilter) {
  const r = await pool.query(
    `SELECT b.id, b.name, b.phone AS business_phone
     FROM businesses b
     WHERE b.name ILIKE $1
     ORDER BY b.name`,
    [`%${nameFilter}%`],
  );
  return r.rows;
}

async function inspectBusiness(business) {
  const cfg = await pool.query(
    `SELECT id, business_id, provider, model, chatbot_enabled, lead_analyzer_enabled,
            mode, dev_allowed_phones, temperature, max_tokens,
            api_key IS NOT NULL AND length(trim(api_key)) > 0 AS has_api_key,
            api_key, created_at, updated_at
     FROM ai_provider_config
     WHERE business_id = $1`,
    [business.id],
  );

  const wa = await pool.query(
    `SELECT status, phone_number, updated_at
     FROM whatsapp_sessions
     WHERE business_id = $1
     ORDER BY updated_at DESC NULLS LAST
     LIMIT 1`,
    [business.id],
  );

  const row = cfg.rows[0] || null;
  const summary = row
    ? interpretConfig(row)
    : {
        chatbotOn: false,
        mode: null,
        allowed: [],
        botBehavior: 'No ai_provider_config row — chatbot will not run AI (CRM may still store messages)',
      };

  const safeRow = row
    ? {
        ...row,
        api_key: redactKey(row.api_key),
        dev_allowed_phones: parseAllowedPhones(row.dev_allowed_phones),
      }
    : null;

  const testReplies = await fetchRecentTestModeReplies(business.id);

  console.log('\n========================================');
  console.log(`Business: ${business.name}`);
  console.log(`ID: ${business.id}`);
  console.log(`Phone (profile): ${business.business_phone || '(none)'}`);
  console.log('----------------------------------------');
  console.log('WhatsApp session:', wa.rows[0] || '(no session row)');
  console.log('AI config:', safeRow || '(missing)');
  console.log('Interpretation:', summary);
  console.log('----------------------------------------');
  console.log(`Recent "${TEST_MODE_SNIPPET}" outbound replies: ${testReplies.length}`);
  if (testReplies.length > 0) {
    console.log(JSON.stringify(testReplies, null, 2));
  }
}

async function main() {
  const args = process.argv.slice(2);
  const all = args.includes('--all');
  const name = args.find((a) => !a.startsWith('--')) || 'Shalini';

  if (all) {
    const businesses = await pool.query(
      `SELECT b.id, b.name, b.phone AS business_phone
       FROM businesses b
       WHERE EXISTS (SELECT 1 FROM ai_provider_config c WHERE c.business_id = b.id)
       ORDER BY b.name`,
    );
    for (const b of businesses.rows) {
      await inspectBusiness(b);
    }
  } else {
    const businesses = await fetchBusinessRows(name);
    if (businesses.length === 0) {
      console.error(`No business matching "${name}"`);
      process.exit(1);
    }
    for (const b of businesses) {
      await inspectBusiness(b);
    }
  }

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
