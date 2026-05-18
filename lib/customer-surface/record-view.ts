import { query, queryOne, queryRows } from '@/lib/db';
import { getRedisConnection } from '@/lib/queue/redis';
import type { InvoiceViewSource } from './types';
import { mergeCustomerSurfaceSettings } from './settings';

const NOTIFICATIONS_CHANNEL = 'notifications';

async function publishInvoiceViewedEvents(
  businessId: string,
  notificationId: string,
  title: string,
  message: string,
  referenceId: string
): Promise<void> {
  const redis = getRedisConnection();
  if (!redis || redis.status !== 'ready') return;

  const users = await queryRows<{ id: string }>(
    `SELECT id FROM users
     WHERE business_id = $1 AND is_active = true
     ORDER BY created_at ASC
     LIMIT 50`,
    [businessId]
  );

  const payloadBase = {
    type: 'invoice_viewed',
    businessId,
    notificationId,
    title,
    message,
    reference_id: referenceId,
    reference_type: 'invoices',
    timestamp: Date.now(),
  };

  for (const u of users) {
    const payload = { ...payloadBase, userId: u.id };
    void redis.publish(NOTIFICATIONS_CHANNEL, JSON.stringify(payload)).catch(() => {});
  }
}

/**
 * Record a customer view of a public bill. Idempotent for notifications on repeat views
 * (still increments view_count / last_viewed_at).
 */
export async function recordInvoiceCustomerView(params: {
  invoiceId: string;
  businessId: string;
  customerName: string;
  invoiceNumber: string;
  source: InvoiceViewSource;
  notifyOnFirstView?: boolean;
}): Promise<{ firstView: boolean }> {
  const {
    invoiceId,
    businessId,
    customerName,
    invoiceNumber,
    source,
    notifyOnFirstView = true,
  } = params;

  const row = await queryOne<{ first_viewed_at: string | null; view_count: number }>(
    `UPDATE invoices
     SET
       view_count = COALESCE(view_count, 0) + 1,
       last_viewed_at = CURRENT_TIMESTAMP,
       first_viewed_at = COALESCE(first_viewed_at, CURRENT_TIMESTAMP)
     WHERE id = $1 AND business_id = $2
     RETURNING first_viewed_at, view_count`,
    [invoiceId, businessId]
  );
  const firstView = row?.view_count === 1;

  await query(
    `INSERT INTO invoice_view_events (invoice_id, business_id, source)
     VALUES ($1, $2, $3)`,
    [invoiceId, businessId, source]
  );

  if (!firstView || !notifyOnFirstView) {
    return { firstView: false };
  }

  const settingsRow = await queryRows<{ customer_surface_settings: unknown }>(
    `SELECT customer_surface_settings FROM business_settings WHERE business_id = $1`,
    [businessId]
  );
  const surface = mergeCustomerSurfaceSettings(
    settingsRow[0]?.customer_surface_settings
  );
  if (surface.notify_on_first_view === false) {
    return { firstView: true };
  }

  const title = 'Invoice read';
  const message = `Invoice ${invoiceNumber} was viewed by ${customerName}`;

  const ins = await queryRows<{ id: string }>(
    `INSERT INTO notifications (
       business_id, user_id, type, title, message, reference_type, reference_id, created_at
     ) VALUES ($1, NULL, 'invoice_viewed', $2, $3, 'invoices', $4, CURRENT_TIMESTAMP)
     RETURNING id`,
    [businessId, title, message, invoiceId]
  );

  const notificationId = ins[0]?.id;
  if (notificationId) {
    await publishInvoiceViewedEvents(
      businessId,
      notificationId,
      title,
      message,
      invoiceId
    );
  }

  return { firstView: true };
}
