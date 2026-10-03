import { query, queryOne, queryRows } from '@/lib/db';
import {
  buildGraphComponents,
  createMessageTemplate,
  deleteMessageTemplate,
  listMessageTemplates,
  mapMetaStatus,
  sanitizeTemplateName,
  type GraphTemplate,
  type TemplateStatusUpdate,
} from '@/lib/meta-whatsapp';
import {
  TENANT_WA_FIELDS,
  countPlaceholders,
  getTenantWaEvent,
  templateEventMismatch,
  type TemplateCategory,
  type TenantWaEventKey,
} from '@/lib/whatsapp/tenant-events';

export type BusinessWaTemplate = {
  id: string;
  name: string;
  language: string;
  category: TemplateCategory;
  header_format: 'none' | 'text' | 'document' | 'image' | 'video';
  header_text: string | null;
  body_text: string;
  footer_text: string | null;
  example_vars: string[];
  placeholder_count: number;
  meta_template_id: string | null;
  status: string;
  rejected_reason: string | null;
  source: 'khatario' | 'meta';
  created_at: string;
  updated_at: string;
};

export type BusinessWaEventMapping = {
  event_key: TenantWaEventKey;
  template_id: string;
  variable_map: string[];
};

export class TenantTemplateError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = 'TenantTemplateError';
  }
}

const COLUMNS = `id, name, language, category, header_format, header_text, body_text, footer_text,
  example_vars, placeholder_count, meta_template_id, status, rejected_reason, source, created_at, updated_at`;

const CATEGORIES: TemplateCategory[] = ['AUTHENTICATION', 'UTILITY', 'MARKETING'];
const LANGUAGE_RE = /^[a-z]{2,3}(_[A-Z]{2})?$/;

export async function listBusinessTemplates(businessId: string): Promise<BusinessWaTemplate[]> {
  return queryRows<BusinessWaTemplate>(
    `SELECT ${COLUMNS} FROM business_whatsapp_templates WHERE business_id = $1 ORDER BY name, language`,
    [businessId],
  );
}

export async function getBusinessTemplate(businessId: string, id: string): Promise<BusinessWaTemplate | null> {
  return queryOne<BusinessWaTemplate>(
    `SELECT ${COLUMNS} FROM business_whatsapp_templates WHERE business_id = $1 AND id = $2`,
    [businessId, id],
  );
}

export type TemplateDraftInput = {
  name?: unknown;
  language?: unknown;
  category?: unknown;
  header_text?: unknown;
  body_text?: unknown;
  footer_text?: unknown;
  example_vars?: unknown;
};

function cleanText(v: unknown, max: number): string {
  return String(v ?? '').trim().slice(0, max);
}

