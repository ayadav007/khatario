const REQUIRED_FIELDS = [
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

const REQUIRED_FOR_APPROVAL = [
  'vendor_name',
  'invoice_number',
  'invoice_date',
  'total'
];

const NUMERIC_FIELDS = ['subtotal', 'cgst', 'sgst', 'igst', 'total'];
const MONEY_TOLERANCE = 1;
const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

const normalizeNullableString = (value) => {
  if (value === undefined || value === null || value === '') return null;
  return String(value).trim() || null;
};

const normalizeNullableNumber = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(String(value).replace(/,/g, '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(number) ? number : value;
};

const normalizeDateString = (value) => {
  const normalized = normalizeNullableString(value);
  if (!normalized) return null;

  const isoLike = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoLike) return normalized;

  const dayFirst = normalized.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (!dayFirst) return normalized;

  const [, day, month, year] = dayFirst;
  const fullYear = year.length === 2 ? `20${year}` : year;
  return `${fullYear}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
};

const isValidIsoDate = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;

  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

const isFutureDateBeyondTolerance = (value) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  const tomorrow = new Date();
  tomorrow.setUTCHours(0, 0, 0, 0);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  return date > tomorrow;
};

const extractHsnFromDescription = (hsn, description) => {
  if (hsn) return { hsn, description };
  const desc = String(description || '').trim();
  if (!desc) return { hsn, description };
  const match = desc.match(/^(\d{4,8})(?=\s|[A-Za-z])\s*/);
  if (!match) return { hsn, description };
  return {
    hsn: match[1],
    description: desc.slice(match[0].length).trim() || desc
  };
};

const normalizeLineItem = (item) => {
  const rawHsn = normalizeNullableString(item?.hsn_code);
  const rawDesc = normalizeNullableString(item?.description);
  const { hsn, description } = extractHsnFromDescription(rawHsn, rawDesc);
  return {
    hsn_code: hsn,
    description: normalizeNullableString(description),
    quantity: normalizeNullableNumber(item?.quantity),
    unit_price: normalizeNullableNumber(item?.unit_price),
    discount: normalizeNullableNumber(item?.discount) ?? 0,
    tax_rate: normalizeNullableNumber(item?.tax_rate) ?? 0,
    amount: normalizeNullableNumber(item?.amount)
  };
};

const addIssue = (issues, field, severity, message, details = undefined) => {
  issues.push({
    field,
    severity,
    message,
    details
  });
};

const isMissing = (value) => value === null || value === undefined || value === '';

const isNumberOrNull = (value) => value === null || typeof value === 'number';

const moneyEquals = (actual, expected, tolerance = MONEY_TOLERANCE) => (
  Math.abs(Number(actual) - Number(expected)) <= tolerance
);

const validateRequiredShape = ({ source, issues }) => {
  for (const field of REQUIRED_FIELDS) {
    if (!(field in source)) {
      addIssue(issues, field, 'error', 'Required field is missing from extraction response');
    }
  }

  Object.keys(source)
    .filter((field) => !REQUIRED_FIELDS.includes(field))
    .forEach((field) => {
      addIssue(issues, field, 'warning', 'Unexpected field was ignored');
    });
};

const validateMissingApprovalFields = ({ data, issues }) => {
  for (const field of REQUIRED_FOR_APPROVAL) {
    if (isMissing(data[field])) {
      addIssue(issues, field, 'warning', 'Recommended invoice field is missing');
    }
  }

  if (!data.gst_number && (data.cgst !== null || data.sgst !== null || data.igst !== null)) {
    addIssue(issues, 'gst_number', 'warning', 'GST amounts were detected but GSTIN is missing');
  }
};

const validateGstin = ({ data, issues }) => {
  if (!data.gst_number) return;

  const gstin = data.gst_number.toUpperCase().replace(/\s/g, '');
  data.gst_number = gstin;

  if (!GSTIN_REGEX.test(gstin)) {
    addIssue(issues, 'gst_number', 'error', 'GSTIN format is invalid');
  }
};

const validateInvoiceDate = ({ data, issues }) => {
  if (!data.invoice_date) return;

  if (!isValidIsoDate(data.invoice_date)) {
    addIssue(issues, 'invoice_date', 'error', 'Invoice date must be a valid YYYY-MM-DD date');
    return;
  }

  if (isFutureDateBeyondTolerance(data.invoice_date)) {
    addIssue(issues, 'invoice_date', 'warning', 'Invoice date appears to be in the future');
  }
};

const validateNumericFields = ({ data, issues }) => {
  for (const field of NUMERIC_FIELDS) {
    if (!isNumberOrNull(data[field])) {
      addIssue(issues, field, 'error', 'Field must be a numeric value or null');
      continue;
    }

    if (typeof data[field] === 'number' && data[field] < 0) {
      addIssue(issues, field, 'error', 'Amount cannot be negative');
    }
  }

  data.line_items.forEach((item, index) => {
    ['quantity', 'unit_price', 'discount', 'tax_rate', 'amount'].forEach((field) => {
      if (!isNumberOrNull(item[field])) {
        addIssue(issues, `line_items.${index}.${field}`, 'error', 'Line item field must be numeric or null');
      }
    });

    if (!item.description && item.amount !== null) {
      addIssue(issues, `line_items.${index}.description`, 'warning', 'Line item amount is present without a description');
    }
  });
};

const validateTotals = ({ data, issues }) => {
  const numericLineItemTotal = data.line_items.reduce((sum, item) => (
    typeof item.amount === 'number' ? sum + item.amount : sum
  ), 0);

  if (
    data.line_items.length > 0
    && typeof data.subtotal === 'number'
    && numericLineItemTotal > 0
    && !moneyEquals(data.subtotal, numericLineItemTotal)
  ) {
    addIssue(issues, 'subtotal', 'warning', 'Subtotal does not match sum of line item amounts', {
      expected: Number(numericLineItemTotal.toFixed(2)),
      actual: data.subtotal
    });
  }

  const taxTotal = [data.cgst, data.sgst, data.igst].reduce((sum, value) => (
    typeof value === 'number' ? sum + value : sum
  ), 0);

  if (
    typeof data.subtotal === 'number'
    && typeof data.total === 'number'
    && !moneyEquals(data.total, data.subtotal + taxTotal)
  ) {
    addIssue(issues, 'total', 'error', 'Total does not match subtotal plus GST amounts', {
      expected: Number((data.subtotal + taxTotal).toFixed(2)),
      actual: data.total,
      subtotal: data.subtotal,
      taxTotal: Number(taxTotal.toFixed(2))
    });
  }
};

const validateTaxCalculations = ({ data, issues }) => {
  const hasCgst = typeof data.cgst === 'number' && data.cgst > 0;
  const hasSgst = typeof data.sgst === 'number' && data.sgst > 0;
  const hasIgst = typeof data.igst === 'number' && data.igst > 0;

  if ((hasCgst || hasSgst) && hasIgst) {
    addIssue(issues, 'igst', 'warning', 'Invoice has both IGST and CGST/SGST values');
  }

  if (hasCgst !== hasSgst) {
    addIssue(issues, 'cgst', 'warning', 'CGST and SGST are usually both present for intra-state invoices');
  }

  if (hasCgst && hasSgst && !moneyEquals(data.cgst, data.sgst)) {
    addIssue(issues, 'sgst', 'warning', 'CGST and SGST amounts are usually equal', {
      cgst: data.cgst,
      sgst: data.sgst
    });
  }
};

export const getInvoiceValidationStatus = ({ issues, confidence }) => {
  const hasErrors = issues.some((issue) => issue.severity === 'error');
  const hasWarnings = issues.some((issue) => issue.severity === 'warning');

  if (hasErrors || confidence < 0.35) return 'failed';
  if (hasWarnings || confidence < 0.75) return 'review_required';
  return 'valid';
};

export const validateAndNormalizeInvoiceExtraction = (data = {}) => {
  const issues = [];
  const source = data && typeof data === 'object' && !Array.isArray(data) ? data : {};

  if (source !== data) {
    addIssue(issues, 'invoice', 'error', 'Invoice extraction must be an object');
  }

  validateRequiredShape({ source, issues });

  const normalized = {
    vendor_name: normalizeNullableString(source.vendor_name),
    invoice_number: normalizeNullableString(source.invoice_number),
    gst_number: normalizeNullableString(source.gst_number),
    invoice_date: normalizeDateString(source.invoice_date),
    subtotal: normalizeNullableNumber(source.subtotal),
    cgst: normalizeNullableNumber(source.cgst),
    sgst: normalizeNullableNumber(source.sgst),
    igst: normalizeNullableNumber(source.igst),
    total: normalizeNullableNumber(source.total),
    line_items: Array.isArray(source.line_items)
      ? source.line_items.map(normalizeLineItem)
      : []
  };

  if (!Array.isArray(source.line_items)) {
    addIssue(issues, 'line_items', 'error', 'line_items must be an array');
  }

  validateMissingApprovalFields({ data: normalized, issues });
  validateGstin({ data: normalized, issues });
  validateInvoiceDate({ data: normalized, issues });
  validateNumericFields({ data: normalized, issues });
  validateTotals({ data: normalized, issues });
  validateTaxCalculations({ data: normalized, issues });

  const confidence = calculateInvoiceExtractionConfidence({
    data: normalized,
    validationIssues: issues
  });
  const status = getInvoiceValidationStatus({ issues, confidence });

  return {
    data: normalized,
    status,
    confidence,
    isValid: status === 'valid',
    issues,
    warnings: issues.filter((issue) => issue.severity === 'warning'),
    errors: issues.filter((issue) => issue.severity === 'error')
  };
};

export const calculateInvoiceExtractionConfidence = ({ data, validationIssues = [] }) => {
  const importantFields = ['vendor_name', 'invoice_number', 'invoice_date', 'total'];
  const secondaryFields = ['gst_number', 'subtotal'];
  const fieldScore = importantFields.reduce((score, field) => (
    data[field] !== null ? score + 0.16 : score
  ), 0);
  const secondaryScore = secondaryFields.reduce((score, field) => (
    data[field] !== null ? score + 0.06 : score
  ), 0);
  const taxScore = ['cgst', 'sgst', 'igst'].some((field) => data[field] !== null) ? 0.08 : 0;
  const lineItemScore = data.line_items.length > 0 ? 0.1 : 0;
  const errorPenalty = validationIssues.filter((issue) => issue.severity === 'error').length * 0.18;
  const warningPenalty = validationIssues.filter((issue) => issue.severity === 'warning').length * 0.04;
  const confidence = Math.max(0, Math.min(1, fieldScore + secondaryScore + taxScore + lineItemScore - errorPenalty - warningPenalty));

  return Number(confidence.toFixed(2));
};

export const validateGstinFormat = (gstin) => GSTIN_REGEX.test(String(gstin || '').toUpperCase().replace(/\s/g, ''));

export const REQUIRED_INVOICE_EXTRACTION_FIELDS = REQUIRED_FIELDS;
