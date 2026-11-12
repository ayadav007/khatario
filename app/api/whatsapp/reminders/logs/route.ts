export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { withWhatsAppBaseApi } from '@/lib/security/premium-module-api';

const SOURCES = new Set(['manual', 'auto_payment_due', 'auto_overdue']);
const YMD = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /api/whatsapp/reminders/logs?reminder_type=&search=&date_from=&date_to=
 * Invoice payment reminders sent (or attempted) by this business, newest first, for the
 * Payment reminders → History tab. Capped at 500 rows.
 */
export const GET = withWhatsAppBaseApi({ managePermission: 'read' }, async ({ request, businessId }) => {
  try {
    const sp = new URL(request.url).searchParams;
    const where: string[] = [
      'wm.business_id = $1',
      "wm.message_type = 'reminder'",
      "wm.reference_type = 'invoice'",
    ];
    const params: unknown[] = [businessId];

    const type = sp.get('reminder_type');
    if (type && SOURCES.has(type)) {
      if (type === 'manual') where.push("COALESCE(wm.reminder_source, 'manual') = 'manual'");
      else {
        params.push(type);
        where.push(`wm.reminder_source = $${params.length}`);
      }
    }
    const search = sp.get('search')?.trim();
    if (search) {
      params.push(`%${search.slice(0, 100)}%`);
      const n = params.length;
      where.push(`(i.invoice_number ILIKE $${n} OR c.name ILIKE $${n} OR wm.to_number ILIKE $${n})`);
    }
    const from = sp.get('date_from');
    if (from && YMD.test(from)) {
      params.push(from);
      where.push(`wm.sent_at >= $${params.length}::date`);
    }
    const to = sp.get('date_to');
    if (to && YMD.test(to)) {
      params.push(to);
      where.push(`wm.sent_at < ($${params.length}::date + 1)`);
    }

    const logs = await db.queryRows(
      `SELECT wm.id, wm.sent_at, wm.to_number, wm.message_text, wm.status, wm.error_message,
              COALESCE(wm.reminder_source, 'manual') AS reminder_type,
              i.invoice_number, c.name AS customer_name
         FROM whatsapp_messages wm
         LEFT JOIN invoices i ON i.id = wm.reference_id AND i.business_id = wm.business_id
         LEFT JOIN customers c ON c.id = i.customer_id
        WHERE ${where.join(' AND ')}
        ORDER BY wm.sent_at DESC
        LIMIT 500`,
      params,
    );
    return NextResponse.json({ logs });
  } catch (error) {
    console.error('[whatsapp/reminders/logs] GET error:', error);
    return NextResponse.json({ error: 'Failed to load reminder history' }, { status: 500 });
  }
});
