/**
 * WhatsApp Cloud API (Graph): the platform WABA by default, or a business's own WABA when a
 * `businessId` is passed. Never logs access tokens.
 */

import { createHmac, timingSafeEqual } from 'crypto';
import { getMetaWaConfig } from '@/lib/meta-whatsapp-credentials';
import { WA_LIMITS } from '@/lib/whatsapp/wa-limits';

export type { MetaWaConfig } from '@/lib/meta-whatsapp-credentials';
export { getMetaWaConfig, isMetaWaConfigured } from '@/lib/meta-whatsapp-credentials';

const GRAPH_VERSION = 'v21.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;
const FETCH_MS = 25_000;

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

/** Graph's top-level message is often just "Invalid parameter"; the real reason is in the user fields. */
export function graphErrorMessage(json: unknown, status: number): string {
  const e = (json as {
    error?: {
      message?: string;
      code?: number;
      error_subcode?: number;
      error_user_title?: string;
      error_user_msg?: string;
      error_data?: { details?: string } | string;
    };
  })?.error;
  if (!e) return `Graph API ${status}`;
  const details = typeof e.error_data === 'string' ? e.error_data : e.error_data?.details;
  const parts = [e.error_user_title, e.error_user_msg, details].filter(
    (p): p is string => typeof p === 'string' && p.trim().length > 0,
  );
  const unique = parts.filter((p, i) => parts.indexOf(p) === i && p !== e.message);
  const codes = [e.code, e.error_subcode].filter((c) => c != null).join('/');
  const base = e.message || `Graph API ${status}`;
  const tail = codes ? `${base} (code ${codes})` : base;
  return unique.length > 0 ? `${unique.join(': ')}. ${tail}` : tail;
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
      throw new MetaWhatsAppError(graphErrorMessage(json, res.status), res.status);
    }
    return json;
  } finally {
    clearTimeout(t);
  }
}

export type GraphComponent = Record<string, unknown>;

/** Platform WABA by default; pass `businessId` to use that business's own Cloud API credentials. */
async function requireConfig(businessId?: string | null) {
  const cfg = await getMetaWaConfig(businessId);
  if (!cfg) throw new MetaWhatsAppError('Meta WhatsApp is not configured', 503, 'META_WA_NOT_CONFIGURED');
  return cfg;
}

export async function createMessageTemplate(input: {
  businessId?: string | null;
  name: string;
  language: string;
  category: string;
  components: GraphComponent[];
}): Promise<{ id: string; status: string; category?: string }> {
  const cfg = await requireConfig(input.businessId);
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

export type GraphTemplateComponent = {
  type?: string;
  format?: string;
  text?: string;
  buttons?: Array<{ type?: string; text?: string; url?: string; phone_number?: string; otp_type?: string }>;
};

export type GraphTemplate = {
  id: string;
  name: string;
  status: string;
  language?: string;
  category?: string;
  rejected_reason?: string;
  components?: GraphTemplateComponent[];
};

export async function listMessageTemplates(businessId?: string | null): Promise<GraphTemplate[]> {
  const cfg = await requireConfig(businessId);
  const out: GraphTemplate[] = [];
  let path: string | null =
    `/${cfg.wabaId}/message_templates?fields=id,name,status,language,category,rejected_reason,components&limit=100`;
  // A WABA rarely has more than a few hundred templates; the page cap guards against loops.
  for (let page = 0; path && page < 10; page++) {
    const json = (await graphFetch(path, { token: cfg.accessToken, method: 'GET' })) as {
      data?: GraphTemplate[];
      paging?: { next?: string };
    };
    out.push(...(json.data || []));
    const next: string | undefined = json.paging?.next;
    path = next && next.startsWith(GRAPH_BASE) ? next.slice(GRAPH_BASE.length) : null;
  }
  return out;
}

export async function deleteMessageTemplate(name: string, businessId?: string | null): Promise<void> {
  const cfg = await requireConfig(businessId);
  await graphFetch(
    `/${cfg.wabaId}/message_templates?name=${encodeURIComponent(name)}`,
    { token: cfg.accessToken, method: 'DELETE' },
  );
}

export async function sendTemplateMessage(input: {
  businessId?: string | null;
  to: string;
  name: string;
  language: string;
  components?: GraphComponent[];
}): Promise<{ messageId: string }> {
  const cfg = await requireConfig(input.businessId);
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

/** WhatsApp's limit for a text message body. */
export const WA_TEXT_MAX = 4096;

/** Cloud API limits for interactive messages; Graph rejects the whole message if any is exceeded. */
export { WA_LIMITS };

export type MediaRef = { id: string; link?: never } | { link: string; id?: never };

function clip(s: string, max: number): string {
  const t = String(s ?? '').trim();
  return t.length <= max ? t : t.slice(0, max);
}

async function sendGraphMessage(
  businessId: string | null | undefined,
  to: string,
  payload: Record<string, unknown>,
): Promise<{ messageId: string }> {
  const cfg = await requireConfig(businessId);
  const json = (await graphFetch(`/${cfg.phoneNumberId}/messages`, {
    token: cfg.accessToken,
    method: 'POST',
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: to.replace(/\D/g, ''),
      ...payload,
    }),
  })) as { messages?: Array<{ id?: string }> };
  const messageId = json.messages?.[0]?.id;
  if (!messageId) throw new MetaWhatsAppError('Send returned no message id', 502);
  return { messageId };
}

