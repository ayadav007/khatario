import { env } from '../../config/env.js';
import {
  calculateInvoiceExtractionConfidence,
  validateAndNormalizeInvoiceExtraction
} from '../../utils/invoiceExtractionValidator.js';
import { logger } from '../../utils/logger.js';

const GSTIN_RE = /\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]/;

const parseMoneyString = (value) => {
  if (value === null || value === undefined) return null;
  const cleaned = String(value).replace(/,/g, '').replace(/[^\d.-]/g, '').trim();
  if (!cleaned) return null;
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
};

const extractGstin = (text) => {
  const matches = [];
  const re = new RegExp(GSTIN_RE.source, 'g');
  let m;
  while ((m = re.exec(text)) !== null) matches.push(m[0]);
  return matches.length > 0 ? matches[0] : null;
};

const HEADER_SKIP_RE = /^(tax\s*invoice|invoice[- ]*cum[- ]*bill|bill\s*of\s*supply|original|duplicate|proforma|delivery\s*challan|credit\s*note|debit\s*note)/i;

const extractVendorName = (text) => {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);

  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 15); i -= 1) {
    const forMatch = lines[i].match(/^\s*for\s+(.{3,60})\s*$/i);
    if (forMatch) {
      const name = forMatch[1].trim();
      if (!/declaration|signatory|authorized/i.test(name)) return name;
    }
  }

  for (let i = 0; i < Math.min(lines.length, 25); i += 1) {
    if (/gstin|gst\s*(?:no|number|in)|uin/i.test(lines[i])) {
      for (let j = Math.max(0, i - 3); j < i; j += 1) {
        const candidate = lines[j].replace(/[|:]/g, ' ').replace(/\s+/g, ' ').trim();
        if (
          candidate.length >= 3
          && candidate.length <= 80
          && !HEADER_SKIP_RE.test(candidate)
          && !/^\d+$/.test(candidate)
          && !/gstin|gst\s*no|pan|fssai|udyam|email|phone|mob|tel|fax|address/i.test(candidate)
          && !/invoice|bill|receipt|date|note|reference|dispatch/i.test(candidate)
          && !/^(dated?|buyer|seller|ship|state|code|place)/i.test(candidate)
        ) {
          return candidate;
        }
      }
    }
  }

  for (let i = 0; i < Math.min(lines.length, 12); i += 1) {
    const line = lines[i].replace(/[|:]/g, ' ').replace(/\s+/g, ' ').trim();
    if (HEADER_SKIP_RE.test(line)) continue;
    if (/^(dated?|invoice\s*no|bill\s*no|receipt|delivery|reference|dispatch|other|pan|fssai|udyam|gstin|uin|state|code|email|phone|mob|tel|fax)/i.test(line)) continue;
    if (/^\d[\d\-\/]+$/.test(line)) continue;
    if (line.length < 3 || line.length > 80) continue;
    const upperRatio = (line.match(/[A-Z]/g) || []).length / Math.max(line.replace(/\s/g, '').length, 1);
    if (upperRatio > 0.5 || /\b(?:pvt|ltd|llp|inc|corp|foods|store|mart|enterprises|traders|agencies|industries|solutions)\b/i.test(line)) {
      return line;
    }
  }

  return null;
};

