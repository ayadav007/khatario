import schedule from '@/data/gst-rate-schedule.json';

export interface GstRateMatch {
  gst_rate: number;
  schedule: string;
  description: string;
}

interface RateEntry {
  schedule: string;
  gst_rate: number;
  codes: string[];
  except: string[];
  description: string;
}

const entries = schedule.entries as RateEntry[];

/**
 * Combined GST rate (CGST + SGST, or IGST) from Notification 9/2025-Central Tax (Rate).
 * Keeps only the longest matching heading. Two entries of that length are both returned.
 * SAC codes are not in this notification.
 */
export function gstRatesForCode(code: string | null | undefined): GstRateMatch[] {
  const normalized = String(code ?? '').replace(/\s/g, '');
  if (!/^\d{2,8}$/.test(normalized) || normalized.startsWith('99')) return [];

  const matches: { length: number; match: GstRateMatch }[] = [];
  for (const entry of entries) {
    const prefix = entry.codes.find((candidate) => normalized.startsWith(candidate));
    if (!prefix) continue;
    if (entry.except.some((excluded) => normalized.startsWith(excluded))) continue;
    matches.push({
      length: prefix.length,
      match: {
        gst_rate: entry.gst_rate,
        schedule: entry.schedule,
        description: entry.description,
      },
    });
  }

  if (matches.length === 0) return [];
  const longest = Math.max(...matches.map((match) => match.length));
  const seen = new Set<string>();
  return matches
    .filter((match) => match.length === longest)
    .map((match) => match.match)
    .filter((match) => {
      const key = `${match.gst_rate}|${match.description}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
