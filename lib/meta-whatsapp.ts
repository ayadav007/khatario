/**
 * WhatsApp Cloud API (Graph) for the platform WABA.
 * Never logs META_WA_ACCESS_TOKEN.
 */

import { createHmac, timingSafeEqual } from 'crypto';

const GRAPH_VERSION = 'v21.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;
const FETCH_MS = 25_000;

export type MetaWaConfig = {
  accessToken: string;
  wabaId: string;
  phoneNumberId: string;
};

export function getMetaWaConfig(): MetaWaConfig | null {
  const accessToken = process.env.META_WA_ACCESS_TOKEN?.trim();
  const wabaId = process.env.META_WA_WABA_ID?.trim();
  const phoneNumberId = process.env.META_WA_PHONE_NUMBER_ID?.trim();
  if (!accessToken || !wabaId || !phoneNumberId) return null;
  return { accessToken, wabaId, phoneNumberId };
}

export function isMetaWaConfigured(): boolean {
  return getMetaWaConfig() != null;
}

export class MetaWhatsAppError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code = 'META_WA_ERROR',
  ) {
    super(message);
    this.name = 'MetaWhatsAppError';
  }
}

async function graphFetch(
  path: string,
  init: RequestInit & { token: string },
): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_MS);
  try {
    const res = await fetch(`${GRAPH_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${init.token}`,
        'Content-Type': 'application/json',
        ...(init.headers || {}),
      },
      signal: ctrl.signal,
    });
    const raw = await res.text();
    let json: unknown = null;
    try {
      json = raw ? JSON.parse(raw) : null;
    } catch {
      json = { raw };
    }
    if (!res.ok) {
      const errObj = json as { error?: { message?: string } };
      const msg = errObj?.error?.message || `Graph API ${res.status}`;
      throw new MetaWhatsAppError(msg, res.status);
    }
    return json;
  } finally {
    clearTimeout(t);
  }
}

export type GraphComponent = Record<string, unknown>;

export async function createMessageTemplate(input: {
  name: string;
  language: string;
  category: string;
  components: GraphComponent[];
}): Promise<{ id: string; status: string; category?: string }> {
  const cfg = getMetaWaConfig();
  if (!cfg) throw new MetaWhatsAppError('Meta WhatsApp is not configured', 503, 'META_WA_NOT_CONFIGURED');
  const json = (await graphFetch(`/${cfg.wabaId}/message_templates`, {
    token: cfg.accessToken,
    method: 'POST',
    body: JSON.stringify({
      name: input.name,
      language: input.language,
      category: input.category,
      components: input.components,
    }),
  })) as { id?: string; status?: string; category?: string };
  if (!json.id) throw new MetaWhatsAppError('Template create returned no id', 502);
  return { id: json.id, status: json.status || 'PENDING', category: json.category };
}

export async function listMessageTemplates(): Promise<
  Array<{ id: string; name: string; status: string; language?: string }>
> {
  const cfg = getMetaWaConfig();
  if (!cfg) throw new MetaWhatsAppError('Meta WhatsApp is not configured', 503, 'META_WA_NOT_CONFIGURED');
  const json = (await graphFetch(
    `/${cfg.wabaId}/message_templates?fields=id,name,status,language&limit=100`,
    { token: cfg.accessToken, method: 'GET' },
  )) as { data?: Array<{ id: string; name: string; status: string; language?: string }> };
  return json.data || [];
}

export async function deleteMessageTemplate(name: string): Promise<void> {
  const cfg = getMetaWaConfig();
  if (!cfg) throw new MetaWhatsAppError('Meta WhatsApp is not configured', 503, 'META_WA_NOT_CONFIGURED');
  await graphFetch(
    `/${cfg.wabaId}/message_templates?name=${encodeURIComponent(name)}`,
    { token: cfg.accessToken, method: 'DELETE' },
  );
}

export async function sendTemplateMessage(input: {
  to: string;
  name: string;
  language: string;
  components?: GraphComponent[];
}): Promise<{ messageId: string }> {
  const cfg = getMetaWaConfig();
  if (!cfg) throw new MetaWhatsAppError('Meta WhatsApp is not configured', 503, 'META_WA_NOT_CONFIGURED');
  const to = input.to.replace(/\D/g, '');
  const json = (await graphFetch(`/${cfg.phoneNumberId}/messages`, {
    token: cfg.accessToken,
    method: 'POST',
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'template',
      template: {
        name: input.name,
        language: { code: input.language },
        ...(input.components && input.components.length > 0 ? { components: input.components } : {}),
      },
    }),
  })) as { messages?: Array<{ id?: string }> };
  const messageId = json.messages?.[0]?.id;
  if (!messageId) throw new MetaWhatsAppError('Send returned no message id', 502);
  return { messageId };
}

