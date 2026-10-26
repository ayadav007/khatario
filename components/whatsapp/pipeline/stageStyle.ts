import type { StageColor, StageKind } from '@/lib/whatsapp/pipeline';

export type StageOption = { id: string; name: string; color: StageColor; kind: StageKind; position: number };

export const STAGE_DOT: Record<StageColor, string> = {
  slate: 'bg-slate-400',
  blue: 'bg-blue-500',
  teal: 'bg-teal-500',
  green: 'bg-emerald-500',
  amber: 'bg-amber-500',
  orange: 'bg-orange-500',
  red: 'bg-red-500',
  pink: 'bg-pink-500',
  violet: 'bg-violet-500',
};

export const STAGE_COLOR_LABEL: Record<StageColor, string> = {
  slate: 'Grey',
  blue: 'Blue',
  teal: 'Teal',
  green: 'Green',
  amber: 'Amber',
  orange: 'Orange',
  red: 'Red',
  pink: 'Pink',
  violet: 'Violet',
};

export const STAGE_KIND_LABEL: Record<StageKind, string> = {
  open: 'Open',
  won: 'Won',
  lost: 'Lost',
};

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

export function formatDealValue(n: number | null | undefined): string {
  return n === null || n === undefined ? '' : inr.format(n);
}

/** Client copy of the lead source names (lib/whatsapp/lead-sources is server-only). */
export const SOURCE_LABEL: Record<string, string> = {
  ctwa_ad: 'WhatsApp ad',
  link: 'Link / QR',
  indiamart: 'IndiaMART',
  lead_api: 'Lead webhook',
  direct: 'Direct',
};

export const SOURCE_STYLE: Record<string, string> = {
  ctwa_ad: 'bg-blue-50 text-blue-700',
  link: 'bg-teal-50 text-teal-700',
  indiamart: 'bg-orange-50 text-orange-700',
  lead_api: 'bg-violet-50 text-violet-700',
};

/** One line about where a lead came from, e.g. "WhatsApp ad · Diwali sale". */
export function describeSource(source: string | null | undefined, detail?: Record<string, unknown> | null): string {
  if (!source) return 'Direct';
  const d = detail || {};
  const extra =
    source === 'ctwa_ad'
      ? (d.headline as string) || (d.ad_id ? `ad ${d.ad_id}` : '')
      : source === 'link'
        ? (d.name as string) || ''
        : (d.product as string) || (d.subject as string) || (d.name as string) || '';
  return extra ? `${SOURCE_LABEL[source] || source} · ${extra}` : SOURCE_LABEL[source] || source;
}
