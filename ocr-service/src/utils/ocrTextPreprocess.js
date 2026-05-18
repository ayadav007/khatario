const normalizeNewlines = (value) => value.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

const normalizeLineForDedupe = (value) => value
  .toLowerCase()
  .replace(/\d{1,3}[,.\s]\d{3}[,.\s]\d{3}\b/g, '<num>') // large numbers
  .replace(/\b\d{1,4}([/.-]\d{1,2}([/.-]\d{2,4})?)\b/g, '<date>')
  .replace(/\b\d+\b/g, '<n>')
  .replace(/[^\w\s]/g, '')
  .replace(/\s+/g, ' ')
  .trim();

const removeDuplicateBlocks = (lines) => {
  // Remove repeated lines and repeated short blocks that often appear due to OCR duplication.
  const seen = new Set();
  const out = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      out.push('');
      continue;
    }
    const key = normalizeLineForDedupe(trimmed);
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    out.push(trimmed);
  }
  return out;
};

const stripCommonOcrArtifacts = (value) => {
  // Remove common non-informational glyph runs while preserving invoice structure.
  return value
    .replace(/[|¦·•●■◆]+/g, ' ')
    .replace(/[""]/g, '"')
    .replace(/['']/g, "'")
    .replace(/\u00A0/g, ' ');
};

const normalizeWhitespace = (value) => value
  .replace(/[ \t]+/g, ' ')
  .replace(/ *\n */g, '\n')
  .trim();

const collapseExcessBlankLines = (value) => value
  .replace(/\n{4,}/g, '\n\n\n')
  .replace(/\n{3,}/g, '\n\n');

const removeBoilerplateSections = (lines) => {
  const dropLine = (line) => {
    const upper = line.trim().toUpperCase();
    if (!upper) return false;

    // Footers / signatures / legal boilerplate / declarations.
    if (/(AUTHORIZED SIGNATORY|SIGNATURE|E\.?&?O\.?E\.?|THIS IS A COMPUTER GENERATED|COMPUTER GENERATED INVOICE)/.test(upper)) return true;
    if (/(SUBJECT TO .* JURISDICTION|ALL DISPUTES|TERMS\s*&?\s*CONDITIONS|CONDITIONS APPLY|PAYMENT TERMS)/.test(upper)) return true;
    if (/(DECLARATION|WE DECLARE|I\/WE DECLARE)/.test(upper)) return true;
    if (/(THANK YOU|VISIT AGAIN|FOR .*? LTD|FOR .*? PVT|FOR .*? PRIVATE)/.test(upper) && upper.length < 60) return true;

    // Amount in words lines.
    if (/(AMOUNT\s+IN\s+WORDS|RUPEES\s+IN\s+WORDS|TOTAL\s+IN\s+WORDS)/.test(upper)) return true;
    if (/(ONLY)\s*$/.test(upper) && /(RUPEES|INR)/.test(upper)) return true;

    // Generic support/footer noise.
    if (/(CUSTOMER CARE|HELPLINE|TOLL FREE|WWW\.|HTTP|EMAIL|GST HELPLINE)/.test(upper) && upper.length < 80) return true;

    return false;
  };

  return lines.filter((line) => !dropLine(line));
};

const fixBrokenGstin = (value) => {
  // GSTIN is 15 chars: 2 digits + 10 alnum + 1 alnum + 1 alnum + 1 alnum
  // OCR often inserts spaces: "22 AAAAA 0000 A 1 Z 5"
  const pattern = /\b(\d{2})\s*([A-Z]{5})\s*(\d{4})\s*([A-Z])\s*([A-Z0-9])\s*([Zz])\s*([A-Z0-9])\b/g;
  return value.replace(pattern, (_m, a, b, c, d, e, f, g) => `${a}${b}${c}${d}${e}${String(f).toUpperCase()}${g}`);
};

const isSectionHeader = (line) => {
  const upper = line.trim().toUpperCase();
  return (
    /^INVOICE\b/.test(upper)
    || /^TAX\s+INVOICE\b/.test(upper)
    || /\b(BILL TO|SHIP TO)\b/.test(upper)
    || /\b(GSTIN|GST NO|GST NUMBER)\b/.test(upper)
    || /\b(HSN|SAC)\b/.test(upper)
    || /\b(SUBTOTAL|TOTAL|GRAND TOTAL|AMOUNT DUE)\b/.test(upper)
    || /\b(ITEM|DESCRIPTION|QTY|RATE|AMOUNT)\b/.test(upper)
  );
};

