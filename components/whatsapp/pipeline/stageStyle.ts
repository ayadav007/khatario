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

// Lead source names and colours live with the Leads page; kept under these names for existing callers.
export {
  LEAD_SOURCE_LABEL as SOURCE_LABEL,
  LEAD_SOURCE_STYLE as SOURCE_STYLE,
  describeLeadSource as describeSource,
} from '@/components/whatsapp/leads/leadLabels';