export type InteractiveHeader =
  | { type: 'text'; text: string }
  | { type: 'image'; media: MediaRef }
  | { type: 'video'; media: MediaRef };

function interactiveHeader(h: InteractiveHeader | undefined): Record<string, unknown> | undefined {
  if (!h) return undefined;
  if (h.type === 'text') return { type: 'text', text: clip(h.text, WA_LIMITS.headerText) };
  return { type: h.type, [h.type]: h.media };
}

/** Reply buttons: at most 3, titles up to 20 characters; ids come back in the webhook. */
export function buildInteractiveButtonsPayload(input: {
  body: string;
  buttons: Array<{ id: string; title: string }>;
  header?: InteractiveHeader;
  footer?: string;
}): Record<string, unknown> {
  const buttons = input.buttons.slice(0, WA_LIMITS.buttonsMax).map((b) => ({
    type: 'reply',
    reply: { id: clip(b.id, WA_LIMITS.replyId), title: clip(b.title, WA_LIMITS.buttonTitle) },
  }));
  if (buttons.length === 0) throw new MetaWhatsAppError('At least one button is required', 400);
  const header = interactiveHeader(input.header);
  return {
    type: 'interactive',
    interactive: {
      type: 'button',
      ...(header ? { header } : {}),
      body: { text: clip(input.body, WA_LIMITS.interactiveBody) },
      ...(input.footer?.trim() ? { footer: { text: clip(input.footer, WA_LIMITS.interactiveFooter) } } : {}),
      action: { buttons },
    },
  };
}

/** List message: one section, up to 10 rows (titles 24, descriptions 72 characters). */
export function buildInteractiveListPayload(input: {
  body: string;
  buttonText: string;
  rows: Array<{ id: string; title: string; description?: string }>;
  headerText?: string;
  footer?: string;
  sectionTitle?: string;
}): Record<string, unknown> {
  const rows = input.rows.slice(0, WA_LIMITS.listRowsMax).map((r) => ({
    id: clip(r.id, WA_LIMITS.replyId),
    title: clip(r.title, WA_LIMITS.listRowTitle),
    ...(r.description?.trim() ? { description: clip(r.description, WA_LIMITS.listRowDescription) } : {}),
  }));
  if (rows.length === 0) throw new MetaWhatsAppError('At least one list row is required', 400);
  return {
    type: 'interactive',
    interactive: {
      type: 'list',
      ...(input.headerText?.trim() ? { header: { type: 'text', text: clip(input.headerText, WA_LIMITS.headerText) } } : {}),
      body: { text: clip(input.body, WA_LIMITS.interactiveBody) },
      ...(input.footer?.trim() ? { footer: { text: clip(input.footer, WA_LIMITS.interactiveFooter) } } : {}),
      action: {
        button: clip(input.buttonText || 'Choose', WA_LIMITS.listButton),
        sections: [{ title: clip(input.sectionTitle || 'Options', WA_LIMITS.listRowTitle), rows }],
      },
    },
  };
}

export async function sendInteractiveButtons(input: {
  businessId?: string | null;
  to: string;
  body: string;
  buttons: Array<{ id: string; title: string }>;
  header?: InteractiveHeader;
  footer?: string;
}): Promise<{ messageId: string }> {
  return sendGraphMessage(input.businessId, input.to, buildInteractiveButtonsPayload(input));
}

