/**
 * Editable platform email templates (stored in platform_settings.email_templates).
 * Placeholders: {{businessName}}, {{planName}}, {{amount}}, {{billingCycle}}, {{paymentReference}}, {{reason}}
 */

import { query, queryOne } from '@/lib/db';
import {
  PLATFORM_TEMPLATE_DEFINITIONS,
  type PlatformTemplateId,
} from '@/lib/platform-email-template-definitions';

export type {
  PlatformTemplateId,
  TemplateDefinition,
} from '@/lib/platform-email-template-definitions';
export { PLATFORM_TEMPLATE_DEFINITIONS } from '@/lib/platform-email-template-definitions';

const APP_URL = () => process.env.NEXT_PUBLIC_APP_URL || 'https://app.khatario.com';

export function renderTemplateString(
  template: string,
  vars: Record<string, string | number | undefined | null>,
): string {
  const merged: Record<string, string> = { appUrl: APP_URL() };
  for (const [k, v] of Object.entries(vars)) {
    merged[k] = v == null ? '' : String(v);
  }
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => merged[key] ?? '');
}

export async function getPlatformEmailTemplates(): Promise<Record<string, { subject?: string; body_html?: string }>> {
  try {
    const row = await queryOne<{ email_templates: Record<string, unknown> }>(
      `SELECT email_templates FROM platform_settings WHERE id = 'default'`,
    );
    return (row?.email_templates as Record<string, { subject?: string; body_html?: string }>) || {};
  } catch {
    return {};
  }
}

export async function updatePlatformEmailTemplates(
  templates: Record<string, { subject?: string; body_html?: string }>,
): Promise<Record<string, { subject?: string; body_html?: string }>> {
  await query(
    `INSERT INTO platform_settings (id, email_templates, updated_at)
     VALUES ('default', $1::jsonb, NOW())
     ON CONFLICT (id) DO UPDATE SET email_templates = EXCLUDED.email_templates, updated_at = NOW()`,
    [JSON.stringify(templates)],
  );
  return templates;
}

export function resolveTemplate(
  templateId: PlatformTemplateId,
  stored: Record<string, { subject?: string; body_html?: string }>,
  vars: Record<string, string | number | undefined | null>,
): { subject: string; html: string } {
  const def = PLATFORM_TEMPLATE_DEFINITIONS.find((d) => d.id === templateId)!;
  const custom = stored[templateId];
  const subject = renderTemplateString(custom?.subject?.trim() || def.defaultSubject, vars);
  const bodyHtml = renderTemplateString(custom?.body_html?.trim() || def.defaultBodyHtml, vars);
  return { subject, html: bodyHtml };
}