export function countBodyPlaceholders(body: string): number {
  const matches = body.match(/\{\{(\d+)\}\}/g) || [];
  let max = 0;
  for (const m of matches) {
    const n = Number(m.replace(/\D/g, ''));
    if (n > max) max = n;
  }
  return max;
}

export function buildGraphComponents(input: {
  category: string;
  bodyText: string;
  headerText?: string | null;
  footerText?: string | null;
  exampleVars: string[];
}): GraphComponent[] {
  if (input.category === 'AUTHENTICATION') {
    return [
      { type: 'BODY', add_security_recommendation: true },
      { type: 'FOOTER', code_expiration_minutes: 10 },
      { type: 'BUTTONS', buttons: [{ type: 'OTP', otp_type: 'COPY_CODE' }] },
    ];
  }

  const components: GraphComponent[] = [];
  if (input.headerText?.trim()) {
    components.push({ type: 'HEADER', format: 'TEXT', text: input.headerText.trim() });
  }
  const body: GraphComponent = { type: 'BODY', text: input.bodyText };
  const n = countBodyPlaceholders(input.bodyText);
  if (n > 0) {
    const examples = Array.from({ length: n }, (_, i) => input.exampleVars[i] || `example${i + 1}`);
    body.example = { body_text: [examples] };
  }
  components.push(body);
  if (input.footerText?.trim()) {
    components.push({ type: 'FOOTER', text: input.footerText.trim() });
  }
  return components;
}

export function buildSendComponents(input: {
  category: string;
  vars: string[];
}): GraphComponent[] {
  if (input.vars.length === 0 && input.category !== 'AUTHENTICATION') return [];
  const bodyParams = input.vars.map((text) => ({ type: 'text', text }));
  const components: GraphComponent[] = [];
  if (bodyParams.length > 0) {
    components.push({ type: 'body', parameters: bodyParams });
  }
  if (input.category === 'AUTHENTICATION' && input.vars[0]) {
    components.push({
      type: 'button',
      sub_type: 'url',
      index: '0',
      parameters: [{ type: 'text', text: input.vars[0] }],
    });
  }
  return components;
}

export function verifyMetaWaWebhookSignature(rawBody: string, signatureHeader: string | null): boolean {
  const secret = process.env.META_WA_APP_SECRET;
  if (!secret?.trim()) return false;
  if (!signatureHeader?.trim()) return false;
  const expected = `sha256=${createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')}`;
  try {
    const a = Buffer.from(signatureHeader, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function metaWaWebhookChallenge(searchParams: URLSearchParams): string | null {
  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');
  const expected = process.env.META_WA_VERIFY_TOKEN?.trim();
  if (mode === 'subscribe' && expected && token === expected && challenge) return challenge;
  return null;
}

export type TemplateStatusUpdate = {
  event: string;
  message_template_id?: string;
  message_template_name?: string;
  message_template_language?: string;
  reason?: string;
};

export function extractTemplateStatusUpdates(body: unknown): TemplateStatusUpdate[] {
  const out: TemplateStatusUpdate[] = [];
  const root = body as { entry?: Array<{ changes?: Array<{ field?: string; value?: TemplateStatusUpdate }> }> };
  for (const entry of root?.entry || []) {
    for (const change of entry.changes || []) {
      if (change.field !== 'message_template_status_update' || !change.value) continue;
      out.push(change.value);
    }
  }
  return out;
}

export function sanitizeTemplateName(raw: string): string {
  let s = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 512);
  if (!s) s = 'template';
  if (!/^[a-z]/.test(s)) s = `t_${s}`;
  return s;
}

export function mapMetaStatus(raw: string | undefined | null): string {
  const u = String(raw || '').toUpperCase();
  if (u === 'APPROVED') return 'approved';
  if (u === 'REJECTED' || u === 'INVALID') return 'rejected';
  if (u === 'PAUSED') return 'paused';
  if (u === 'DISABLED' || u === 'FLAGGED') return 'disabled';
  if (u === 'PENDING' || u === 'IN_APPEAL' || u === 'PENDING_DELETION') return 'pending';
  return 'pending';
}
