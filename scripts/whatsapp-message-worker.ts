/**
 * Dedicated process: starts BullMQ worker for whatsapp-messages.
 * Run alongside the Next app when REDIS_HOST is set: npm run worker:whatsapp
 */
import { startWhatsAppMessageWorker } from '../lib/queue-worker';
import { isWhatsAppQueueEnabled } from '../lib/queue';

if (!isWhatsAppQueueEnabled()) {
  console.error(
    '[worker:whatsapp] Set REDIS_HOST and ensure WHATSAPP_DISABLE_QUEUE is not set.'
  );
  process.exit(1);
}

if (process.env.WHATSAPP_DISABLE_WORKER === '1') {
  console.error('[worker:whatsapp] WHATSAPP_DISABLE_WORKER=1; refusing to start.');
  process.exit(1);
}

const w = startWhatsAppMessageWorker();
if (!w) {
  console.error('[worker:whatsapp] Worker failed to start.');
  process.exit(1);
}

console.log(
  '[worker:whatsapp] Started (concurrency=%s)',
  process.env.WHATSAPP_QUEUE_CONCURRENCY || '1'
);
