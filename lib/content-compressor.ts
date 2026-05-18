/**
 * String-level thermal invoice compaction: shorter labels, GST row merge, optional section strips.
 * Does not use a DOM parser; avoids mutating <script>/<style> and keeps table tags intact.
 */

const MAX_TEXT_RUN_LENGTH = 40;

const LABEL_REPLACEMENTS: [string, string][] = [
  ['Invoice Number', 'Inv #'],
  ['Invoice No', 'Inv #'],
  ['Grand Total', 'Total'],
  ['Total Amount', 'Total'],
  ['Description', 'Item'],
  ['Quantity', 'Qty'],
  ['Qty.', 'Qty'],
  ['Amount', 'Amt'],
];

function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#160;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Split HTML into alternating plain segments and script/style blocks (preserved verbatim). */
function splitPreservingStylesScripts(html: string): { segments: string[]; preserved: boolean[] } {
  const re = /(<(?:script|style)\b[^>]*>[\s\S]*?<\/(?:script|style)>)/gi;
  const segments: string[] = [];
  const preserved: boolean[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    if (m.index > last) {
      segments.push(html.slice(last, m.index));
      preserved.push(false);
    }
    segments.push(m[1]);
    preserved.push(true);
    last = m.index + m[1].length;
  }
  if (last < html.length) {
    segments.push(html.slice(last));
    preserved.push(false);
  }
  if (segments.length === 0) {
    segments.push(html);
    preserved.push(false);
  }
  return { segments, preserved };
}

/** Apply fn only to text between HTML tags (not inside `<...>`). */
function mapTextBetweenTags(chunk: string, fn: (text: string) => string): string {
  const parts = chunk.split(/(<[^>]+>)/);
  return parts
    .map((part) => {
      if (part.startsWith('<')) return part;
      return fn(part);
    })
    .join('');
}

function applyLabelShortening(text: string): string {
  let out = text;
  for (const [from, to] of LABEL_REPLACEMENTS) {
    const esc = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(esc, 'gi'), to);
  }
  return out;
}

/** ₹100 → ₹ 100 (text segments only). */
function normalizeRupeeSpacing(text: string): string {
  return text
    .replace(/₹\s*([\d,]+(?:\.\d+)?)/g, '₹ $1')
    .replace(/\bRs\.?\s*([\d,]+(?:\.\d+)?)/gi, 'Rs. $1');
}

function shouldTruncatePlainText(text: string): boolean {
  const t = text.trim();
  if (t.length <= MAX_TEXT_RUN_LENGTH) return false;
  const compact = t.replace(/[\s,]/g, '');
  // Keep amounts, rates, and bare numbers intact
  if (/^(?:₹|Rs\.?)?[\d,.]+$/.test(compact)) return false;
  if (/^\d+(?:\.\d+)?%?$/.test(compact)) return false;
  if (/^[\d₹$€£.,\s\-+%()]+$/.test(t) && /[\d.]/.test(t)) return false;
  return true;
}

function truncateLongTextRuns(text: string): string {
  if (!shouldTruncatePlainText(text)) return text;
  return text.slice(0, MAX_TEXT_RUN_LENGTH) + '...';
}

function transformVisibleTextChunk(chunk: string): string {
  let pass = chunk;
  pass = mapTextBetweenTags(pass, applyLabelShortening);
  pass = mapTextBetweenTags(pass, normalizeRupeeSpacing);
  pass = mapTextBetweenTags(pass, (t) => (shouldTruncatePlainText(t) ? truncateLongTextRuns(t) : t));
  return pass;
}

const GST_ROW =
  /\b(?:CGST|SGST|IGST)\b/i;

function parseGstRow(trInner: string): { rate: number; amount: number } | null {
  const t = stripTags(trInner);
  if (!GST_ROW.test(t) && !/\bGST\s*\(/i.test(t)) return null;
  const rateMatch = t.match(/(\d+(?:\.\d+)?)\s*%/);
  const amountMatch = t.match(/(?:₹|Rs\.?)\s*([\d,]+(?:\.\d{1,2})?)/i);
  if (!amountMatch) return null;
  const amount = parseFloat(amountMatch[1].replace(/,/g, ''));
  if (Number.isNaN(amount)) return null;
  const rate = rateMatch ? parseFloat(rateMatch[1]) : 0;
  return { rate: Number.isNaN(rate) ? 0 : rate, amount };
}

function formatMergedGst(totalRate: number, totalAmount: number): string {
  const rateStr =
    Math.abs(totalRate - Math.round(totalRate)) < 1e-9
      ? String(Math.round(totalRate))
      : totalRate.toFixed(2).replace(/\.?0+$/, '');
  const amtStr =
    totalAmount % 1 === 0
      ? String(Math.round(totalAmount))
      : totalAmount.toFixed(2).replace(/\.?0+$/, '');
  return `GST (${rateStr}%) ₹ ${amtStr}`;
}

/** Collapse consecutive CGST/SGST/IGST rows into one summary row inside each table. */
function collapseGstRowsInTable(tableHtml: string): string {
  const trRe = /<tr\b[^>]*>[\s\S]*?<\/tr>/gi;
  const matches = [...tableHtml.matchAll(trRe)];
  if (matches.length < 2) return tableHtml;

  const replacements: { start: number; end: number; replacement: string }[] = [];

  let i = 0;
  while (i < matches.length) {
    if (!parseGstRow(matches[i][0])) {
      i++;
      continue;
    }
    let j = i;
    let totalRate = 0;
    let totalAmount = 0;
    while (j < matches.length && parseGstRow(matches[j][0])) {
      const p = parseGstRow(matches[j][0])!;
      totalRate += p.rate;
      totalAmount += p.amount;
      j++;
    }
    const runLen = j - i;
    if (runLen >= 2) {
      const start = matches[i].index!;
      const end = matches[j - 1].index! + matches[j - 1][0].length;
      const tdCount = (matches[i][0].match(/<t[dh]\b/gi) || []).length;
      const colspan = Math.max(tdCount, 1);
      replacements.push({
        start,
        end,
        replacement: `<tr><td colspan="${colspan}">${formatMergedGst(totalRate, totalAmount)}</td></tr>`,
      });
      i = j;
      continue;
    }
    i++;
  }

  replacements.sort((a, b) => b.start - a.start);
  let out = tableHtml;
  for (const r of replacements) {
    out = out.slice(0, r.start) + r.replacement + out.slice(r.end);
  }
  return out;
}

function collapseGstRows(html: string): string {
  return html.replace(/<table\b[^>]*>[\s\S]*?<\/table>/gi, (table) => collapseGstRowsInTable(table));
}

/** Remove common boilerplate blocks by class (best-effort; flat templates work best). */
function removeLowValueSections(html: string): string {
  return html.replace(
    /<[^>]*\sclass\s*=\s*["'][^"']*\b(?:notes|terms|extra-info|extra)\b[^"']*["'][^>]*>[\s\S]*?<\/[^>\s]+>/gi,
    ''
  );
}

/**
 * Thermal-only HTML compaction: labels, GST summary row, section pruning, long text trim, ₹ spacing.
 * Safe for repeated calls; preserves script/style blocks.
 */
export function compressThermalContent(html: string): string {
  let out = html;
  try {
    out = removeLowValueSections(out);
    out = collapseGstRows(out);
    const { segments, preserved } = splitPreservingStylesScripts(out);
    out = segments
      .map((seg, idx) => (preserved[idx] ? seg : transformVisibleTextChunk(seg)))
      .join('');
  } catch {
    return html;
  }
  return out;
}
