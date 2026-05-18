/**
 * Baileys must run in a long-lived process (this worker), not in a short-lived
 * API request. Starts/restarts WhatsApp sockets for every business with stored auth
 * in `whatsapp_sessions`. Run alongside the Next app in production.
 *
 *   npm run worker:whatsapp:baileys
 */
import * as path from 'path';
import { config } from 'dotenv';

config({ path: path.resolve(process.cwd(), '.env.local') });
config();

import { queryRows } from '../lib/db';
import { getWhatsAppSocket } from '../lib/whatsapp';

async function main() {
  if (process.env.WHATSAPP_DISABLE_WORKER === '1') {
    console.error('[whatsapp-worker] WHATSAPP_DISABLE_WORKER=1 — exiting.');
    process.exit(1);
  }

  const rows = await queryRows<{ business_id: string }>(`
    SELECT business_id::text AS business_id
    FROM whatsapp_sessions
    WHERE auth_state IS NOT NULL
  `);

  console.log(
    `[whatsapp-worker] Provisioning Baileys for ${rows.length} business id(s) (has auth_state in DB).`
  );

  for (const r of rows) {
    getWhatsAppSocket(r.business_id).catch((e) => {
      console.error(`[whatsapp-worker] getWhatsAppSocket failed for ${r.business_id}:`, e);
    });
  }

  setInterval(
    () =>
      void console.log(
        `[whatsapp-worker] tick ${new Date().toISOString()} — process alive, sockets managed in lib.`
      ),
    300_000
  );
  console.log(
    '[whatsapp-worker] Ready. Use one worker per deploy; do not start duplicate connection managers for the same DB.'
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