function validateDraft(input: TemplateDraftInput) {
  const name = sanitizeTemplateName(cleanText(input.name, 512));
  const language = cleanText(input.language, 16) || 'en_US';
  if (!LANGUAGE_RE.test(language)) throw new TenantTemplateError('Language must look like en_US or hi');
  const category = cleanText(input.category, 32).toUpperCase() as TemplateCategory;
  if (!CATEGORIES.includes(category)) throw new TenantTemplateError('Choose a category');
  const header = cleanText(input.header_text, 60);
  const body = cleanText(input.body_text, 1024);
  const footer = cleanText(input.footer_text, 60);
  if (category !== 'AUTHENTICATION') {
    if (!body) throw new TenantTemplateError('Message text is required');
    if (/^\s*\{\{\d+\}\}|\{\{\d+\}\}\s*[.!?]?\s*$/.test(body)) {
      throw new TenantTemplateError('Meta does not allow the message to start or end with a {{n}} placeholder');
    }
    const used = new Set(Array.from(body.matchAll(/\{\{(\d+)\}\}/g), (m) => Number(m[1])));
    for (let i = 1; i <= used.size; i++) {
      if (!used.has(i)) {
        throw new TenantTemplateError('Number placeholders in order without gaps: {{1}}, {{2}}, {{3}}...');
      }
    }
    if (/\{\{(?!\d+\}\})/.test(body)) {
      throw new TenantTemplateError('Placeholders must look like {{1}}');
    }
  }
  if (/\{\{/.test(header) || /\{\{/.test(footer)) {
    throw new TenantTemplateError('Placeholders are only allowed in the message text');
  }
  if (/[\r\n]/.test(header)) throw new TenantTemplateError('The header must be a single line');
  const placeholderCount = category === 'AUTHENTICATION' ? 1 : countPlaceholders(body);
  const examples = Array.isArray(input.example_vars)
    ? input.example_vars.map((v) => cleanText(v, 200)).slice(0, placeholderCount)
    : [];
  return {
    name,
    language,
    category,
    header: header || null,
    body: category === 'AUTHENTICATION' ? '' : body,
    footer: footer || null,
    examples,
    placeholderCount,
  };
}

export async function createBusinessTemplateDraft(
  businessId: string,
  userId: string | null,
  input: TemplateDraftInput,
): Promise<BusinessWaTemplate> {
  const d = validateDraft(input);
  const row = await queryOne<BusinessWaTemplate>(
    `INSERT INTO business_whatsapp_templates
       (business_id, name, language, category, header_format, header_text, body_text, footer_text,
        example_vars, placeholder_count, status, source, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, 'draft', 'khatario', $11)
     ON CONFLICT (business_id, name, language) DO NOTHING
     RETURNING ${COLUMNS}`,
    [
      businessId,
      d.name,
      d.language,
      d.category,
      d.header ? 'text' : 'none',
      d.header,
      d.body,
      d.footer,
      JSON.stringify(d.examples),
      d.placeholderCount,
      userId,
    ],
  );
  if (!row) throw new TenantTemplateError(`A template named ${d.name} (${d.language}) already exists`, 409);
  return row;
}

export async function updateBusinessTemplateDraft(
  businessId: string,
  id: string,
  input: TemplateDraftInput,
): Promise<BusinessWaTemplate> {
  const existing = await getBusinessTemplate(businessId, id);
  if (!existing) throw new TenantTemplateError('Template not found', 404);
  if (existing.source !== 'khatario' || !['draft', 'rejected'].includes(existing.status)) {
    throw new TenantTemplateError('Only drafts and rejected templates can be edited');
  }
  const d = validateDraft({ ...input, name: existing.name, language: existing.language });
  const row = await queryOne<BusinessWaTemplate>(
    `UPDATE business_whatsapp_templates SET
       category = $3, header_format = $4, header_text = $5, body_text = $6, footer_text = $7,
       example_vars = $8::jsonb, placeholder_count = $9, status = 'draft', rejected_reason = NULL,
       meta_template_id = NULL, updated_at = CURRENT_TIMESTAMP
     WHERE business_id = $1 AND id = $2
     RETURNING ${COLUMNS}`,
    [
      businessId,
      id,
      d.category,
      d.header ? 'text' : 'none',
      d.header,
      d.body,
      d.footer,
      JSON.stringify(d.examples),
      d.placeholderCount,
    ],
  );
  return row!;
}

export async function deleteBusinessTemplate(businessId: string, id: string): Promise<void> {
  const existing = await getBusinessTemplate(businessId, id);
  if (!existing) throw new TenantTemplateError('Template not found', 404);
  if (existing.meta_template_id) {
    try {
      await deleteMessageTemplate(existing.name, businessId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!/not found|does not exist/i.test(msg)) throw err;
    }
  }
  await query(`DELETE FROM business_whatsapp_templates WHERE business_id = $1 AND id = $2`, [businessId, id]);
}

export async function submitBusinessTemplate(businessId: string, id: string): Promise<BusinessWaTemplate> {
  const t = await getBusinessTemplate(businessId, id);
  if (!t) throw new TenantTemplateError('Template not found', 404);
  if (!['draft', 'rejected'].includes(t.status)) throw new TenantTemplateError('Template is already submitted');
  try {
    const created = await createMessageTemplate({
      businessId,
      name: t.name,
      language: t.language,
      category: t.category,
      components: buildGraphComponents({
        category: t.category,
        bodyText: t.body_text,
        headerText: t.header_text,
        footerText: t.footer_text,
        exampleVars: t.example_vars || [],
      }),
    });
    const status = mapMetaStatus(created.status);
    const row = await queryOne<BusinessWaTemplate>(
      `UPDATE business_whatsapp_templates SET
         meta_template_id = $3, status = $4, rejected_reason = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE business_id = $1 AND id = $2
       RETURNING ${COLUMNS}`,
      [businessId, id, created.id, status === 'approved' ? 'approved' : 'pending'],
    );
    return row!;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Same name already on Meta (made there, or by an earlier submit): adopt its status.
    if (/already exists|duplicate/i.test(msg)) {
      await syncBusinessTemplates(businessId);
      return (await getBusinessTemplate(businessId, id))!;
    }
    throw err;
  }
}

function parseGraphTemplate(r: GraphTemplate) {
  const comps = r.components || [];
  const find = (type: string) => comps.find((c) => String(c.type || '').toUpperCase() === type);
  const header = find('HEADER');
  const body = find('BODY');
  const footer = find('FOOTER');
  const buttons = find('BUTTONS')?.buttons || [];
  const format = String(header?.format || '').toLowerCase();
  const category = (CATEGORIES.includes(String(r.category) as TemplateCategory)
    ? r.category
    : 'UTILITY') as TemplateCategory;
  const bodyText = body?.text || '';
  return {
    name: r.name,
    language: r.language || 'en_US',
    category,
    headerFormat: header ? (['text', 'document', 'image', 'video'].includes(format) ? format : 'text') : 'none',
    headerText: header && format === 'text' ? header.text || null : null,
    bodyText,
    footerText: footer?.text || null,
    buttons,
    placeholderCount: category === 'AUTHENTICATION' ? 1 : countPlaceholders(bodyText),
    status: mapMetaStatus(r.status),
    rejectedReason: r.rejected_reason && r.rejected_reason !== 'NONE' ? r.rejected_reason : null,
    metaId: r.id,
  };
}

/** Pulls every template on the business's WABA; templates made in Khatario keep their source. */
export async function syncBusinessTemplates(businessId: string): Promise<BusinessWaTemplate[]> {
  const remote = await listMessageTemplates(businessId);
  for (const r of remote) {
    const t = parseGraphTemplate(r);
    await query(
      `INSERT INTO business_whatsapp_templates
         (business_id, name, language, category, header_format, header_text, body_text, footer_text,
          buttons, placeholder_count, meta_template_id, status, rejected_reason, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13, 'meta')
       ON CONFLICT (business_id, name, language) DO UPDATE SET
         category = EXCLUDED.category,
         header_format = EXCLUDED.header_format,
         header_text = EXCLUDED.header_text,
         body_text = EXCLUDED.body_text,
         footer_text = EXCLUDED.footer_text,
         buttons = EXCLUDED.buttons,
         placeholder_count = EXCLUDED.placeholder_count,
         meta_template_id = EXCLUDED.meta_template_id,
         status = EXCLUDED.status,
         rejected_reason = EXCLUDED.rejected_reason,
         updated_at = CURRENT_TIMESTAMP`,
      [
        businessId,
        t.name,
        t.language,
        t.category,
        t.headerFormat,
        t.headerText,
        t.bodyText,
        t.footerText,
        JSON.stringify(t.buttons),
        t.placeholderCount,
        t.metaId,
        t.status,
        t.rejectedReason,
      ],
    );
  }
  return listBusinessTemplates(businessId);
}

export async function applyBusinessTemplateWebhook(businessId: string, update: TemplateStatusUpdate): Promise<void> {
  const status = mapMetaStatus(update.event);
  const reason = update.reason && update.reason !== 'NONE' ? update.reason : status === 'rejected' ? update.event : null;
  if (update.message_template_id) {
    const res = await query(
      `UPDATE business_whatsapp_templates SET status = $3, rejected_reason = $4, updated_at = CURRENT_TIMESTAMP
       WHERE business_id = $1 AND meta_template_id = $2`,
      [businessId, String(update.message_template_id), status, reason],
    );
    if (res.rowCount) return;
  }
  if (update.message_template_name) {
    await query(
      `UPDATE business_whatsapp_templates SET status = $4, rejected_reason = $5, updated_at = CURRENT_TIMESTAMP
       WHERE business_id = $1 AND name = $2 AND ($3::text IS NULL OR language = $3)`,
      [businessId, update.message_template_name, update.message_template_language || null, status, reason],
    );
  }
}

export async function listEventMappings(businessId: string): Promise<BusinessWaEventMapping[]> {
  return queryRows<BusinessWaEventMapping>(
    `SELECT event_key, template_id, variable_map FROM business_whatsapp_event_templates WHERE business_id = $1`,
    [businessId],
  );
}

export async function setEventMapping(
  businessId: string,
  userId: string | null,
  eventKey: TenantWaEventKey,
  templateId: string | null,
  variableMap: string[],
): Promise<void> {
  if (!templateId) {
    await query(`DELETE FROM business_whatsapp_event_templates WHERE business_id = $1 AND event_key = $2`, [
      businessId,
      eventKey,
    ]);
    return;
  }
  const template = await getBusinessTemplate(businessId, templateId);
  if (!template) throw new TenantTemplateError('Template not found', 404);
  const map = template.category === 'AUTHENTICATION' ? ['code'] : variableMap.map(String);
  const mismatch = templateEventMismatch(getTenantWaEvent(eventKey), template, map);
  if (mismatch) throw new TenantTemplateError(mismatch);
  await query(
    `INSERT INTO business_whatsapp_event_templates (business_id, event_key, template_id, variable_map, updated_by)
     VALUES ($1, $2, $3, $4::jsonb, $5)
     ON CONFLICT (business_id, event_key) DO UPDATE SET
       template_id = EXCLUDED.template_id, variable_map = EXCLUDED.variable_map,
       updated_by = EXCLUDED.updated_by, updated_at = CURRENT_TIMESTAMP`,
    [businessId, eventKey, templateId, JSON.stringify(map), userId],
  );
}

/** Creates (or reuses) the suggested template for an event, submits it to Meta and selects it. */
export async function useSuggestedTemplate(
  businessId: string,
  userId: string | null,
  eventKey: TenantWaEventKey,
): Promise<BusinessWaTemplate> {
  const event = getTenantWaEvent(eventKey);
  const s = event.suggested;
  let template = await queryOne<BusinessWaTemplate>(
    `SELECT ${COLUMNS} FROM business_whatsapp_templates WHERE business_id = $1 AND name = $2 AND language = 'en_US'`,
    [businessId, s.name],
  );
  if (!template) {
    template = await createBusinessTemplateDraft(businessId, userId, {
      name: s.name,
      language: 'en_US',
      category: s.category,
      body_text: s.body,
      footer_text: s.footer,
      example_vars: s.variableMap.map((k) => sampleFor(k)),
    });
  }
  if (['draft', 'rejected'].includes(template.status) && template.source === 'khatario') {
    template = await submitBusinessTemplate(businessId, template.id);
  }
  await setEventMapping(businessId, userId, eventKey, template.id, s.variableMap);
  return template;
}

function sampleFor(key: string): string {
  return (TENANT_WA_FIELDS as Record<string, { sample: string }>)[key]?.sample ?? key;
}

export type ResolvedEventTemplate = {
  template: BusinessWaTemplate;
  variableMap: string[];
};

/** The approved template a business chose for an event, or null. */
export async function resolveEventTemplate(
  businessId: string,
  eventKey: TenantWaEventKey,
): Promise<ResolvedEventTemplate | null> {
  const row = await queryOne<BusinessWaTemplate & { variable_map: string[] }>(
    `SELECT ${COLUMNS.split(',').map((c) => `t.${c.trim()}`).join(', ')}, m.variable_map
     FROM business_whatsapp_event_templates m
     JOIN business_whatsapp_templates t ON t.id = m.template_id AND t.business_id = m.business_id
     WHERE m.business_id = $1 AND m.event_key = $2 AND t.status = 'approved'`,
    [businessId, eventKey],
  );
  if (!row) return null;
  const { variable_map, ...template } = row;
  return { template, variableMap: Array.isArray(variable_map) ? variable_map : [] };
}