const extractInvoiceNumber = (text) => {
  const lines = text.split('\n');

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const match = line.match(/(?:invoice\s*(?:no\.?|number|#)|bill\s*(?:no\.?|number|#)|inv\s*(?:no\.?|#)|receipt\s*(?:no\.?|#))\s*[:\-]?\s*([A-Z0-9][\w\-\/]{2,30})/i);
    if (match) {
      const val = match[1].trim();
      if (/\d/.test(val)) return val;
    }
  }

  for (let i = 0; i < lines.length; i += 1) {
    if (/^\s*(?:invoice\s*(?:no\.?|number|#)|bill\s*(?:no\.?|number|#))\s*[:\-.]?\s*$/i.test(lines[i])) {
      for (let j = i + 1; j < Math.min(i + 4, lines.length); j += 1) {
        const nextLine = lines[j].trim();
        if (!nextLine) continue;
        const candidates = nextLine.split(/\s+/);
        for (const candidate of candidates) {
          if (/\d/.test(candidate) && candidate.length >= 3 && /^[A-Z0-9][\w\-\/]{2,30}$/i.test(candidate)) {
            return candidate;
          }
        }
      }
    }
  }

  return null;
};

const DATE_VALUE_RE = /(\d{1,2}[\/-]\s*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[\/-]\s*\d{2,4}|\d{1,2}[\/.]\d{1,2}[\/.]\d{2,4}|\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}|\d{4}[\/-]\d{1,2}[\/-]\d{1,2})/i;

const extractInvoiceDate = (text) => {
  const lines = text.split('\n');

  for (const line of lines) {
    const kwMatch = line.match(/(?:invoice\s*date|bill\s*date|date\s*of\s*(?:issue|invoice|supply))\s*[:\-]?\s*/i);
    if (kwMatch) {
      const after = line.slice(kwMatch.index + kwMatch[0].length);
      const dateMatch = after.match(DATE_VALUE_RE);
      if (dateMatch) return dateMatch[1].replace(/\s+/g, '').trim();
    }
  }

  for (let i = 0; i < lines.length; i += 1) {
    if (/^\s*dated?\s*[:\-.]?\s*$/i.test(lines[i])) {
      for (let j = i + 1; j < Math.min(i + 5, lines.length); j += 1) {
        const lineStr = lines[j].trim();
        const dateMatch = lineStr.match(DATE_VALUE_RE);
        if (dateMatch) {
          const idx = dateMatch.index;
          if (idx > 0 && /[A-Z0-9]/i.test(lineStr[idx - 1])) continue;
          return dateMatch[1].replace(/\s+/g, '').trim();
        }
      }
    }
  }

  for (const line of lines) {
    if (/dated?\b/i.test(line)) {
      const dateMatch = line.match(DATE_VALUE_RE);
      if (dateMatch) return dateMatch[1].replace(/\s+/g, '').trim();
    }
  }

  for (let i = 0; i < Math.min(lines.length, 15); i += 1) {
    const trimmed = lines[i].trim();
    if (trimmed.length > 40) continue;
    const dateMatch = trimmed.match(DATE_VALUE_RE);
    if (dateMatch) {
      const idx = dateMatch.index;
      if (idx > 0 && /[A-Z0-9]/i.test(trimmed[idx - 1])) continue;
      return dateMatch[1].replace(/\s+/g, '').trim();
    }
  }

  return null;
};

const extractTaxFromText = (text) => {
  let cgst = null;
  let sgst = null;
  let igst = null;

  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();

    const cgstMatch = line.match(/\bCGST\s*[:\-₹]?\s*([\d,]+\.?\d+)/i);
    if (cgstMatch && cgst === null) cgst = parseMoneyString(cgstMatch[1]);

    const sgstMatch = line.match(/\bSGST\s*[:\-₹]?\s*([\d,]+\.?\d+)/i);
    if (sgstMatch && sgst === null) sgst = parseMoneyString(sgstMatch[1]);

    const igstMatch = line.match(/\bIGST\s*[:\-₹]?\s*([\d,]+\.?\d+)/i);
    if (igstMatch && igst === null) igst = parseMoneyString(igstMatch[1]);

    if (/^\s*CGST\s*[:\-]?\s*$/i.test(line) && cgst === null && i + 1 < lines.length) {
      const val = parseMoneyString(lines[i + 1].trim());
      if (val !== null) cgst = val;
    }
    if (/^\s*SGST\s*[:\-]?\s*$/i.test(line) && sgst === null && i + 1 < lines.length) {
      const val = parseMoneyString(lines[i + 1].trim());
      if (val !== null) sgst = val;
    }
    if (/^\s*IGST\s*[:\-]?\s*$/i.test(line) && igst === null && i + 1 < lines.length) {
      const val = parseMoneyString(lines[i + 1].trim());
      if (val !== null) igst = val;
    }
  }

  return { cgst, sgst, igst };
};

const extractSubtotal = (text) => {
  const patterns = [
    /(?:sub[\s-]*total|taxable\s*(?:amount|value))\s*[:\-₹\s]*?([\d,]+\.?\d+)/i,
    /(?:amount\s*before\s*tax)\s*[:\-₹\s]*?([\d,]+\.?\d+)/i
  ];
  for (const re of patterns) {
    const match = text.match(re);
    if (match) return parseMoneyString(match[1]);
  }
  return null;
};

const extractTotal = (text) => {
  const lines = text.split('\n');

  const specificKeywords = [
    /grand\s*total/i, /net\s*(?:amount|payable)/i, /amount\s*payable/i,
    /invoice\s*total/i, /bill\s*amount/i, /balance\s*due/i
  ];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    for (const kw of specificKeywords) {
      if (kw.test(line)) {
        const valMatch = line.match(new RegExp(kw.source + '\\s*[:\\-₹\\s]*?([\\d,]+\\.?\\d+)', 'i'));
        if (valMatch) return parseMoneyString(valMatch[1]);
        if (i + 1 < lines.length) {
          const nextVal = lines[i + 1].trim().match(/^([\d,]+\.?\d+)/);
          if (nextVal) return parseMoneyString(nextVal[1]);
        }
      }
    }
  }

  const specificPatterns = [
    /(?:grand\s*total|net\s*(?:amount|payable)|amount\s*payable|invoice\s*total|bill\s*amount)\s*[:\-₹\s]*?([\d,]+\.?\d+)/i
  ];
  for (const re of specificPatterns) {
    const match = text.match(re);
    if (match) return parseMoneyString(match[1]);
  }

  let lastTotal = null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();

    if (/\bTotal\b/i.test(line) && !/HSN|SAC|taxable|CGST|SGST|IGST/i.test(line)) {
      const totalMatch = line.match(/\bTotal\s*[:\-₹\s]*?([\d,]+\.?\d+)/i);
      if (totalMatch) {
        const val = parseMoneyString(totalMatch[1]);
        if (val !== null && val > 10) lastTotal = val;
      }

      if (/^\s*Total\s*[:\-]?\s*$/i.test(line) && i + 1 < lines.length) {
        const nextLine = lines[i + 1].trim();
        if (/^[\d,]+\.?\d*$/.test(nextLine)) {
          const val = parseMoneyString(nextLine);
          if (val !== null && val > 10) lastTotal = val;
        }
      }
    }
  }

  return lastTotal;
};

