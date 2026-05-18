import type { KnownLayoutProfileRecord, LayoutExtractionStrategy } from './types';

function pushLine(lines: string[], remaining: number, s: string): number {
  if (remaining <= 0) return 0;
  const t = s.trim();
  if (!t) return remaining;
  lines.push(t);
  return remaining - 1;
}

function readStringList(obj: unknown): string[] {
  if (!obj || typeof obj !== 'object') return [];
  const h = (obj as Record<string, unknown>).headers;
  if (!Array.isArray(h)) return [];
  return h.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
}

/** Compact adaptive hints (≤15 lines) for LLM grounding — no large JSON dumps. */
export function buildLayoutHints(
  profile: KnownLayoutProfileRecord | null,
  strategy: LayoutExtractionStrategy,
): string {
  let remaining = 15;
  const lines: string[] = [];

  if (strategy !== 'GENERIC') {
    remaining = pushLine(lines, remaining, `Routing: ${strategy}`);
  }

  if (!profile) {
    return lines.join('\n').slice(0, 4000);
  }

  remaining = pushLine(lines, remaining, `Profile v${profile.hintVersion}: fp ${profile.layoutFingerprint.slice(0, 12)}…`);

  const hdr = readStringList(profile.commonHeaders);
  if (hdr.length) {
    remaining = pushLine(
      lines,
      remaining,
      `Common header labels (watch table edge): ${hdr.slice(0, 6).join(', ')}`,
    );
  }

  const inv = profile.invoiceNumberAnchors;
  if (inv && typeof inv === 'object') {
    const q = (inv as Record<string, unknown>).quadrant;
    if (typeof q === 'string') {
      remaining = pushLine(lines, remaining, `Invoice number usually ${q}.`);
    }
  }

  const gst = profile.gstAnchorRegions;
  if (gst && typeof gst === 'object') {
    const band = (gst as Record<string, unknown>).vertical_band;
    if (typeof band === 'string') {
      remaining = pushLine(lines, remaining, `GST breakdown / HSN summary: ${band}.`);
    }
  }

  const tot = profile.totalsRegions;
  if (tot && typeof tot === 'object') {
    const band = (tot as Record<string, unknown>).vertical_band;
    if (typeof band === 'string') {
      remaining = pushLine(lines, remaining, `Totals / grand total band: ${band}.`);
    }
  }

  const tbl = profile.tableStructures;
  if (tbl && typeof tbl === 'object') {
    const order = (tbl as Record<string, unknown>).typical_column_order;
    if (Array.isArray(order) && order.every((x) => typeof x === 'string')) {
      remaining = pushLine(
        lines,
        remaining,
        `Line table column order hint: ${(order as string[]).slice(0, 8).join(' → ')}`,
      );
    }
    const hsnAfter = (tbl as Record<string, unknown>).hsn_after_quantity;
    if (hsnAfter === true) {
      remaining = pushLine(lines, remaining, 'HSN commonly appears after quantity column.');
    }
  }

  return lines.slice(0, 15).join('\n');
}

export function formatAdaptiveHintBlock(body: string): string {
  const t = body.trim();
  if (!t) return '';
  return `## LAYOUT_HINTS\n${t}\n`;
}
