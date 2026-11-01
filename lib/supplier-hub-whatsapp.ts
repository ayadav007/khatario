/**
 * Supplier Hub notices on WhatsApp (migration 424).
 *
 * Hub code writes a row to supplier_hub_whatsapp_outbox inside the same transaction as the
 * in-app notice, so nothing is sent for a change that rolled back. A few seconds later the
 * queue is flushed: each committed row goes to the business phone from the platform number
 * with the approved 'supplier_hub_update' template. The cron sweep sends anything missed.
 * A business that switched hub WhatsApp off, has no phone, or got the same update in the
 * last 10 minutes is skipped; so is everything until the template is approved.
 */

import { query } from './db';
import type { Exec } from './supplier-hub-links';

const FLUSH_DELAY_MS = 3000;
const REPEAT_WINDOW_MINUTES = 10;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

/** Queue a hub update for a business; `path` is the app page it is about (e.g. /supply-orders/<id>). */
export async function queueHubWhatsApp(
  exec: Exec,
  businessId: string,
  notice: { title: string; detail?: string | null; path: string }
): Promise<void> {
  await exec(
    `INSERT INTO supplier_hub_whatsapp_outbox (business_id, title, detail, path) VALUES ($1, $2, $3, $4)`,
    [businessId, notice.title.slice(0, 300), notice.detail?.slice(0, 500) || null, notice.path]
  );
  scheduleHubWhatsAppFlush();
}

export function scheduleHubWhatsAppFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushHubWhatsApp().catch((error) => console.error('[hub-wa] flush failed', error));
  }, FLUSH_DELAY_MS);
  flushTimer.unref?.();
}

/** Template variables must not be empty, and Meta rejects new lines and long runs of spaces. */
function templateText(value: string, max: number): string {
  const text = value.replace(/\s+/g, ' ').trim().slice(0, max);
  return text || '-';
}

type OutboxRow = {
  id: string;
  business_id: string;
  title: string;
  detail: string | null;
  path: string;
  enabled: boolean | null;
  repeated: boolean;
};

/** Send queued updates. Returns how many were sent and skipped. */
export async function flushHubWhatsApp(limit = 50): Promise<{ sent: number; skipped: number }> {
  // A flush that died mid-send leaves rows claimed; give them another go.
  await query(
    `UPDATE supplier_hub_whatsapp_outbox SET status = 'queued'
      WHERE status = 'sending' AND created_at < CURRENT_TIMESTAMP - INTERVAL '15 minutes'`
  );
  const claimed = await query<OutboxRow>(
    `WITH picked AS (
       SELECT id FROM supplier_hub_whatsapp_outbox
        WHERE status = 'queued'
        ORDER BY created_at
        LIMIT $1
        FOR UPDATE SKIP LOCKED
     )
     UPDATE supplier_hub_whatsapp_outbox o SET status = 'sending'
       FROM picked
      WHERE o.id = picked.id
     RETURNING o.id, o.business_id, o.title, o.detail, o.path,
       (SELECT b.hub_whatsapp_enabled FROM businesses b WHERE b.id = o.business_id) AS enabled,
       EXISTS (
         SELECT 1 FROM supplier_hub_whatsapp_outbox r
          WHERE r.business_id = o.business_id AND r.path = o.path AND r.status = 'sent'
            AND r.sent_at > CURRENT_TIMESTAMP - make_interval(mins => ${REPEAT_WINDOW_MINUTES})
       ) AS repeated`,
    [limit]
  );

  const { lookupTenantWhatsAppPhone, sendPlatformEventWhatsApp } = await import('./platform-whatsapp-send');
  const { appBaseUrl } = await import('./insights/format');
  const base = appBaseUrl() || 'https://khatario.com';
  let sent = 0;
  let skipped = 0;
  const finish = (id: string, status: 'sent' | 'skipped', reason: string | null) =>
    query(
      `UPDATE supplier_hub_whatsapp_outbox
          SET status = $2::varchar, skip_reason = $3, sent_at = CASE WHEN $2::varchar = 'sent' THEN CURRENT_TIMESTAMP ELSE NULL END
        WHERE id = $1`,
      [id, status, reason]
    );

  for (const row of claimed.rows) {
    let reason: string | null = null;
    if (row.enabled === false) reason = 'TURNED_OFF';
    else if (row.repeated) reason = 'SENT_RECENTLY';
    const phone = reason ? null : await lookupTenantWhatsAppPhone(row.business_id);
    if (!reason && !phone) reason = 'NO_PHONE';
    if (!reason && phone) {
      const res = await sendPlatformEventWhatsApp({
        eventKey: 'supplier_hub_update',
        toPhone: phone,
        vars: [templateText(row.title, 200), templateText(row.detail || '', 300), `${base}${row.path}`],
      });
      if (!res.sent) reason = res.skipped || 'SEND_FAILED';
    }
    await finish(row.id, reason ? 'skipped' : 'sent', reason);
    if (reason) skipped++;
    else sent++;
  }
  return { sent, skipped };
}