export async function sendInteractiveList(input: {
  businessId?: string | null;
  to: string;
  body: string;
  buttonText: string;
  rows: Array<{ id: string; title: string; description?: string }>;
  headerText?: string;
  footer?: string;
  sectionTitle?: string;
}): Promise<{ messageId: string }> {
  return sendGraphMessage(input.businessId, input.to, buildInteractiveListPayload(input));
}

/**
 * "View catalog" card for the catalog connected to the business's WABA. The thumbnail is that
 * product's image; without it WhatsApp uses the first product in the catalog.
 */
export function buildCatalogMessagePayload(input: {
  body: string;
  footer?: string;
  thumbnailRetailerId?: string | null;
}): Record<string, unknown> {
  return {
    type: 'interactive',
    interactive: {
      type: 'catalog_message',
      body: { text: clip(input.body, WA_LIMITS.interactiveBody) },
      ...(input.footer?.trim() ? { footer: { text: clip(input.footer, WA_LIMITS.interactiveFooter) } } : {}),
      action: {
        name: 'catalog_message',
        ...(input.thumbnailRetailerId ? { parameters: { thumbnail_product_retailer_id: input.thumbnailRetailerId } } : {}),
      },
    },
  };
}

export async function sendCatalogMessage(input: {
  businessId: string;
  to: string;
  body: string;
  footer?: string;
  thumbnailRetailerId?: string | null;
}): Promise<{ messageId: string }> {
  return sendGraphMessage(input.businessId, input.to, buildCatalogMessagePayload(input));
}

/** One button that opens a URL; the button label is at most 20 characters. */
export function buildCtaUrlPayload(input: {
  body: string;
  buttonText: string;
  url: string;
  footer?: string;
}): Record<string, unknown> {
  return {
    type: 'interactive',
    interactive: {
      type: 'cta_url',
      body: { text: clip(input.body, WA_LIMITS.interactiveBody) },
      ...(input.footer?.trim() ? { footer: { text: clip(input.footer, WA_LIMITS.interactiveFooter) } } : {}),
      action: {
        name: 'cta_url',
        parameters: { display_text: clip(input.buttonText, WA_LIMITS.buttonTitle), url: input.url },
      },
    },
  };
}

export async function sendCtaUrlMessage(input: {
  businessId: string;
  to: string;
  body: string;
  buttonText: string;
  url: string;
  footer?: string;
}): Promise<{ messageId: string }> {
  return sendGraphMessage(input.businessId, input.to, buildCtaUrlPayload(input));
}

export type CatalogBatchRequest =
  | { method: 'UPDATE'; data: Record<string, unknown> & { id: string } }
  | { method: 'DELETE'; data: { id: string } };

export type CatalogBatchResult = {
  handles: string[];
  /** Per-product problems Meta found up front; those products were not applied. */
  errors: Array<{ retailerId: string; message: string }>;
};

/** Upserts or deletes products (by content id) in a Meta catalog; Meta applies the batch asynchronously. */
export async function catalogItemsBatch(input: {
  businessId: string;
  catalogId: string;
  requests: CatalogBatchRequest[];
}): Promise<CatalogBatchResult> {
  const cfg = await requireConfig(input.businessId);
  const json = (await graphFetch(`/${encodeURIComponent(input.catalogId)}/items_batch`, {
    token: cfg.accessToken,
    method: 'POST',
    body: JSON.stringify({ item_type: 'PRODUCT_ITEM', allow_upsert: true, requests: input.requests }),
  })) as {
    handles?: string[];
    validation_status?: Array<{ retailer_id?: string; errors?: Array<{ message?: string }> }>;
  };
  const errors = (json.validation_status ?? [])
    .filter((v) => v.retailer_id && v.errors?.length)
    .map((v) => ({
      retailerId: String(v.retailer_id),
      message: v.errors!.map((e) => e.message).filter(Boolean).join('; ') || 'Rejected by Meta',
    }));
  return { handles: json.handles ?? [], errors };
}

