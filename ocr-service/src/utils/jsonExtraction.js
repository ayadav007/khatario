import { ApiError } from './ApiError.js';

const MAX_RETURN_CHARS = 20000;

const clampText = (value, maxChars = MAX_RETURN_CHARS) => {
  if (typeof value !== 'string') return '';
  if (value.length <= maxChars) return value;
  return value.slice(0, maxChars);
};

const stripMarkdownCodeFences = (value) => {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();

  // If the model wrapped JSON in a fenced block (``` or ```json), unwrap it.
  // We do this globally to handle "Here you go:\n```json\n...\n```".
  const withoutFences = trimmed.replace(/```(?:json)?\s*([\s\S]*?)```/gi, '$1');

  // Also handle single leading/trailing backticks without a full match (edge cases).
  return withoutFences
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
};

const normalizeQuotes = (value) => value
  .replace(/[""]/g, '"')
  .replace(/['']/g, "'")
  .replace(/\u00A0/g, ' ');

const stripInvalidPrefixSuffix = (value) => {
  const trimmed = value.trim();
  // Common wrappers like "JSON:" or "Here is the JSON:".
  return trimmed
    .replace(/^\s*(json|output|response)\s*:\s*/i, '')
    .trim();
};

const looksLikeJsonString = (value) => {
  const v = value.trim();
  return (
    (v.startsWith('"') && v.endsWith('"') && v.includes('\\{'))
    || (v.startsWith('"') && v.endsWith('"') && v.includes('\\"'))
  );
};

const unescapeJsonString = (value) => {
  // Attempt to parse as a JSON string, then return the inner value.
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === 'string' ? parsed : null;
  } catch {
    return null;
  }
};

const repairJsonLikeText = (value) => {
  if (typeof value !== 'string') return '';
  let v = value;
  v = normalizeQuotes(v);
  v = v.replace(/^\uFEFF/, '');
  v = stripInvalidPrefixSuffix(v);

  // Remove trailing commas: { "a": 1, } or [1,2,]
  v = v.replace(/,\s*([}\]])/g, '$1');

  // If response contains escaped newlines as literal sequences, keep them as-is.
  // If it contains actual CRLF artifacts, normalize.
  v = v.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  return v.trim();
};

const extractBalancedJsonObjectFromIndex = (value, start) => {
  if (start < 0 || start >= value.length) return '';

  let depth = 0;
  let inString = false;
  let isEscaped = false;

  for (let index = start; index < value.length; index += 1) {
    const char = value[index];

    if (isEscaped) {
      isEscaped = false;
      continue;
    }

    if (char === '\\') {
      isEscaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;

    if (depth === 0) {
      return value.slice(start, index + 1);
    }
  }

  return value.slice(start);
};

const safeJsonParseObject = (value) => {
  try {
    const parsed = JSON.parse(value);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
      return { ok: false, error: 'Response JSON must be an object' };
    }
    return { ok: true, value: parsed };
  } catch (error) {
    return { ok: false, error: error.message || 'Invalid JSON' };
  }
};

const extractKnownInvoiceFields = (value) => {
  if (typeof value !== 'string') return null;
  const text = value;

  const keys = [
    'vendor_name',
    'invoice_number',
    'gst_number',
    'invoice_date',
    'subtotal',
    'cgst',
    'sgst',
    'igst',
    'total',
    'line_items'
  ];

  const out = {};
  let found = 0;

  for (const key of keys) {
    // Try JSON-ish key/value fragments, tolerant to quotes and whitespace.
    // Example: vendor_name: "ABC" or "vendor_name": "ABC"
    const pattern = new RegExp(`["']?${key}["']?\\s*:\\s*([\\s\\S]*?)(?=\\n\\s*["']?(?:${keys.join('|')})["']?\\s*:|\\n\\s*\\}|\\s*\\})`, 'i');
    const match = text.match(pattern);
    if (!match?.[1]) continue;

    let rawValue = match[1].trim();
    rawValue = rawValue.replace(/^[,]+/, '').trim();
    rawValue = rawValue.replace(/[,]+$/, '').trim();

    // Try to parse the value as JSON by wrapping it.
    const candidate = `{ "${key}": ${rawValue} }`;
    const parsed = safeJsonParseObject(repairJsonLikeText(candidate));
    if (parsed.ok && parsed.value && key in parsed.value) {
      out[key] = parsed.value[key];
      found += 1;
      continue;
    }

    // Fallback: treat as a string (strip surrounding quotes).
    const stringy = rawValue.replace(/^"(.*)"$/s, '$1').replace(/^'(.*)'$/s, '$1');
    out[key] = stringy;
    found += 1;
  }

  if (found === 0) return null;
  return out;
};

