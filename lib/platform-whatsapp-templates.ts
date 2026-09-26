import { query, queryOne, queryRows } from '@/lib/db';
import {
  buildGraphComponents,
  createMessageTemplate,
  deleteMessageTemplate,
  isMetaWaConfigured,
  listMessageTemplates,
  mapMetaStatus,
  MetaWhatsAppError,
  sanitizeTemplateName,
} from '@/lib/meta-whatsapp';

export const PLATFORM_WA_EVENT_KEYS = [
  'signup_otp',
  'demo_booking_otp',
  'trial_ending',
  'subscription_payment_failed',
  'subscription_ended',
  'promo',
] as const;

export type PlatformWaEventKey = (typeof PLATFORM_WA_EVENT_KEYS)[number];

export const PLATFORM_WA_LANGUAGES = ['en_US', 'en', 'hi'] as const;
export const PLATFORM_WA_CATEGORIES = ['AUTHENTICATION', 'UTILITY', 'MARKETING'] as const;

export type PlatformWhatsAppTemplate = {
  id: string;
  name: string;
  language: string;
  category: string;
  body_text: string;
  header_text: string | null;
  footer_text: string | null;
  example_vars: string[];
  buttons: unknown;
  meta_template_id: string | null;
  status: string;
  rejected_reason: string | null;
  event_key: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

function parseVars(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((v) => String(v));
  return [];
}

function mapRow(row: Record<string, unknown>): PlatformWhatsAppTemplate {
  return {
    id: String(row.id),
    name: String(row.name),
    language: String(row.language),
    category: String(row.category),
    body_text: String(row.body_text || ''),
    header_text: row.header_text ? String(row.header_text) : null,
    footer_text: row.footer_text ? String(row.footer_text) : null,
    example_vars: parseVars(row.example_vars),
    buttons: row.buttons,
    meta_template_id: row.meta_template_id ? String(row.meta_template_id) : null,
    status: String(row.status),
    rejected_reason: row.rejected_reason ? String(row.rejected_reason) : null,
    event_key: row.event_key ? String(row.event_key) : null,
    created_by: row.created_by ? String(row.created_by) : null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

export { sanitizeTemplateName } from '@/lib/meta-whatsapp';

export async function listPlatformWhatsAppTemplates(): Promise<PlatformWhatsAppTemplate[]> {
  const rows = await queryRows<Record<string, unknown>>(
    `SELECT * FROM platform_whatsapp_templates ORDER BY updated_at DESC`,
  );
  return rows.map(mapRow);
}

export async function getPlatformWhatsAppTemplate(id: string): Promise<PlatformWhatsAppTemplate | null> {
  const row = await queryOne<Record<string, unknown>>(
    `SELECT * FROM platform_whatsapp_templates WHERE id = $1`,
    [id],
  );
  return row ? mapRow(row) : null;
}

export async function createPlatformWhatsAppDraft(input: {
  name: string;
  language: string;
  category: string;
  body_text: string;
  header_text?: string | null;
  footer_text?: string | null;
  example_vars?: string[];
  event_key?: string | null;
  created_by: string;
}): Promise<PlatformWhatsAppTemplate> {
  const name = sanitizeTemplateName(input.name);
  const language = PLATFORM_WA_LANGUAGES.includes(input.language as (typeof PLATFORM_WA_LANGUAGES)[number])
    ? input.language
    : 'en_US';
  const category = PLATFORM_WA_CATEGORIES.includes(input.category as (typeof PLATFORM_WA_CATEGORIES)[number])
    ? input.category
    : 'UTILITY';
  const eventKey =
    input.event_key && PLATFORM_WA_EVENT_KEYS.includes(input.event_key as PlatformWaEventKey)
      ? input.event_key
      : null;
  const body = category === 'AUTHENTICATION' ? input.body_text || '' : String(input.body_text || '').trim();
  if (category !== 'AUTHENTICATION' && !body) {
    throw new Error('Body text is required');
  }

  const row = await queryOne<Record<string, unknown>>(
    `INSERT INTO platform_whatsapp_templates
      (name, language, category, body_text, header_text, footer_text, example_vars, event_key, created_by, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, 'draft')
     RETURNING *`,
    [
      name,
      language,
      category,
      body,
      input.header_text?.trim() || null,
      input.footer_text?.trim() || null,
      JSON.stringify(input.example_vars || []),
      eventKey,
      input.created_by,
    ],
  );
  if (!row) throw new Error('Failed to create draft');
  return mapRow(row);
}

export async function updatePlatformWhatsAppDraft(
  id: string,
  input: Partial<{
    name: string;
    language: string;
    category: string;
    body_text: string;
    header_text: string | null;
    footer_text: string | null;
    example_vars: string[];
    event_key: string | null;
  }>,
): Promise<PlatformWhatsAppTemplate> {
  const existing = await getPlatformWhatsAppTemplate(id);
  if (!existing) throw new Error('Template not found');
  if (existing.status !== 'draft' && existing.status !== 'rejected') {
    throw new Error('Only draft or rejected templates can be edited');
  }

  const name = input.name != null ? sanitizeTemplateName(input.name) : existing.name;
  const language = input.language ?? existing.language;
  const category = input.category ?? existing.category;
  const body_text = input.body_text != null ? input.body_text : existing.body_text;
  const header_text = input.header_text !== undefined ? input.header_text : existing.header_text;
  const footer_text = input.footer_text !== undefined ? input.footer_text : existing.footer_text;
  const example_vars = input.example_vars ?? existing.example_vars;
  const event_key =
    input.event_key !== undefined
      ? input.event_key && PLATFORM_WA_EVENT_KEYS.includes(input.event_key as PlatformWaEventKey)
        ? input.event_key
        : null
      : existing.event_key;

  const row = await queryOne<Record<string, unknown>>(
    `UPDATE platform_whatsapp_templates SET
       name = $2, language = $3, category = $4, body_text = $5,
       header_text = $6, footer_text = $7, example_vars = $8::jsonb, event_key = $9,
       status = 'draft', rejected_reason = NULL, updated_at = CURRENT_TIMESTAMP
     WHERE id = $1
     RETURNING *`,
    [
      id,
      name,
      language,
      category,
      body_text,
      header_text,
      footer_text,
      JSON.stringify(example_vars),
      event_key,
    ],
  );
  if (!row) throw new Error('Update failed');
  return mapRow(row);
}

export async function submitPlatformWhatsAppTemplate(id: string): Promise<PlatformWhatsAppTemplate> {
  if (!(await isMetaWaConfigured())) {
    throw new MetaWhatsAppError('Meta WhatsApp is not configured', 503, 'META_WA_NOT_CONFIGURED');
  }
  const existing = await getPlatformWhatsAppTemplate(id);
  if (!existing) throw new Error('Template not found');
  if (existing.status !== 'draft' && existing.status !== 'rejected') {
    throw new Error('Template is already submitted');
  }

  const created = await createMessageTemplate({
    name: existing.name,
    language: existing.language,
    category: existing.category,
    components: buildGraphComponents({
      category: existing.category,
      bodyText: existing.body_text,
      headerText: existing.header_text,
      footerText: existing.footer_text,
      exampleVars: existing.example_vars,
    }),
  });

  const status = mapMetaStatus(created.status);
  const row = await queryOne<Record<string, unknown>>(
    `UPDATE platform_whatsapp_templates SET
       meta_template_id = $2, status = $3, rejected_reason = NULL, updated_at = CURRENT_TIMESTAMP
     WHERE id = $1
     RETURNING *`,
    [id, created.id, status === 'approved' ? 'approved' : 'pending'],
  );
  if (!row) throw new Error('Submit update failed');
  return mapRow(row);
}

export async function syncPlatformWhatsAppTemplates(): Promise<PlatformWhatsAppTemplate[]> {
  if (!(await isMetaWaConfigured())) {
    throw new MetaWhatsAppError('Meta WhatsApp is not configured', 503, 'META_WA_NOT_CONFIGURED');
  }
  const remote = await listMessageTemplates();
  const local = await listPlatformWhatsAppTemplates();
  for (const row of local) {
    const match = remote.find((r) => {
      if (r.name !== row.name) return false;
      if (!r.language) return true;
      const lang = typeof r.language === 'string' ? r.language : String(r.language);
      return lang === row.language || lang.startsWith(row.language);
    });
    if (!match) continue;
    const status = mapMetaStatus(match.status);
    await query(
      `UPDATE platform_whatsapp_templates
       SET meta_template_id = COALESCE($2, meta_template_id), status = $3, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND status <> 'draft'`,
      [row.id, match.id, status],
    );
  }
  return listPlatformWhatsAppTemplates();
}

export async function applyWebhookTemplateStatus(update: {
  event: string;
  message_template_id?: string;
  message_template_name?: string;
  message_template_language?: string;
  reason?: string;
}): Promise<void> {
  const status = mapMetaStatus(update.event);
  const reason = update.reason || (status === 'rejected' ? update.event : null);
  if (update.message_template_id) {
    await query(
      `UPDATE platform_whatsapp_templates
       SET status = $2, rejected_reason = $3, updated_at = CURRENT_TIMESTAMP
       WHERE meta_template_id = $1`,
      [update.message_template_id, status, reason],
    );
  }
  if (update.message_template_name) {
    await query(
      `UPDATE platform_whatsapp_templates
       SET status = $3, rejected_reason = $4, updated_at = CURRENT_TIMESTAMP
       WHERE name = $1 AND ($2::text IS NULL OR language = $2)`,
      [update.message_template_name, update.message_template_language || null, status, reason],
    );
  }
}

export async function deletePlatformWhatsAppTemplate(id: string): Promise<void> {
  const existing = await getPlatformWhatsAppTemplate(id);
  if (!existing) throw new Error('Template not found');
  if (existing.status !== 'draft' && existing.meta_template_id && (await isMetaWaConfigured())) {
    try {
      await deleteMessageTemplate(existing.name);
    } catch (err) {
      console.warn('[meta-wa] Graph delete failed', err instanceof Error ? err.message : err);
    }
  }
  await query(`DELETE FROM platform_whatsapp_templates WHERE id = $1`, [id]);
}