/** Confirms the business's token can read the catalog; throws MetaWhatsAppError otherwise. */
export async function getCatalogInfo(input: {
  businessId: string;
  catalogId: string;
}): Promise<{ id: string; name: string | null; productCount: number | null }> {
  const cfg = await requireConfig(input.businessId);
  const json = (await graphFetch(`/${encodeURIComponent(input.catalogId)}?fields=id,name,product_count`, {
    token: cfg.accessToken,
    method: 'GET',
  })) as { id?: string; name?: string; product_count?: number };
  if (!json.id) throw new MetaWhatsAppError('Catalog not found', 404);
  return { id: json.id, name: json.name ?? null, productCount: json.product_count ?? null };
}

/**
 * Connects the catalog to the business's WABA and turns on the catalog and cart for its number.
 * Either step can already be done in WhatsApp Manager, so failures are returned, not thrown.
 */
export async function enableWhatsAppCommerce(input: {
  businessId: string;
  catalogId: string;
}): Promise<{ warnings: string[] }> {
  const cfg = await requireConfig(input.businessId);
  const warnings: string[] = [];
  try {
    await graphFetch(`/${cfg.wabaId}/product_catalogs`, {
      token: cfg.accessToken,
      method: 'POST',
      body: JSON.stringify({ catalog_id: input.catalogId }),
    });
  } catch (e) {
    warnings.push(`Could not connect the catalog to your WhatsApp account: ${e instanceof Error ? e.message : String(e)}`);
  }
  try {
    await graphFetch(`/${cfg.phoneNumberId}/whatsapp_commerce_settings?is_catalog_visible=true&is_cart_enabled=true`, {
      token: cfg.accessToken,
      method: 'POST',
    });
  } catch (e) {
    warnings.push(`Could not turn on the cart for your number: ${e instanceof Error ? e.message : String(e)}`);
  }
  return { warnings };
}

export async function sendImageMessage(input: {
  businessId?: string | null;
  to: string;
  media: MediaRef;
  caption?: string;
}): Promise<{ messageId: string }> {
  return sendGraphMessage(input.businessId, input.to, {
    type: 'image',
    image: { ...input.media, ...(input.caption?.trim() ? { caption: clip(input.caption, WA_LIMITS.caption) } : {}) },
  });
}

/** MP4 (H.264 + AAC), at most 16 MB. */
export async function sendVideoMessage(input: {
  businessId?: string | null;
  to: string;
  media: MediaRef;
  caption?: string;
}): Promise<{ messageId: string }> {
  return sendGraphMessage(input.businessId, input.to, {
    type: 'video',
    video: { ...input.media, ...(input.caption?.trim() ? { caption: clip(input.caption, WA_LIMITS.caption) } : {}) },
  });
}

/** AAC, MP4 audio, MPEG, AMR or OGG (opus); at most 16 MB. Audio takes no caption. */
export async function sendAudioMessage(input: {
  businessId?: string | null;
  to: string;
  media: MediaRef;
}): Promise<{ messageId: string }> {
  return sendGraphMessage(input.businessId, input.to, { type: 'audio', audio: { ...input.media } });
}

/** PDF or other file; WhatsApp shows `filename` to the recipient. At most 100 MB. */
export async function sendDocumentMessage(input: {
  businessId?: string | null;
  to: string;
  media: MediaRef;
  filename: string;
  caption?: string;
}): Promise<{ messageId: string }> {
  return sendGraphMessage(input.businessId, input.to, {
    type: 'document',
    document: {
      ...input.media,
      filename: clip(input.filename, 240),
      ...(input.caption?.trim() ? { caption: clip(input.caption, WA_LIMITS.caption) } : {}),
    },
  });
}

async function resolveAppId(token: string): Promise<string> {
  const fromEnv = process.env.META_WA_APP_ID?.trim();
  if (fromEnv) return fromEnv;
  const json = (await graphFetch('/app', { token, method: 'GET' })) as { id?: string };
  if (!json?.id) throw new MetaWhatsAppError('Could not find the Meta app id for this token; set META_WA_APP_ID', 502);
  return json.id;
}

/**
 * Sample media for an IMAGE/VIDEO template header goes through Meta's Resumable Upload API;
 * the returned handle is what template creation expects in `example.header_handle`.
 */