const safeJsonParseAny = (value) => {
  try {
    return { ok: true, value: JSON.parse(value) };
  } catch (error) {
    return { ok: false, error: error.message || 'Invalid JSON' };
  }
};

const recursiveParseJson = (value, maxDepth = 3) => {
  let current = value;
  let depth = 0;
  while (depth < maxDepth) {
    if (typeof current !== 'string') return { ok: true, value: current, depth };
    const trimmed = current.trim();
    const parsed = safeJsonParseAny(trimmed);
    if (!parsed.ok) return { ok: false, error: parsed.error, depth };
    current = parsed.value;
    depth += 1;
  }
  return { ok: true, value: current, depth };
};

const findFirstJsonObjectCandidate = (value) => {
  const start = value.indexOf('{');
  if (start === -1) return '';
  return extractBalancedJsonObjectFromIndex(value, start).trim();
};

const findFirstValidJsonObject = (value) => {
  let index = value.indexOf('{');
  while (index !== -1) {
    const candidate = extractBalancedJsonObjectFromIndex(value, index).trim();
    if (candidate) {
      const repaired = repairJsonLikeText(candidate);
      const parsed = safeJsonParseObject(repaired);
      if (parsed.ok) {
        return {
          ok: true,
          sanitized: repaired,
          data: parsed.value,
          strategy: 'balanced-scan'
        };
      }
    }
    index = value.indexOf('{', index + 1);
  }

  return { ok: false, error: 'No valid JSON object found' };
};

export const sanitizeJsonResponse = (value) => {
  if (typeof value !== 'string') return '';
  const withoutBom = value.replace(/^\uFEFF/, '');
  const withoutFence = stripMarkdownCodeFences(withoutBom);
  const extracted = findFirstValidJsonObject(withoutFence);
  if (extracted.ok) return extracted.sanitized;

  const start = withoutFence.indexOf('{');
  if (start === -1) return withoutFence.trim();

  return extractBalancedJsonObjectFromIndex(withoutFence, start).trim();
};

