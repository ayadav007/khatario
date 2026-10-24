/**
 * Editable platform email templates (stored in platform_settings.email_templates).
 * Placeholders: {{businessName}}, {{planName}}, {{amount}}, {{billingCycle}}, {{paymentReference}}, {{reason}}
 */

import { query, queryOne } from '@/lib/db';
import {
  PLATFORM_TEMPLATE_DEFINITIONS,
  isAllowedTemplateId,
  type PlatformTemplateId,
  type StoredEmailTemplate,
} from '@/lib/platform-email-template-definitions';

export type {
  PlatformTemplateId,
  TemplateDefinition,
  StoredEmailTemplate,
} from '@/lib/platform-email-template-definitions';
export {
  PLATFORM_TEMPLATE_DEFINITIONS,
  isSystemTemplateId,
  isAllowedTemplateId,
} from '@/lib/platform-email-template-definitions';

const APP_URL = () => process.env.NEXT_PUBLIC_APP_URL || 'https://app.khatario.com';

export function defaultSupportEmail(): string {
  return (
    process.env.NEXT_PUBLIC_SUPPORT_EMAIL?.trim() ||
    process.env.EMAIL_FROM?.trim() ||
    'help@khatario.com'
  );
}

export function renderTemplateString(
  template: string,
  vars: Record<string, string | number | undefined | null>,
): string {
  const merged: Record<string, string> = {
    appUrl: APP_URL(),
    supportEmail: defaultSupportEmail(),
  };
  for (const [k, v] of Object.entries(vars)) {
    merged[k] = v == null ? '' : String(v);
  }
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => merged[key] ?? '');
}

export async function getPlatformEmailTemplates(): Promise<Record<string, StoredEmailTemplate>> {
  try {
    const row = await queryOne<{ email_templates: Record<string, unknown> }>(
      `SELECT email_templates FROM platform_settings WHERE id = 'default'`,
    );
    return sanitizeStoredTemplates(row?.email_templates);
  } catch {
    return {};
  }
}

export function sanitizeStoredTemplates(
  raw: unknown,
): Record<string, StoredEmailTemplate> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, StoredEmailTemplate> = {};
  for (const [id, val] of Object.entries(raw as Record<string, unknown>)) {
    if (!isAllowedTemplateId(id) || !val || typeof val !== 'object' || Array.isArray(val)) continue;
    const row = val as StoredEmailTemplate;
    out[id] = {
      label: typeof row.label === 'string' ? row.label.slice(0, 120) : undefined,
      subject: typeof row.subject === 'string' ? row.subject.slice(0, 500) : '',
      body_html: typeof row.body_html === 'string' ? row.body_html.slice(0, 100_000) : '',
    };
  }
  return out;
}

export async function updatePlatformEmailTemplates(
  templates: Record<string, StoredEmailTemplate>,
): Promise<Record<string, StoredEmailTemplate>> {
  const next = sanitizeStoredTemplates(templates);
  await query(
    `INSERT INTO platform_settings (id, email_templates, updated_at)
     VALUES ('default', $1::jsonb, NOW())
     ON CONFLICT (id) DO UPDATE SET email_templates = EXCLUDED.email_templates, updated_at = NOW()`,
    [JSON.stringify(next)],
  );
  return next;
}

export function resolveTemplate(
  templateId: PlatformTemplateId,
  stored: Record<string, StoredEmailTemplate>,
  vars: Record<string, string | number | undefined | null>,
): { subject: string; html: string } {
  const def = PLATFORM_TEMPLATE_DEFINITIONS.find((d) => d.id === templateId)!;
  const custom = stored[templateId];
  const subject = renderTemplateString(custom?.subject?.trim() || def.defaultSubject, vars);
  const bodyHtml = renderTemplateString(custom?.body_html?.trim() || def.defaultBodyHtml, vars);
  return { subject, html: bodyHtml };
}