const HSN_PATTERN = /\b(190[5-9]\d{4}|0[7-9]\d{4,5}|1[0-2]\d{4,5}|2[0-5]\d{4,5}|7\d{5,6}|8\d{5,6}|9[0-6]\d{4,5})\b/;
const QTY_PATTERN = /\b(\d+(?:\.\d+)?)\s*(?:Nos|nos|pcs|Pcs|PCS|kg|Kg|KG|gm|Gm|GM|ltr|Ltr|LTR|ml|ML|pkt|Pkt|box|Box|set|Set|pair|Pair|mtr|Mtr|dzn|Dzn|btl|Btl)\b/;
const SERIAL_PREFIX = /^\s*(\d{1,3})\s*(?=[A-Z])/;

const cleanLineItem = (row) => {
  let desc = row.description || '';
  let hsn = row.hsn_code || null;
  let qty = parseMoneyString(row.quantity);
  const unitPrice = parseMoneyString(row.unit_price);
  const amount = parseMoneyString(row.amount);

  desc = desc.replace(SERIAL_PREFIX, '').trim();

  if (!hsn) {
    const hsnMatch = desc.match(HSN_PATTERN);
    if (hsnMatch) {
      hsn = hsnMatch[1];
      desc = desc.replace(HSN_PATTERN, '').trim();
    }
  } else {
    desc = desc.replace(new RegExp('\\b' + hsn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b'), '').trim();
  }

  if (qty === null) {
    const qtyMatch = desc.match(QTY_PATTERN);
    if (qtyMatch) {
      qty = parseMoneyString(qtyMatch[1]);
      desc = desc.replace(QTY_PATTERN, '').trim();
    }
  } else {
    desc = desc.replace(QTY_PATTERN, '').trim();
  }

  desc = desc.replace(/\b\d{8}\b/g, '').trim();
  desc = desc.replace(/\b\d+(\.\d+)?%/g, '').trim();
  desc = desc.replace(/\b\d+(\.\d+)?\s*(?:Nos|nos|pcs|Pcs|kg|Kg|ltr|Ltr|ml|ML|pkt|box|set)\b/gi, '').trim();
  desc = desc.replace(/\s+/g, ' ').trim();

  return {
    hsn_code: hsn,
    description: desc || null,
    quantity: qty,
    unit_price: unitPrice,
    amount
  };
};

const mapLineItemRows = (rows) => {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  return rows.map(cleanLineItem);
};

const aggregateTaxFromRows = (taxRows) => {
  if (!Array.isArray(taxRows) || taxRows.length === 0) return { cgst: null, sgst: null, igst: null };
  let cgst = 0;
  let sgst = 0;
  let igst = 0;
  let hasCgst = false;
  let hasSgst = false;
  let hasIgst = false;

  for (const row of taxRows) {
    const c = parseMoneyString(row.cgst);
    const s = parseMoneyString(row.sgst);
    const ig = parseMoneyString(row.igst);
    if (c !== null) { cgst += c; hasCgst = true; }
    if (s !== null) { sgst += s; hasSgst = true; }
    if (ig !== null) { igst += ig; hasIgst = true; }
  }

  return {
    cgst: hasCgst ? Number(cgst.toFixed(2)) : null,
    sgst: hasSgst ? Number(sgst.toFixed(2)) : null,
    igst: hasIgst ? Number(igst.toFixed(2)) : null
  };
};

const computeSubtotalFromItems = (lineItems) => {
  if (!lineItems.length) return null;
  const amounts = lineItems.map((item) => item.amount).filter((v) => typeof v === 'number');
  if (amounts.length === 0) return null;
  return Number(amounts.reduce((sum, v) => sum + v, 0).toFixed(2));
};

const computeTotal = (subtotal, taxes) => {
  if (typeof subtotal !== 'number') return null;
  const taxSum = [taxes.cgst, taxes.sgst, taxes.igst]
    .filter((v) => typeof v === 'number')
    .reduce((sum, v) => sum + v, 0);
  return Number((subtotal + taxSum).toFixed(2));
};

export const extractInvoiceDataWithRules = async (rawText, options = {}) => {
  const startedAt = Date.now();
  const requestId = options.requestId || null;
  const lineItemRows = options.lineItemRows || [];
  const taxRows = options.taxRows || [];
  const ocrText = options.rawOcrText || rawText || '';

  const gstin = extractGstin(ocrText);
  const invoiceNumber = extractInvoiceNumber(ocrText);
  const invoiceDate = extractInvoiceDate(ocrText);
  const vendorName = extractVendorName(ocrText);

  const lineItems = mapLineItemRows(lineItemRows);

  let taxes = aggregateTaxFromRows(taxRows);
  if (taxes.cgst === null && taxes.sgst === null && taxes.igst === null) {
    taxes = extractTaxFromText(ocrText);
  }

  let subtotal = extractSubtotal(ocrText);
  if (subtotal === null) {
    subtotal = computeSubtotalFromItems(lineItems);
  }

  let total = extractTotal(ocrText);
  if (total === null) {
    total = computeTotal(subtotal, taxes);
  }

  const data = {
    vendor_name: vendorName,
    invoice_number: invoiceNumber,
    gst_number: gstin,
    invoice_date: invoiceDate,
    subtotal,
    cgst: taxes.cgst,
    sgst: taxes.sgst,
    igst: taxes.igst,
    total,
    line_items: lineItems
  };

  const validation = validateAndNormalizeInvoiceExtraction(data);
  const confidence = validation.confidence ?? calculateInvoiceExtractionConfidence({
    data: validation.data,
    validationIssues: validation.issues
  });

  const durationMs = Date.now() - startedAt;

  if (env.debugMode) {
    logger.info({
      message: 'Rules-based extraction complete',
      provider: 'rules',
      requestId,
      durationMs,
      fieldsExtracted: {
        vendor_name: Boolean(vendorName),
        invoice_number: Boolean(invoiceNumber),
        gst_number: Boolean(gstin),
        invoice_date: Boolean(invoiceDate),
        subtotal: subtotal !== null,
        total: total !== null,
        cgst: taxes.cgst !== null,
        sgst: taxes.sgst !== null,
        igst: taxes.igst !== null,
        line_items_count: lineItems.length
      }
    });
  }

  return {
    provider: 'rules',
    model: 'regex-heuristic-v1',
    promptVersion: 'n/a',
    data: validation.data,
    confidence,
    validation: {
      status: validation.status,
      isValid: validation.isValid,
      confidence,
      issues: validation.issues,
      warnings: validation.warnings,
      errors: validation.errors
    },
    metadata: {
      attempts: 1,
      latencyMs: durationMs
    },
    debug: env.debugMode ? {
      ocrText: rawText,
      prompt: null,
      rawLlmResponse: null,
      parsedJson: data,
      parsingDiagnostics: {
        strategy: 'rules-based',
        note: 'No LLM used. Fields extracted via regex + reconstructed table data.'
      },
      regexMatches: {
        gstin: gstin || 'not found',
        invoiceNumber: invoiceNumber || 'not found',
        invoiceDate: invoiceDate || 'not found',
        vendorName: vendorName || 'not found',
        subtotal: subtotal !== null ? subtotal : 'not found',
        total: total !== null ? total : 'not found',
        cgst: taxes.cgst !== null ? taxes.cgst : 'not found',
        sgst: taxes.sgst !== null ? taxes.sgst : 'not found',
        igst: taxes.igst !== null ? taxes.igst : 'not found'
      },
      lineItemSource: `${lineItemRows.length} rows from table reconstruction`,
      taxSource: `${taxRows.length} rows from tax table parser`
    } : undefined
  };
};