export const parseJsonObjectResponse = (value, options = {}) => {
  const debug = Boolean(options.debug);
  const raw = typeof value === 'string' ? value : '';
  const withoutBom = raw.replace(/^\uFEFF/, '');
  const withoutFence = stripMarkdownCodeFences(normalizeQuotes(withoutBom));

  const diagnostics = {
    hadCodeFence: /```/i.test(raw),
    hadJsonFence: /```json/i.test(raw),
    rawLength: raw.length,
    sanitizedLength: 0,
    strategy: null,
    parseError: null,
    parseAttempts: 0,
    repairedPreview: null
  };

  const finalize = ({ data, sanitized, strategy, repairedPreview, parseAttempts }) => ({
    data,
    sanitized,
    diagnostics: debug
      ? {
        ...diagnostics,
        strategy,
        sanitizedLength: sanitized.length,
        parseAttempts,
        repairedPreview,
        rawResponse: clampText(raw)
      }
      : {
        ...diagnostics,
        strategy,
        sanitizedLength: sanitized.length,
        parseAttempts,
        repairedPreview
      }
  });

  const tryParseObject = (candidate, strategy, extra = {}) => {
    diagnostics.parseAttempts += 1;
    const repaired = repairJsonLikeText(candidate);
    const parsed = safeJsonParseObject(repaired);
    if (parsed.ok) {
      return { ok: true, result: finalize({ data: parsed.value, sanitized: repaired, strategy, repairedPreview: repaired.slice(0, 1000), parseAttempts: diagnostics.parseAttempts }) };
    }

    // Recursive strategy: if we parsed a JSON string that contains JSON, parse again.
    if (looksLikeJsonString(candidate)) {
      const inner = unescapeJsonString(candidate);
      if (typeof inner === 'string') {
        const innerCandidate = inner.trim();
        const innerParsed = safeJsonParseObject(repairJsonLikeText(innerCandidate));
        if (innerParsed.ok) {
          return { ok: true, result: finalize({ data: innerParsed.value, sanitized: innerCandidate, strategy: `${strategy}+recursive-string`, repairedPreview: innerCandidate.slice(0, 1000), parseAttempts: diagnostics.parseAttempts + 1 }) };
        }
      }
    }

    // Also handle multi-level stringified JSON: "\"{...}\""
    const rec = recursiveParseJson(candidate, 3);
    if (rec.ok && rec.value && typeof rec.value === 'object' && !Array.isArray(rec.value)) {
      const sanitized = repairJsonLikeText(JSON.stringify(rec.value));
      return { ok: true, result: finalize({ data: rec.value, sanitized, strategy: `${strategy}+recursive-parse`, repairedPreview: sanitized.slice(0, 1000), parseAttempts: diagnostics.parseAttempts + rec.depth }) };
    }

    return { ok: false, error: parsed.error, repairedPreview: repaired.slice(0, 1000), ...extra };
  };

  // Strategy 1: direct parse (whole response).
  {
    const direct = tryParseObject(withoutFence, 'direct-parse');
    if (direct.ok) return direct.result;
  }

  // Strategy 2: fenced block extraction.
  {
    const fencedMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fencedMatch?.[1]) {
      const candidate = fencedMatch[1].trim();
      const parsed = tryParseObject(candidate, 'fenced-block');
      if (parsed.ok) return parsed.result;
    }
  }

  // Strategy 3: balanced brace scan (first valid object anywhere).
  {
    const extracted = findFirstValidJsonObject(withoutFence);
    if (extracted.ok) {
      return finalize({
        data: extracted.data,
        sanitized: extracted.sanitized,
        strategy: extracted.strategy,
        repairedPreview: extracted.sanitized.slice(0, 1000),
        parseAttempts: diagnostics.parseAttempts + 1
      });
    }
  }

  // Strategy 4: first balanced candidate + repairs.
  {
    const candidate = findFirstJsonObjectCandidate(withoutFence);
    if (candidate) {
      const parsed = tryParseObject(candidate, 'balanced-first');
      if (parsed.ok) return parsed.result;
    }
  }

  // Strategy 5: sanitize + parse.
  {
    const sanitized = sanitizeJsonResponse(raw);
    const parsed = tryParseObject(sanitized, 'sanitize-then-parse');
    if (parsed.ok) return parsed.result;
    diagnostics.repairedPreview = parsed.repairedPreview;
    diagnostics.parseError = parsed.error || 'Invalid JSON';
  }

  diagnostics.strategy = 'failed';
  diagnostics.parseError = diagnostics.parseError || 'Invalid JSON';

  // Strategy 6: last-resort partial salvage (field-level extraction)
  const partial = extractKnownInvoiceFields(withoutFence);
  if (partial) {
    const sanitized = JSON.stringify(partial);
    return {
      data: partial,
      sanitized,
      diagnostics: debug
        ? { ...diagnostics, strategy: 'regex-field-salvage', rawResponse: clampText(raw) }
        : { ...diagnostics, strategy: 'regex-field-salvage' }
    };
  }

  throw new ApiError(422, 'LLM returned invalid JSON', {
    reason: diagnostics.parseError,
    responsePreview: clampText(withoutFence, 2000),
    diagnostics: debug ? { ...diagnostics, rawResponse: clampText(raw) } : diagnostics
  });
};