export async function uploadTemplateHeaderSample(input: {
  businessId?: string | null;
  buffer: Buffer;
  mimeType: string;
}): Promise<string> {
  const cfg = await requireConfig(input.businessId);
  const appId = await resolveAppId(cfg.accessToken);
  const session = (await graphFetch(
    `/${appId}/uploads?file_length=${input.buffer.length}&file_type=${encodeURIComponent(input.mimeType)}`,
    { token: cfg.accessToken, method: 'POST' },
  )) as { id?: string };
  if (!session?.id) throw new MetaWhatsAppError('Upload session returned no id', 502);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_MS * 4);
  try {
    const res = await fetch(`${GRAPH_BASE}/${session.id}`, {
      method: 'POST',
      headers: { Authorization: `OAuth ${cfg.accessToken}`, file_offset: '0' },
      body: new Uint8Array(input.buffer),
      signal: ctrl.signal,
    });
    const json = (await res.json().catch(() => null)) as { h?: string } | null;
    if (!res.ok || !json?.h) {
      throw new MetaWhatsAppError(graphErrorMessage(json, res.status), res.status);
    }
    return json.h;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Free-form text. Meta only delivers it inside the 24-hour window after the recipient last
 * messaged this number; outside it, use an approved template.
 */
export async function sendTextMessage(input: {
  businessId?: string | null;
  to: string;
  body: string;
  previewUrl?: boolean;
}): Promise<{ messageId: string }> {
  const cfg = await requireConfig(input.businessId);
  const to = input.to.replace(/\D/g, '');
  const json = (await graphFetch(`/${cfg.phoneNumberId}/messages`, {
    token: cfg.accessToken,
    method: 'POST',
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { body: input.body.slice(0, WA_TEXT_MAX), preview_url: input.previewUrl ?? false },
    }),
  })) as { messages?: Array<{ id?: string }> };
  const messageId = json.messages?.[0]?.id;
  if (!messageId) throw new MetaWhatsAppError('Send returned no message id', 502);
  return { messageId };
}

