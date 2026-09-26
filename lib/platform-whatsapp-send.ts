import { query, queryOne } from '@/lib/db';
import { buildSendComponents, isMetaWaConfigured, sendTemplateMessage } from '@/lib/meta-whatsapp';
import type { PlatformWaEventKey } from '@/lib/platform-whatsapp-templates';

export function toE164Digits(phone: string): string | null {
  const d = String(phone || '').replace(/\D/g, '');
  if (d.length === 10) return `91${d}`;
  if (d.length >= 11 && d.length <= 15) return d;
  return null;
}

export async function lookupTenantWhatsAppPhone(businessId: string): Promise<string | null> {
  try {
    const row = await queryOne<{ phone: string }>(
      `SELECT phone FROM users
       WHERE business_id = $1 AND phone IS NOT NULL AND TRIM(phone) != ''
       ORDER BY CASE WHEN COALESCE(is_primary_admin, false) THEN 0 ELSE 1 END, created_at ASC
       LIMIT 1`,
      [businessId],
    );
    return row?.phone?.trim() || null;
  } catch (err) {
    console.warn('[platform-wa] lookup phone failed', err instanceof Error ? err.message : err);
    return null;
  }
}

export async function sendPlatformEventWhatsApp(input: {
  eventKey: PlatformWaEventKey;
  toPhone: string;
  vars?: string[];
  language?: string;
}): Promise<{ sent: boolean; skipped: string | null; messageId?: string }> {
  if (!(await isMetaWaConfigured())) {
    return { sent: false, skipped: 'META_WA_NOT_CONFIGURED' };
  }
  const to = toE164Digits(input.toPhone);
  if (!to) return { sent: false, skipped: 'INVALID_PHONE' };

  const preferred = input.language || 'en_US';
  const row = await queryOne<{
    id: string;
    name: string;
    language: string;
    category: string;
  }>(
    `SELECT id, name, language, category FROM platform_whatsapp_templates
     WHERE event_key = $1 AND status = 'approved'
     ORDER BY CASE WHEN language = $2 THEN 0 WHEN language = 'en_US' THEN 1 WHEN language = 'en' THEN 2 ELSE 3 END
     LIMIT 1`,
    [input.eventKey, preferred],
  );
  if (!row) return { sent: false, skipped: 'NO_APPROVED_TEMPLATE' };

  const vars = input.vars || [];
  try {
    const { messageId } = await sendTemplateMessage({
      to,
      name: row.name,
      language: row.language,
      components: buildSendComponents({ category: row.category, vars }),
    });
    await query(
      `INSERT INTO platform_whatsapp_sends (template_id, to_phone, event_key, graph_message_id, status)
       VALUES ($1, $2, $3, $4, 'sent')`,
      [row.id, to, input.eventKey, messageId],
    );
    return { sent: true, skipped: null, messageId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await query(
      `INSERT INTO platform_whatsapp_sends (template_id, to_phone, event_key, status, error_message)
       VALUES ($1, $2, $3, 'failed', $4)`,
      [row.id, to, input.eventKey, msg.slice(0, 500)],
    );
    console.warn('[platform-wa] send failed', msg);
    return { sent: false, skipped: 'SEND_FAILED' };
  }
}

export async function sendApprovedTemplateTest(input: {
  templateId: string;
  toPhone: string;
  vars?: string[];
}): Promise<{ messageId: string }> {
  if (!(await isMetaWaConfigured())) {
    throw new Error('META_WA_NOT_CONFIGURED');
  }
  const to = toE164Digits(input.toPhone);
  if (!to) throw new Error('Invalid phone number');
  const row = await queryOne<{
    id: string;
    name: string;
    language: string;
    category: string;
    status: string;
    event_key: string | null;
  }>(
    `SELECT id, name, language, category, status, event_key FROM platform_whatsapp_templates WHERE id = $1`,
    [input.templateId],
  );
  if (!row) throw new Error('Template not found');
  if (row.status !== 'approved') throw new Error('Template is not approved');

  const { messageId } = await sendTemplateMessage({
    to,
    name: row.name,
    language: row.language,
    components: buildSendComponents({ category: row.category, vars: input.vars || [] }),
  });
  await query(
    `INSERT INTO platform_whatsapp_sends (template_id, to_phone, event_key, graph_message_id, status)
     VALUES ($1, $2, $3, $4, 'sent')`,
    [row.id, to, row.event_key, messageId],
  );
  return { messageId };
}
