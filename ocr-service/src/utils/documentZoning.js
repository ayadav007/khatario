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
    tokens: row.tokens.slice().sort((a, b) => a.box.minX - b.box.minX),
    text: row.tokens.slice().sort((a, b) => a.box.minX - b.box.minX).map((t) => t.text).join(' ')
  }));
};

const findRowIndexByKeyword = (rows, regex) => rows.findIndex((r) => regex.test(String(r.text || '').toLowerCase()));

const findFirstRowAfter = (rows, startIndex, regex) => {
  for (let i = Math.max(0, startIndex); i < rows.length; i += 1) {
    if (regex.test(String(rows[i].text || '').toLowerCase())) return i;
  }
  return -1;
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const rowRect = (row) => {
  const xs = row.tokens.map((t) => [t.box.minX, t.box.maxX]).flat();
  const ys = row.tokens.map((t) => [t.box.minY, t.box.maxY]).flat();
  return {
    page: row.page,
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys)
  };
};

const zoneFromRowRange = (rows, startRow, endRowExclusive) => {
  const slice = rows.slice(startRow, endRowExclusive);
  if (slice.length === 0) return null;
  const rects = slice.map(rowRect);
  return {
    page: slice[0].page,
    startRow,
    endRow: endRowExclusive - 1,
    minX: Math.min(...rects.map((r) => r.minX)),
    maxX: Math.max(...rects.map((r) => r.maxX)),
    minY: Math.min(...rects.map((r) => r.minY)),
    maxY: Math.max(...rects.map((r) => r.maxY))
  };
};

export const filterBlocksByZone = (textBlocks = [], zone) => {
  if (!zone) return [];
  return textBlocks.filter((block) => {
    const box = bboxStats(block?.boundingBox);
    if (!box) return false;
    const inPage = (Number(block?.page) || 1) === zone.page;
    const inY = box.centerY >= zone.minY && box.centerY <= zone.maxY;
    return inPage && inY;
  });
};

export const detectDocumentZones = (textBlocks = []) => {
  const tokens = tokenizeBlocks(textBlocks);
  const rows = groupIntoRows(tokens);
  if (rows.length === 0) {
    return {
      zones: {},
      confidence: 0,
      anchors: {},
      debug: { reason: 'No rows found' }
    };
  }

  // Anchors (lowercase regex).
  const lineItemHeaderIdx = findRowIndexByKeyword(
    rows,
    /(description|desc|particular|goods|product|item)\b.*\b(qty|quantity|quanity|quanily|nos|units)\b/
  );

  const taxHeaderIdx = findRowIndexByKeyword(
    rows,
    /(hsn|sac)\b.*(taxable|tax)\b.*(value|amount)|taxable\b.*(value|amount)\b.*(hsn|sac)/
  );

  const footerIdx = findRowIndexByKeyword(
    rows,
    /(declaration|authorized signatory|signature|this is a computer generated|subject to .* jurisdiction)/
  );

  const totalsIdxAfterItems = lineItemHeaderIdx !== -1
    ? findFirstRowAfter(rows, lineItemHeaderIdx + 1, /(cgst|sgst|igst|subtotal|grand total|total|amount due|net amount)/)
    : -1;

  const lineItemStart = lineItemHeaderIdx !== -1 ? lineItemHeaderIdx : -1;
  const lineItemEnd = totalsIdxAfterItems !== -1
    ? totalsIdxAfterItems
    : footerIdx !== -1
      ? footerIdx
      : rows.length;

  const taxStart = taxHeaderIdx !== -1 ? taxHeaderIdx : -1;
  const taxEnd = footerIdx !== -1 ? footerIdx : rows.length;

  const vendorEnd = clamp(
    Math.min(
      lineItemStart !== -1 ? lineItemStart : rows.length,
      taxStart !== -1 ? taxStart : rows.length
    ),
    1,
    rows.length
  );

  const vendorZone = zoneFromRowRange(rows, 0, vendorEnd);
  const lineItemZone = lineItemStart !== -1 ? zoneFromRowRange(rows, lineItemStart, lineItemEnd) : null;
  const taxZone = taxStart !== -1 ? zoneFromRowRange(rows, taxStart, taxEnd) : null;
  const footerZone = footerIdx !== -1 ? zoneFromRowRange(rows, footerIdx, rows.length) : null;

  const anchorsFound = [
    lineItemHeaderIdx !== -1,
    taxHeaderIdx !== -1,
    footerIdx !== -1
  ].filter(Boolean).length;

  const confidence = Number(Math.min(1, 0.25 + anchorsFound * 0.25).toFixed(2));

  // Fallback: Y segmentation to avoid mixing metadata with tables.
  let fallback = null;
  if (confidence < 0.5) {
    const ys = rows.map((r) => r.y).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
    const y1 = ys[Math.floor(ys.length * 0.33)] ?? ys[0];
    const y2 = ys[Math.floor(ys.length * 0.66)] ?? ys[ys.length - 1];
    fallback = {
      vendorHeader: { page: rows[0].page, minY: ys[0], maxY: y1, minX: vendorZone?.minX ?? 0, maxX: vendorZone?.maxX ?? 0, confidence: 0.35 },
      lineItemTable: { page: rows[0].page, minY: y1, maxY: y2, minX: vendorZone?.minX ?? 0, maxX: vendorZone?.maxX ?? 0, confidence: 0.35 },
      footer: { page: rows[0].page, minY: y2, maxY: ys[ys.length - 1], minX: vendorZone?.minX ?? 0, maxX: vendorZone?.maxX ?? 0, confidence: 0.35 }
    };
  }

  const zones = {
    vendorHeader: vendorZone ? { ...vendorZone, confidence: lineItemHeaderIdx !== -1 || taxHeaderIdx !== -1 ? 0.6 : 0.4 } : null,
    invoiceMetadata: vendorZone ? { ...vendorZone, confidence: 0.4 } : null,
    lineItemTable: lineItemZone ? { ...lineItemZone, confidence: lineItemHeaderIdx !== -1 ? 0.75 : 0.35 } : null,
    taxSummaryTable: taxZone ? { ...taxZone, confidence: taxHeaderIdx !== -1 ? 0.75 : 0.35 } : null,
    footer: footerZone ? { ...footerZone, confidence: footerIdx !== -1 ? 0.7 : 0.35 } : null
  };

  return {
    zones,
    confidence,
    anchors: {
      lineItemHeaderIdx,
      taxHeaderIdx,
      footerIdx,
      totalsIdxAfterItems
    },
    debug: {
      fallback
    }
  };
};