const looksLikeContinuation = (line) => {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (isSectionHeader(trimmed)) return false;
  if (/[:|]/.test(trimmed)) return false; // key/value delimiter -> keep as separate line
  if (/^\d+[\])\-.]/.test(trimmed)) return false; // enumerated list
  if (/^\d{1,3}\s*(x|×)\s*\d/.test(trimmed)) return false;
  if (/^\d+(\.\d+)?$/.test(trimmed)) return false;
  return trimmed.length <= 42;
};

const compactLines = (lines) => {
  const out = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      out.push('');
      continue;
    }

    const prevIndex = out.length - 1;
    const prev = prevIndex >= 0 ? out[prevIndex] : '';

    if (prev && !isSectionHeader(prev) && looksLikeContinuation(trimmed) && prev.length < 120) {
      out[prevIndex] = `${prev} ${trimmed}`.replace(/\s{2,}/g, ' ').trim();
      continue;
    }

    out.push(trimmed);
  }

  // Reduce multiple blank lines again after merges.
  return out.join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

const compactTableLikeLines = (lines) => {
  // If OCR emits tables as multiple tokens per line or many spaces, compress them.
  return lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return '';
    // Convert multi-space separation into " | " to preserve columns with fewer tokens.
    if (/\s{3,}/.test(trimmed) && /\d/.test(trimmed)) {
      return trimmed
        .replace(/\s{3,}/g, ' | ')
        .replace(/\s+\|\s+/g, ' | ')
        .trim();
    }
    return trimmed;
  });
};

const isRelevantLine = (line) => {
  const upper = line.toUpperCase();
  if (!upper.trim()) return false;

  // Strong keywords.
  if (/(GSTIN|GST NO|GST NUMBER|CGST|SGST|IGST|HSN|SAC)/.test(upper)) return true;
  if (/(INVOICE\s*(NO|NUMBER)|BILL\s*NO|TAX\s*INVOICE)/.test(upper)) return true;
  if (/(DATE|DUE DATE|INVOICE DATE)/.test(upper)) return true;
  if (/(TOTAL|GRAND TOTAL|SUBTOTAL|AMOUNT DUE|NET AMOUNT|ROUND OFF)/.test(upper)) return true;
  if (/(BILL TO|SHIP TO|CUSTOMER|BUYER|CONSIGNEE)/.test(upper)) return true;
  if (/(QTY|QUANTITY|RATE|PRICE|AMOUNT|DESCRIPTION|ITEM)/.test(upper)) return true;

  // Numeric-heavy lines likely line items/totals.
  const digitCount = (line.match(/\d/g) || []).length;
  if (digitCount >= 6 && /[A-Z]/i.test(line) && line.length <= 160) return true;

  return false;
};

const relevanceFilter = (lines) => {
  const out = [];
  let keepWindow = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const relevant = isRelevantLine(trimmed);
    if (relevant) {
      keepWindow = 2; // keep a little context after relevant lines
      out.push(trimmed);
      continue;
    }

    if (keepWindow > 0) {
      out.push(trimmed);
      keepWindow -= 1;
    }
  }
  return out;
};

export const cleanOcrText = (rawText) => {
  if (typeof rawText !== 'string') return '';
  let value = normalizeNewlines(rawText);
  value = stripCommonOcrArtifacts(value);
  value = fixBrokenGstin(value);
  value = collapseExcessBlankLines(value);
  value = normalizeWhitespace(value);
  return value;
};

export const compactOcrText = (cleanedText, options = {}) => {
  if (typeof cleanedText !== 'string') return '';
  const compactMode = Boolean(options.compactMode);
  const normalized = normalizeNewlines(cleanedText);
  let lines = normalized.split('\n');

  if (compactMode) {
    lines = removeDuplicateBlocks(lines);
    lines = removeBoilerplateSections(lines);
    lines = compactTableLikeLines(lines);
    lines = relevanceFilter(lines);
  }

  const compacted = compactLines(lines);

  // Final whitespace normalization while preserving newlines.
  return compacted
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .trim();
};

export const preprocessOcrText = (rawText, options = {}) => {
  const raw = typeof rawText === 'string' ? rawText : '';
  const cleaned = cleanOcrText(raw);
  const compacted = compactOcrText(cleaned, options);
  return { raw, cleaned, compacted };
};
