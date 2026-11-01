/**
 * Lead source and type names, badge colours and small helpers shared by the Leads page, the lead
 * drawer, the board and the chat's deal section (lib/whatsapp/lead-sources and lib/leads/list are server-only).
 */

export const LEAD_SOURCE_LABEL: Record<string, string> = {
  ctwa_ad: 'WhatsApp ad',
  link: 'Link / QR',
  indiamart: 'IndiaMART',
  lead_api: 'Lead webhook',
  call: 'Call',
  walk_in: 'Walk-in',
  manual: 'Manual',
  direct: 'Direct',
};

export const LEAD_SOURCE_STYLE: Record<string, string> = {
  ctwa_ad: 'bg-blue-50 text-blue-700',
  link: 'bg-teal-50 text-teal-700',
  indiamart: 'bg-orange-50 text-orange-700',
  lead_api: 'bg-violet-50 text-violet-700',
  call: 'bg-sky-50 text-sky-700',
  walk_in: 'bg-lime-50 text-lime-700',
  manual: 'bg-gray-100 text-gray-700',
};

export type LeadType = 'new' | 'existing';

/** Same colours as the contact panel's "New lead" / "Existing customer" badge. */
export const LEAD_TYPE_LABEL: Record<LeadType, string> = { new: 'New', existing: 'Existing' };
export const LEAD_TYPE_STYLE: Record<LeadType, string> = {
  new: 'bg-emerald-50 text-emerald-700',
  existing: 'bg-orange-50 text-orange-700',
};

export const sourceLabel = (source: string | null | undefined) => (source ? LEAD_SOURCE_LABEL[source] || source : 'Direct');
export const sourceStyle = (source: string | null | undefined) =>
  (source && LEAD_SOURCE_STYLE[source]) || 'bg-gray-100 text-gray-600';

/** One line about where a lead came from, e.g. "WhatsApp ad · Diwali sale". */
export function describeLeadSource(source: string | null | undefined, detail?: Record<string, unknown> | null): string {
  if (!source) return 'Direct';
  const d = detail || {};
  const extra =
    source === 'ctwa_ad'
      ? (d.headline as string) || (d.ad_id ? `ad ${d.ad_id}` : '')
      : source === 'link'
        ? (d.name as string) || ''
        : (d.product as string) || (d.subject as string) || (d.name as string) || '';
  return extra ? `${sourceLabel(source)} · ${extra}` : sourceLabel(source);
}

export const TEMPERATURE_STYLE: Record<string, string> = {
  hot: 'bg-red-50 text-red-700',
  warm: 'bg-amber-50 text-amber-700',
  cold: 'bg-slate-100 text-slate-600',
};

/** Customers and leads match on the last 10 digits of the phone. */
export const phoneTail = (phone: string | null | undefined) => (phone || '').replace(/\D/g, '').slice(-10);

/** "+91 98765 10004" for a stored 919876510004; anything else as "+<digits>". */
export function formatLeadPhone(phone: string | null | undefined): string {
  const digits = (phone || '').replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) return `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`;
  return digits ? `+${digits}` : '';
}

/** fetch + JSON for the lead screens; a bare 403 gets a readable error. */
export async function leadsApi<T = any>(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data: T & { error?: string; code?: string } }> {
  const res = await fetch(url, init ? { ...init, headers: { 'Content-Type': 'application/json' } } : undefined);
  const data = await res.json().catch(() => ({}));
  if (res.status === 403 && !data.error) data.error = 'You need the WhatsApp inbox permission for this';
  return { ok: res.ok, status: res.status, data };
}
