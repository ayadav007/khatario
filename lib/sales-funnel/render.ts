import {
  sendImageMessage,
  sendInteractiveButtons,
  sendInteractiveList,
  sendTextMessage,
  sendVideoMessage,
} from '@/lib/meta-whatsapp';
import { appBaseUrl } from '@/lib/insights/format';
import { businessTypeLabel, painPointLabel } from './default-flow';
import type { FlowMessage } from './definition';
import type { FunnelLead } from './leads';
import { mediaRefForSend } from './media';

export type RenderVars = Record<string, string>;

export function siteBase(): string {
  return appBaseUrl() || 'https://khatario.com';
}

function firstWord(s: string | null | undefined): string {
  const w = String(s || '')
    .trim()
    .split(/\s+/)[0]
    ?.replace(/[^\p{L}\p{N}.'-]/gu, '');
  return w && w.length >= 2 ? w : '';
}

export function leadVars(lead: FunnelLead, extra: RenderVars = {}): RenderVars {
  const first = firstWord(lead.name) || firstWord(lead.flow_data?.profile_name);
  return {
    first_name: first || 'there',
    name_suffix: first ? ` ${first}` : '',
    owner_name: lead.name || first || 'there',
    business_name: lead.business_name || 'your business',
    business_type_label: businessTypeLabel(lead.business_type) || 'business',
    pain_point_label: painPointLabel(lead.pain_point),
    app_link: `${siteBase()}/dashboard`,
    signup_link: `${siteBase()}/signup?src=whatsapp`,
    ...extra,
  };
}

export function fillVars(text: string, vars: RenderVars): string {
  return text.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (m, key: string) => (key in vars ? vars[key] : m));
}

export function usesVar(messages: FlowMessage[], key: string): boolean {
  const re = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`);
  return messages.some((m) => {
    const texts = [
      'body' in m ? m.body : '',
      'caption' in m ? m.caption : '',
      ...(m.type === 'video' ? (m.fallback || []).map((f) => `${f.body || ''} ${f.caption || ''}`) : []),
    ];
    return texts.some((t) => t && re.test(t));
  });
}

export type SentMessage = { messageId: string | null; summary: string };

/** Sends one flow message; media that is not uploaded yet falls back (video) or is skipped (image). */
export async function sendFlowMessage(to: string, msg: FlowMessage, vars: RenderVars): Promise<SentMessage[]> {
  const fill = (t: string | undefined) => (t ? fillVars(t, vars) : '');
  switch (msg.type) {
    case 'text': {
      const body = fill(msg.body);
      const { messageId } = await sendTextMessage({ to, body, previewUrl: /https?:\/\//.test(body) });
      return [{ messageId, summary: body }];
    }
    case 'buttons': {
      const body = fill(msg.body);
      const media = msg.headerMediaKey ? await mediaRefForSend(msg.headerMediaKey).catch(() => null) : null;
      const header = media ? { type: 'image' as const, media } : msg.headerText ? { type: 'text' as const, text: fill(msg.headerText) } : undefined;
      const { messageId } = await sendInteractiveButtons({
        to,
        body,
        header,
        footer: fill(msg.footer) || undefined,
        buttons: msg.options.map((o) => ({ id: o.id, title: fill(o.title) })),
      });
      return [{ messageId, summary: `${body}\n[${msg.options.map((o) => o.title).join(' | ')}]` }];
    }
    case 'list': {
      const body = fill(msg.body);
      const { messageId } = await sendInteractiveList({
        to,
        body,
        buttonText: fill(msg.buttonText),
        headerText: fill(msg.headerText) || undefined,
        footer: fill(msg.footer) || undefined,
        rows: msg.options.map((o) => ({ id: o.id, title: fill(o.title), description: fill(o.description) || undefined })),
      });
      return [{ messageId, summary: `${body}\n[${msg.options.map((o) => o.title).join(' | ')}]` }];
    }
    case 'image': {
      const media = await mediaRefForSend(msg.mediaKey).catch((err) => {
        console.warn('[sales-funnel] image unavailable', msg.mediaKey, err instanceof Error ? err.message : err);
        return null;
      });
      if (!media) return [];
      const caption = fill(msg.caption);
      const { messageId } = await sendImageMessage({ to, media, caption });
      return [{ messageId, summary: `[image ${msg.mediaKey}] ${caption}`.trim() }];
    }
    case 'video': {
      const media = await mediaRefForSend(msg.mediaKey).catch((err) => {
        console.warn('[sales-funnel] video unavailable', msg.mediaKey, err instanceof Error ? err.message : err);
        return null;
      });
      if (media) {
        const caption = fill(msg.caption);
        const { messageId } = await sendVideoMessage({ to, media, caption });
        return [{ messageId, summary: `[video ${msg.mediaKey}] ${caption}`.trim() }];
      }
      const out: SentMessage[] = [];
      for (const f of msg.fallback || []) {
        if (f.type === 'image' && f.mediaKey) {
          out.push(...(await sendFlowMessage(to, { type: 'image', mediaKey: f.mediaKey, caption: f.caption }, vars)));
        } else if (f.type === 'text' && f.body?.trim()) {
          out.push(...(await sendFlowMessage(to, { type: 'text', body: f.body }, vars)));
        }
      }
      if (out.length === 0 && msg.caption?.trim()) {
        out.push(...(await sendFlowMessage(to, { type: 'text', body: msg.caption }, vars)));
      }
      return out;
    }
    default:
      return [];
  }
}
