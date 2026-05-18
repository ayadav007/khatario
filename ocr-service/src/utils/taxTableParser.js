const avg = (values) => values.reduce((sum, v) => sum + v, 0) / Math.max(values.length, 1);

const bboxStats = (boundingBox) => {
  if (!Array.isArray(boundingBox) || boundingBox.length === 0) return null;
  const xs = boundingBox.map((p) => p?.x).filter((v) => Number.isFinite(v));
  const ys = boundingBox.map((p) => p?.y).filter((v) => Number.isFinite(v));
  if (xs.length === 0 || ys.length === 0) return null;
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return {
    minX,
    maxX,
    minY,
    maxY,
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
    height: Math.max(1, maxY - minY),
    width: Math.max(1, maxX - minX)
  };
};

const tokenizeBlocks = (textBlocks = []) => textBlocks
  .map((block) => {
    const text = String(block?.text || '').trim();
    const box = bboxStats(block?.boundingBox);
    if (!text || !box) return null;
    return {
      page: Number(block?.page) || 1,
      blockIndex: Number(block?.blockIndex) || 0,
      text,
      confidence: Number.isFinite(block?.confidence) ? block.confidence : null,
      box
    };
  })
  .filter(Boolean);

const groupIntoRows = (tokens) => {
  if (tokens.length === 0) return [];
  const heights = tokens.map((t) => t.box.height).filter(Boolean);
  const medianHeight = heights.slice().sort((a, b) => a - b)[Math.floor(heights.length / 2)] || 12;
  const yTolerance = Math.max(6, medianHeight * 0.6);

  const sorted = tokens.slice().sort((a, b) => (
    a.page - b.page || a.box.centerY - b.box.centerY || a.box.minX - b.box.minX
  ));

  const rows = [];
  for (const token of sorted) {
    const last = rows[rows.length - 1];
    if (!last) {
      rows.push({ page: token.page, y: token.box.centerY, tokens: [token] });
      continue;
    }
    const samePage = last.page === token.page;
    const closeY = Math.abs(token.box.centerY - last.y) <= yTolerance;
    if (samePage && closeY) {
      last.tokens.push(token);
      last.y = avg(last.tokens.map((t) => t.box.centerY));
    } else {
      rows.push({ page: token.page, y: token.box.centerY, tokens: [token] });
    }
  }

  return rows.map((row, index) => ({
    rowIndex: index,
    page: row.page,
    y: row.y,
    confidence: (() => {
      const vals = row.tokens.map((t) => t.confidence).filter((v) => typeof v === 'number');
      return vals.length ? avg(vals) : null;
    })(),
    tokens: row.tokens.slice().sort((a, b) => a.box.minX - b.box.minX),
    text: row.tokens.slice().sort((a, b) => a.box.minX - b.box.minX).map((t) => t.text).join(' ')
  }));
};

const normalize = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9\s/]/g, '').replace(/\s+/g, ' ').trim();

const isTaxHeaderRow = (rowText) => {
  const t = normalize(rowText);
  const hasHsn = /\bhsn\b|\bsac\b|hsn\/sac/.test(t);
  const hasTaxable = /taxable\s*value|taxable/.test(t);
  const hasCgst = /\bcgst\b/.test(t);
  const hasSgst = /\bsgst\b/.test(t);
  const hasIgst = /\bigst\b/.test(t);
  return (hasHsn && hasTaxable) && (hasCgst || hasSgst || hasIgst);
};

const isStopRow = (rowText) => /(declaration|authorized signatory|signature|grand total|total)/i.test(String(rowText || ''));

const findHeaderIndex = (rows) => {
  for (let i = 0; i < rows.length; i += 1) {
    if (isTaxHeaderRow(rows[i].text)) return i;
  }
  return -1;
};

const findColumnX = (row, regex) => {
  const token = row.tokens.find((t) => regex.test(normalize(t.text)));
  return token ? token.box.centerX : null;
};

const buildBoundaries = (headerRow) => {
  const hsnX = findColumnX(headerRow, /\bhsn\b|\bsac\b|hsn\/sac/);
  const taxableX = findColumnX(headerRow, /taxable/);
  const cgstX = findColumnX(headerRow, /\bcgst\b/);
  const sgstX = findColumnX(headerRow, /\bsgst\b/);
  const igstX = findColumnX(headerRow, /\bigst\b/);
  const totalX = findColumnX(headerRow, /\btotal\b|\btax\b|\bamount\b/);

  const xs = [hsnX, taxableX, cgstX, sgstX, igstX, totalX].filter((v) => typeof v === 'number').sort((a, b) => a - b);
  if (xs.length < 2) return null;

  const boundaries = [];
  for (let i = 0; i < xs.length - 1; i += 1) boundaries.push((xs[i] + xs[i + 1]) / 2);

  return {
    anchors: { hsnX, taxableX, cgstX, sgstX, igstX, totalX },
    boundaries
  };
};

const assign = (row, boundaries) => {
  const cols = Array.from({ length: 6 }, () => []);
  for (const token of row.tokens) {
    const x = token.box.centerX;
    let idx = 0;
    while (idx < boundaries.length && x > boundaries[idx]) idx += 1;
    const colIndex = Math.min(idx, 5);
    cols[colIndex].push(token.text);
  }
  const join = (arr) => arr.join(' ').replace(/\s+/g, ' ').trim() || null;

  // Column order roughly: HSN, Taxable, CGST, SGST, IGST, Total
  return {
    hsn: join(cols[0]),
    taxable_value: join(cols[1]),
    cgst: join(cols[2]),
    sgst: join(cols[3]),
    igst: join(cols[4]),
    total_tax: join(cols[5])
  };
};

export const parseTaxSummaryTableFromBlocks = (textBlocks = []) => {
  const tokens = tokenizeBlocks(textBlocks);
  const rows = groupIntoRows(tokens);
  const headerIndex = findHeaderIndex(rows);
  if (headerIndex === -1) {
    return {
      found: false,
      reason: 'Tax header row not found',
      headerIndex: -1,
      rows,
      taxRows: []
    };
  }

  const headerRow = rows[headerIndex];
  const columns = buildBoundaries(headerRow);
  if (!columns) {
    return {
      found: false,
      reason: 'Unable to infer tax table columns',
      headerIndex,
      rows,
      taxRows: []
    };
  }

  const taxRows = [];
  for (let i = headerIndex + 1; i < rows.length; i += 1) {
    const row = rows[i];
    if (isStopRow(row.text)) break;
    if (!/\d/.test(row.text)) continue;
    const assigned = assign(row, columns.boundaries);
    const hasHsnOrTaxable = Boolean(assigned.hsn || assigned.taxable_value);
    if (!hasHsnOrTaxable) continue;
    taxRows.push({
      ...assigned,
      rowIndex: row.rowIndex,
      page: row.page,
      confidence: row.confidence,
      rawText: row.text
    });
  }

  return {
    found: true,
    reason: null,
    headerIndex,
    columns,
    rows,
    taxRows
  };
};