/** Uploads a file to the business number's media store; the id is valid for 30 days. */
export async function uploadMedia(input: {
  businessId?: string | null;
  buffer: Buffer;
  mimeType: string;
  filename: string;
  timeoutMs?: number;
}): Promise<string> {
  const cfg = await requireConfig(input.businessId);
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', input.mimeType);
  form.append('file', new Blob([new Uint8Array(input.buffer)], { type: input.mimeType }), input.filename);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), input.timeoutMs ?? FETCH_MS);
  try {
    const res = await fetch(`${GRAPH_BASE}/${cfg.phoneNumberId}/media`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.accessToken}` },
      body: form,
      signal: ctrl.signal,
    });
    const json = (await res.json().catch(() => null)) as { id?: string; error?: { message?: string } } | null;
    if (!res.ok || !json?.id) {
      throw new MetaWhatsAppError(json?.error?.message || `Media upload failed (${res.status})`, res.status);
    }
    return json.id;
  } finally {
    clearTimeout(t);
  }
}

/** Fetches a customer's media from Meta (media URLs need the token and expire after ~5 minutes). */
export async function downloadMedia(input: {
  businessId?: string | null;
  mediaId: string;
  timeoutMs?: number;
}): Promise<{ buffer: Buffer; mimeType: string }> {
  const cfg = await requireConfig(input.businessId);
  const meta = (await graphFetch(`/${encodeURIComponent(input.mediaId)}`, {
    token: cfg.accessToken,
    method: 'GET',
  })) as { url?: string; mime_type?: string };
  if (!meta?.url) throw new MetaWhatsAppError('Media lookup returned no URL', 502);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), input.timeoutMs ?? FETCH_MS * 4);
  try {
    const res = await fetch(meta.url, {
      headers: { Authorization: `Bearer ${cfg.accessToken}` },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new MetaWhatsAppError(`Media download failed (${res.status})`, res.status);
    const buffer = Buffer.from(await res.arrayBuffer());
    const mimeType = (meta.mime_type || res.headers.get('content-type') || 'application/octet-stream')
      .split(';')[0]
      .trim()
      .toLowerCase();
    return { buffer, mimeType };
  } finally {
    clearTimeout(t);
  }
}

export type SendableTemplate = {
  category: string;
  header_format: string;
  placeholder_count: number;
};

/**
 * Send-time components for a stored template. `values` fill {{1}}..{{n}} in order; AUTHENTICATION
 * templates take the code as values[0] for both the body and the copy-code button.
 */
export function buildTemplateSendComponents(
  template: SendableTemplate,
  values: string[],
  document?: { mediaId: string; filename: string },
  headerMedia?: MediaRef,
): GraphComponent[] {
  // Graph rejects parameter text containing newlines, tabs or 4+ consecutive spaces (132018).
  const text = (v: string | undefined) => ({
    type: 'text',
    text:
      String(v ?? '')
        .replace(/[\r\n\t]+/g, ' ')
        .replace(/ {4,}/g, '   ')
        .trim()
        .slice(0, 1000) || '-',
  });
  if (template.category === 'AUTHENTICATION') {
    const code = String(values[0] ?? '');
    return [
      { type: 'body', parameters: [{ type: 'text', text: code }] },
      { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: code }] },
    ];
  }
  const components: GraphComponent[] = [];
  if (template.header_format === 'document' && document) {
    components.push({
      type: 'header',
      parameters: [{ type: 'document', document: { id: document.mediaId, filename: document.filename } }],
    });
  }
  if ((template.header_format === 'image' || template.header_format === 'video') && headerMedia) {
    const kind = template.header_format;
    components.push({ type: 'header', parameters: [{ type: kind, [kind]: headerMedia }] });
  }
  if (template.placeholder_count > 0) {
    components.push({
      type: 'body',
      parameters: Array.from({ length: template.placeholder_count }, (_, i) => text(values[i])),
    });
  }
  return components;
}

export type InboundMessage = {
  /** Meta's message id (wamid…), unique per message; used to drop repeated deliveries. */
  messageId: string;
  /** Sender's number, digits only with country code. */
  from: string;
  profileName: string | null;
  /** The business number that received it. */
  phoneNumberId: string | null;
  displayPhoneNumber: string | null;
  type: string;
  /** Text, button title or list choice; null for media and other types. */
  text: string | null;
  /** Stable id of the tapped reply button, list row or template quick-reply payload. */
  replyId: string | null;
  /** Click-to-WhatsApp ad (or post) that opened this chat; only on the first message. */
  referral: InboundReferral | null;
  /** Cart the customer sent from the business's catalog (`type: 'order'`). */
  order: InboundOrder | null;
  /** Photo, video, voice note, sticker or file; download it with {@link downloadMedia}. */
  media: InboundMedia | null;
  location: InboundLocation | null;
  timestamp: number | null;
};

export type InboundMedia = {
  kind: 'image' | 'video' | 'audio' | 'document' | 'sticker';
  id: string;
  mimeType: string | null;
  filename: string | null;
};

export type InboundLocation = {
  latitude: number;
  longitude: number;
  name: string | null;
  address: string | null;
};

export type InboundOrder = {
  catalogId: string | null;
  /** Optional note the customer typed with the cart. */
  note: string | null;
  /** Prices are what WhatsApp showed the customer; never charge from them. */
  items: Array<{ retailerId: string; quantity: number; itemPrice: number | null; currency: string | null }>;
};

export type InboundReferral = {
  sourceId: string | null;
  sourceType: string | null;
  sourceUrl: string | null;
  headline: string | null;
  body: string | null;
  ctwaClid: string | null;
};

type RawInbound = {
  id?: string;
  from?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  button?: { text?: string; payload?: string };
  interactive?: {
    button_reply?: { id?: string; title?: string };
    list_reply?: { id?: string; title?: string };
  };
  image?: RawMedia;
  video?: RawMedia;
  audio?: RawMedia;
  sticker?: RawMedia;
  document?: RawMedia;
  location?: { latitude?: number | string; longitude?: number | string; name?: string; address?: string };
  contacts?: Array<{ name?: { formatted_name?: string }; phones?: Array<{ phone?: string }> }>;
  order?: {
    catalog_id?: string;
    text?: string;
    product_items?: Array<{
      product_retailer_id?: string;
      quantity?: number | string;
      item_price?: number | string;
      currency?: string;
    }>;
  };
  referral?: {
    source_id?: string;
    source_type?: string;
    source_url?: string;
    headline?: string;
    body?: string;
    ctwa_clid?: string;
  };
};

type RawMedia = { id?: string; mime_type?: string; caption?: string; filename?: string };

function inboundMedia(m: RawInbound): InboundMedia | null {
  for (const kind of ['image', 'video', 'audio', 'document', 'sticker'] as const) {
    const raw = m[kind];
    if (m.type === kind && raw?.id) {
      return { kind, id: raw.id, mimeType: raw.mime_type?.split(';')[0].trim() || null, filename: raw.filename?.trim() || null };
    }
  }
  return null;
}

function inboundLocation(m: RawInbound): InboundLocation | null {
  if (m.type !== 'location' || !m.location) return null;
  const latitude = Number(m.location.latitude);
  const longitude = Number(m.location.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return {
    latitude,
    longitude,
    name: m.location.name?.trim() || null,
    address: m.location.address?.trim() || null,
  };
}

function inboundContactsText(m: RawInbound): string | null {
  if (m.type !== 'contacts' || !m.contacts?.length) return null;
  const lines = m.contacts.map((c) => {
    const phones = (c.phones || []).map((p) => p.phone).filter(Boolean).join(', ');
    return [c.name?.formatted_name, phones].filter(Boolean).join(': ');
  });
  return lines.filter(Boolean).length ? `👤 ${lines.filter(Boolean).join('\n👤 ')}` : null;
}

function inboundReplyId(m: RawInbound): string | null {
  const id = m.interactive?.button_reply?.id ?? m.interactive?.list_reply?.id ?? m.button?.payload ?? null;
  return id && id.trim() ? id.trim() : null;
}

function inboundReferral(m: RawInbound): InboundReferral | null {
  const r = m.referral;
  if (!r) return null;
  const s = (v: string | undefined) => (v && v.trim() ? v.trim() : null);
  const out = {
    sourceId: s(r.source_id),
    sourceType: s(r.source_type),
    sourceUrl: s(r.source_url),
    headline: s(r.headline),
    body: s(r.body),
    ctwaClid: s(r.ctwa_clid),
  };
  return Object.values(out).some(Boolean) ? out : null;
}

function inboundOrder(m: RawInbound): InboundOrder | null {
  if (m.type !== 'order' || !m.order) return null;
  const items = (m.order.product_items ?? [])
    .map((p) => {
      const price = Number(p.item_price);
      return {
        retailerId: String(p.product_retailer_id ?? '').trim(),
        quantity: Math.floor(Number(p.quantity) || 0),
        itemPrice: Number.isFinite(price) ? price : null,
        currency: p.currency?.trim() || null,
      };
    })
    .filter((p) => p.retailerId && p.quantity > 0);
  if (items.length === 0) return null;
  return {
    catalogId: m.order.catalog_id?.trim() || null,
    note: m.order.text?.trim() || null,
    items,
  };
}

function inboundText(m: RawInbound): string | null {
  const t =
    m.text?.body ??
    m.button?.text ??
    m.interactive?.button_reply?.title ??
    m.interactive?.list_reply?.title ??
    m.image?.caption ??
    m.video?.caption ??
    m.document?.caption ??
    inboundContactsText(m) ??
    null;
  return t && t.trim() ? t.trim() : null;
}

/** Customer messages from a `messages` webhook (status receipts and echoes are ignored). */
export function extractInboundMessages(body: unknown): InboundMessage[] {
  const out: InboundMessage[] = [];
  const root = body as {
    object?: string;
    entry?: Array<{
      changes?: Array<{
        field?: string;
        value?: {
          metadata?: { phone_number_id?: string; display_phone_number?: string };
          contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>;
          messages?: RawInbound[];
        };
      }>;
    }>;
  };
  for (const entry of root?.entry || []) {
    for (const change of entry.changes || []) {
      if (change.field !== 'messages' || !change.value?.messages?.length) continue;
      const v = change.value;
      for (const m of v.messages || []) {
        const from = String(m.from || '').replace(/\D/g, '');
        if (!m.id || !from) continue;
        const contact = (v.contacts || []).find((c) => String(c.wa_id || '').replace(/\D/g, '') === from);
        const ts = Number(m.timestamp);
        out.push({
          messageId: m.id,
          from,
          profileName: contact?.profile?.name?.trim() || null,
          phoneNumberId: v.metadata?.phone_number_id || null,
          displayPhoneNumber: v.metadata?.display_phone_number || null,
          type: m.type || 'unknown',
          text: inboundText(m),
          replyId: inboundReplyId(m),
          referral: inboundReferral(m),
          order: inboundOrder(m),
          media: inboundMedia(m),
          location: inboundLocation(m),
          timestamp: Number.isFinite(ts) && ts > 0 ? ts : null,
        });
      }
    }
  }
  return out;
}

export type MessageStatusUpdate = {
  messageId: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  recipient: string;
  timestamp: number | null;
  errorTitle: string | null;
};

/** Delivery receipts for messages this number sent. */
export function extractMessageStatuses(body: unknown): MessageStatusUpdate[] {
  const out: MessageStatusUpdate[] = [];
  const root = body as {
    entry?: Array<{
      changes?: Array<{
        field?: string;
        value?: {
          statuses?: Array<{
            id?: string;
            status?: string;
            recipient_id?: string;
            timestamp?: string;
            errors?: Array<{ title?: string }>;
          }>;
        };
      }>;
    }>;
  };
  for (const entry of root?.entry || []) {
    for (const change of entry.changes || []) {
      if (change.field !== 'messages') continue;
      for (const s of change.value?.statuses || []) {
        const status = String(s.status || '');
        if (!s.id || !['sent', 'delivered', 'read', 'failed'].includes(status)) continue;
        const ts = Number(s.timestamp);
        out.push({
          messageId: s.id,
          status: status as MessageStatusUpdate['status'],
          recipient: String(s.recipient_id || '').replace(/\D/g, ''),
          timestamp: Number.isFinite(ts) && ts > 0 ? ts : null,
          errorTitle: s.errors?.[0]?.title?.trim() || null,
        });
      }
    }
  }
  return out;
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
  /** IMAGE/VIDEO headers need a sample handle from `uploadTemplateHeaderSample`. */
  headerFormat?: 'none' | 'text' | 'image' | 'video' | null;
  headerHandle?: string | null;
  quickReplies?: string[];
}): GraphComponent[] {
  if (input.category === 'AUTHENTICATION') {
    return [
      { type: 'BODY', add_security_recommendation: true },
      { type: 'FOOTER', code_expiration_minutes: 10 },
      { type: 'BUTTONS', buttons: [{ type: 'OTP', otp_type: 'COPY_CODE' }] },
    ];
  }

  const components: GraphComponent[] = [];
  const mediaHeader = input.headerFormat === 'image' || input.headerFormat === 'video';
  if (mediaHeader) {
    if (!input.headerHandle?.trim()) {
      throw new MetaWhatsAppError('Upload a sample image or video for the template header first', 400);
    }
    components.push({
      type: 'HEADER',
      format: input.headerFormat === 'image' ? 'IMAGE' : 'VIDEO',
      example: { header_handle: [input.headerHandle.trim()] },
    });
  } else if (input.headerText?.trim()) {
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
  const replies = (input.quickReplies || []).map((r) => r.trim()).filter(Boolean).slice(0, 10);
  if (replies.length > 0) {
    components.push({
      type: 'BUTTONS',
      buttons: replies.map((text) => ({ type: 'QUICK_REPLY', text: text.slice(0, 25) })),
    });
  }
  return components;
}

export function buildSendComponents(input: {
  category: string;
  vars: string[];
  headerFormat?: string | null;
  headerMedia?: MediaRef | null;
}): GraphComponent[] {
  const cleaned = (input.vars || []).map((v) => String(v || '').trim()).filter(Boolean);
  if (input.category === 'AUTHENTICATION') {
    const otp = cleaned[0] || '123456';
    return [
      {
        type: 'body',
        parameters: [{ type: 'text', text: otp, parameter_name: 'code' }],
      },
      {
        type: 'button',
        sub_type: 'url',
        index: '0',
        parameters: [{ type: 'text', text: otp }],
      },
    ];
  }
  const out: GraphComponent[] = [];
  if ((input.headerFormat === 'image' || input.headerFormat === 'video') && input.headerMedia) {
    const kind = input.headerFormat;
    out.push({ type: 'header', parameters: [{ type: kind, [kind]: input.headerMedia }] });
  }
  if (cleaned.length > 0) {
    out.push({
      type: 'body',
      parameters: cleaned.map((text) => ({ type: 'text', text })),
    });
  }
  return out;
}

export function verifyMetaWaWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  secretOverride?: string | null,
): boolean {
  const secret = (secretOverride ?? process.env.META_WA_APP_SECRET)?.trim();
  if (!secret) return false;
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

export function metaWaWebhookChallenge(
  searchParams: URLSearchParams,
  expectedTokenOverride?: string | null,
): string | null {
  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');
  const expected = (expectedTokenOverride ?? process.env.META_WA_VERIFY_TOKEN)?.trim();
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
