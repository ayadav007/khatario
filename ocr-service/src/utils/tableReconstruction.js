const avg = (values) => values.reduce((sum, v) => sum + v, 0) / Math.max(values.length, 1);

const bboxStats = (boundingBox) => {
  if (!Array.isArray(boundingBox) || boundingBox.length === 0) {
    return null;
  }
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

const normalizeToken = (value) => String(value || '').trim();

const extractHsnCode = (value) => {
  const text = String(value || '').trim();
  if (!text) return null;
  const explicit = text.match(/\bHSN(?:\/SAC)?\s*[:\-]?\s*(\d{4,8})\b/i);
  if (explicit?.[1]) return explicit[1];
  const leading = text.match(/^(\d{4,8})(?=\s|$|[A-Za-z])/);
  if (leading?.[1]) return leading[1];
  const trailing = text.match(/(?:\d{4,8})$/);
  if (trailing?.[0]) return trailing[0];
  return null;
};

const extractHsnFromRowTokens = (rowTokens = []) => {
  if (!Array.isArray(rowTokens) || rowTokens.length === 0) return null;

  // Prefer left-most HSN-like code because invoice rows are usually:
  // HSN | Description | Qty | Rate | Amount
  const sorted = rowTokens.slice().sort((a, b) => a.box.centerX - b.box.centerX);

  // Pass 1: explicit HSN/SAC mentions.
  for (const token of sorted) {
    const text = String(token?.text || '');
    const explicit = text.match(/\bHSN(?:\/SAC)?\s*[:\-]?\s*(\d{4,8})\b/i);
    if (explicit?.[1]) return explicit[1];
  }

  // Pass 2: first HSN-like numeric token near left side.
  for (const token of sorted) {
    const text = String(token?.text || '').replace(/,/g, '').trim();
    // Match standalone HSN or HSN concatenated with letters (e.g., "021320LDAL")
    const numberMatch = text.match(/(?:^|\s)(\d{4,8})(?=\s|$|[A-Za-z])/);
    if (!numberMatch?.[1]) continue;
    if (looksLikeHsnToken(numberMatch[1])) return numberMatch[1];
  }

  return null;
};

const stripHsnFromDescription = (value) => {
  const text = String(value || '').trim();
  if (!text) return null;

  // Remove HSN-like numeric codes that OCR often attaches to item names.
  // Examples: "07130 L CHANA", "19059090 R F Veg Puff", "item 19059010"
  let cleaned = text
    // Leading code(s) concatenated or separated from item name (e.g., "021320LDAL" or "021320 LDAL").
    .replace(/^(\d{4,8})\s*/g, '')
    // Trailing code(s) after item name.
    .replace(/\s+(?:\d{4,8})(?:\s+\d{4,8})*$/g, '')
    // Embedded "HSN 07130" or "HSN/SAC 19059090"
    .replace(/\bHSN(?:\/SAC)?\s*[:\-]?\s*\d{4,8}\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) cleaned = text;
  return cleaned || null;
};

const tokenizeBlocks = (textBlocks = []) => textBlocks
  .map((block) => {
    const text = normalizeToken(block?.text);
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

  return rows.map((row, index) => {
    const sortedTokens = row.tokens.slice().sort((a, b) => a.box.minX - b.box.minX);
    const rowConfidenceValues = sortedTokens.map((t) => t.confidence).filter((v) => typeof v === 'number');
    const rowConfidence = rowConfidenceValues.length ? avg(rowConfidenceValues) : null;
    return {
      rowIndex: index,
      page: row.page,
      y: row.y,
      confidence: rowConfidence,
      tokens: sortedTokens,
      text: sortedTokens.map((t) => t.text).join(' ')
    };
  });
};

const HEADER_SYNONYMS = {
  description: [
    'description',
    'desc',
    'particulars',
    'particular',
    'item',
    'goods',
    'product'
  ],
  quantity: [
    'qty',
    'quantity',
    'quanity',
    'quanily',
    'quantiiy',
    'nos',
    'no',
    'units',
    'unit'
  ],
  rate: [
    'rate',
    'unit price',
    'unitprice',
    'price',
    'per'
  ],
  amount: [
    'amount',
    'total',
    'value'
  ]
};

const normalizeText = (value) => String(value || '')
  .toLowerCase()
  .replace(/[^a-z0-9\s]/g, '')
  .replace(/\s+/g, ' ')
  .trim();

const levenshtein = (a, b) => {
  const s = a || '';
  const t = b || '';
  if (s === t) return 0;
  if (!s) return t.length;
  if (!t) return s.length;
  const m = s.length;
  const n = t.length;
  const dp = new Array(n + 1);
  for (let j = 0; j <= n; j += 1) dp[j] = j;
  for (let i = 1; i <= m; i += 1) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j += 1) {
      const temp = dp[j];
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      dp[j] = Math.min(
        dp[j] + 1, // deletion
        dp[j - 1] + 1, // insertion
        prev + cost // substitution
      );
      prev = temp;
    }
  }
  return dp[n];
};

const similarity = (a, b) => {
  const s = normalizeText(a);
  const t = normalizeText(b);
  const maxLen = Math.max(s.length, t.length);
  if (maxLen === 0) return 0;
  const dist = levenshtein(s, t);
  return 1 - dist / maxLen;
};

const joinAdjacentTokens = (tokens) => {
  const out = tokens.map((t) => normalizeText(t.text));
  for (let i = 0; i < tokens.length - 1; i += 1) {
    const a = normalizeText(tokens[i].text);
    const b = normalizeText(tokens[i + 1].text);
    if (a && b) {
      out.push(`${a} ${b}`.trim());
      out.push(`${a}${b}`.trim());
    }
  }
  return out.filter(Boolean);
};

const scoreHeaderCategory = (row, categoryKey) => {
  const candidates = joinAdjacentTokens(row.tokens);
  const synonyms = HEADER_SYNONYMS[categoryKey] || [];
  let best = 0;
  let bestMatch = null;
  let bestSynonym = null;
  for (const cand of candidates) {
    for (const syn of synonyms) {
      const score = similarity(cand, syn);
      if (score > best) {
        best = score;
        bestMatch = cand;
        bestSynonym = syn;
      }
    }
  }
  return { score: best, match: bestMatch, synonym: bestSynonym };
};

const semanticMatchCount = (scores, threshold = 0.62) => ([
  scores.description.score,
  scores.quantity.score,
  scores.rate.score,
  scores.amount.score
].filter((value) => value >= threshold).length);

const strongHeaderPhraseBoost = (rowText) => {
  const t = normalizeText(rowText);
  let boost = 0;
  if (t.includes('description of goods')) boost += 0.12;
  if (t.includes('quantity')) boost += 0.08;
  if (t.includes('rate')) boost += 0.08;
  if (t.includes('amount')) boost += 0.08;
  return boost;
};

const rowLooksLikeHeaderByHeuristics = (row, nextRows = []) => {
  // Headers usually appear above numeric-heavy rows.
  const next = nextRows.slice(0, 4);
  const numericRows = next.filter((r) => (r.text.match(/\d/g) || []).length >= 6);
  return numericRows.length >= 1;
};

const findBestHeaderRow = (rows) => {
  const candidates = [];
  const rejected = [];

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const scores = {
      description: scoreHeaderCategory(row, 'description'),
      quantity: scoreHeaderCategory(row, 'quantity'),
      rate: scoreHeaderCategory(row, 'rate'),
      amount: scoreHeaderCategory(row, 'amount')
    };

    const parts = [
      scores.description.score,
      scores.quantity.score,
      Math.max(scores.rate.score, scores.amount.score)
    ];
    const baseScore = avg(parts);
    const hasHeuristic = rowLooksLikeHeaderByHeuristics(row, rows.slice(i + 1));
    const phraseBoost = strongHeaderPhraseBoost(row.text);
    const finalScore = baseScore + (hasHeuristic ? 0.12 : 0) + phraseBoost;

    const matchCount = semanticMatchCount(scores, 0.62);
    const thresholdUsed = 0.75;

    const hasStrongSemantic = (
      scores.description.score >= 0.62
      && scores.quantity.score >= 0.62
      && scores.rate.score >= 0.62
      && scores.amount.score >= 0.62
    );

    const meetsThreshold = finalScore >= thresholdUsed;
    const accepted = hasStrongSemantic || meetsThreshold;
    const acceptedHeaderReason = hasStrongSemantic
      ? 'auto-accept: all 4 semantic columns matched'
      : meetsThreshold
        ? 'accept: finalScore >= threshold'
        : null;

    const payload = {
      rowIndex: row.rowIndex,
      page: row.page,
      text: row.text,
      confidence: row.confidence,
      scores: {
        description: scores.description,
        quantity: scores.quantity,
        rate: scores.rate,
        amount: scores.amount
      },
      baseScore: Number(baseScore.toFixed(3)),
      heuristicNumericRowsBelow: hasHeuristic,
      phraseBoost: Number(phraseBoost.toFixed(3)),
      finalScore: Number(finalScore.toFixed(3)),
      semanticMatchCount: matchCount,
      thresholdUsed,
      acceptedHeaderReason
    };

    if (accepted) {
      candidates.push(payload);
    } else {
      rejected.push({
        ...payload,
        rejectedReason: 'Below fuzzy threshold'
      });
    }
  }

  candidates.sort((a, b) => b.finalScore - a.finalScore);
  return {
    headerIndex: candidates.length ? candidates[0].rowIndex : -1,
    candidates,
    rejected
  };
};

const isTotalsRow = (rowText) => {
  const t = String(rowText || '').toLowerCase();
  return /(subtotal|sub total|grand total|total|amount due|net amount|round off|cgst|sgst|igst)/.test(t);
};

const shouldStopLineItemParsing = (rowText) => {
  const t = String(rowText || '').toLowerCase();
  return /(cgst|sgst|igst|\btotal\b|amount chargeable|declaration)/.test(t);
};

const findColumnX = (row, matcher) => {
  const token = row.tokens.find((t) => matcher(String(t.text || '').toLowerCase()));
  return token ? token.box.centerX : null;
};

const buildColumnBoundaries = (headerRow) => {
  const qtyX = findColumnX(headerRow, (t) => /\b(qty|quantity|quanity|quanily|nos|units)\b/.test(t));
  const rateX = findColumnX(headerRow, (t) => /\b(rate|price|per)\b/.test(t) || /unit\s*price/.test(t));
  const amountX = findColumnX(headerRow, (t) => /\b(amount|value|total)\b/.test(t));

  const candidates = [qtyX, rateX, amountX].filter((v) => typeof v === 'number').sort((a, b) => a - b);
  if (candidates.length === 0) return null;

  // Column boundaries are midpoints between header column anchors.
  const boundaries = [];
  for (let i = 0; i < candidates.length - 1; i += 1) {
    boundaries.push((candidates[i] + candidates[i + 1]) / 2);
  }

  return {
    anchors: { qtyX, rateX, amountX },
    boundaries
  };
};

const assignTokensToColumns = (row, boundaries) => {
  const cols = [[], [], [], []]; // description, qty, rate, amount
  for (const token of row.tokens) {
    const x = token.box.centerX;
    let index = 0;
    while (index < boundaries.length && x > boundaries[index]) index += 1;
    // index: 0..boundaries.length; map to 4 columns
    const colIndex = Math.min(index, 3);
    cols[colIndex].push(token.text);
  }

  const join = (arr) => arr.join(' ').replace(/\s+/g, ' ').trim() || null;
  const rawDescription = join(cols[0]);
  return {
    hsn_code: extractHsnCode(rawDescription),
    description: stripHsnFromDescription(rawDescription),
    quantity: join(cols[1]),
    unit_price: join(cols[2]),
    amount: join(cols[3])
  };
};

const toNumber = (value) => {
  if (value === null || value === undefined) return null;
  const cleaned = String(value)
    .replace(/,/g, '')
    .replace(/[^\d.-]/g, '')
    .trim();
  if (!cleaned) return null;
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : null;
};

const moneyClose = (a, b, tolerance = 1) => (
  typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= tolerance
);

const looksLikeHsnToken = (raw) => {
  const s = String(raw || '').replace(/,/g, '').trim();
  if (!/^\d+$/.test(s)) return false;
  const len = s.length;
  if (len >= 6 && len <= 8) return true;
  if (len === 4 && Number(s) >= 1000) return true;
  return false;
};

const stripGstPercentages = (text) => String(text || '').replace(/\b\d+(?:\.\d+)?\s*%/gi, ' ');

/** Extract money-relevant numeric candidates from OCR row tokens (excludes %, HSN-like codes). */
const extractSemanticNumericCandidates = (rowTokens) => {
  const candidates = [];
  for (const t of rowTokens) {
    const original = String(t.text || '');
    let text = stripGstPercentages(original);
    const centerX = t.box.centerX;

    const nosMatch = text.match(/(\d+)\s*Nos?/i);
    if (nosMatch) {
      const v = Number(nosMatch[1]);
      if (Number.isFinite(v) && v > 0 && v <= 100000) {
        candidates.push({
          value: v,
          raw: nosMatch[0].trim(),
          centerX,
          flags: ['quantity_nos'],
          isInteger: true,
          hasDecimal: false
        });
      }
    }

    const withoutNos = text.replace(/\d+\s*Nos?/gi, ' ');
    const numRegex = /(\d+(?:[.,]\d+)?)/g;
    let m;
    while ((m = numRegex.exec(withoutNos)) !== null) {
      const raw = m[1].replace(/,/g, '');
      if (looksLikeHsnToken(raw)) continue;
      const before = withoutNos.slice(Math.max(0, m.index - 2), m.index);
      const after = withoutNos.slice(m.index + m[0].length, m.index + m[0].length + 2);
      if (/%/.test(before + after)) continue;

      const value = Number(raw);
      if (!Number.isFinite(value) || value < 0) continue;
      const hasDecimal = /\./.test(raw) || (/,/.test(m[1]) && raw.includes('.'));
      candidates.push({
        value,
        raw: m[0].trim(),
        centerX,
        flags: [],
        isInteger: Number.isInteger(value) && !hasDecimal,
        hasDecimal: Boolean(hasDecimal || (value % 1 !== 0))
      });
    }
  }

  const deduped = [];
  const seen = new Set();
  for (const c of candidates.sort((a, b) => a.centerX - b.centerX)) {
    const key = `${c.value}|${c.centerX.toFixed(0)}|${c.raw}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(c);
  }
  return deduped;
};

const validationScoreTriple = (qty, rate, amount, tolerance = 1) => {
  if (typeof qty !== 'number' || typeof rate !== 'number' || typeof amount !== 'number') return 0;
  if (qty <= 0 || rate < 0 || amount < 0) return 0;
  const product = qty * rate;
  const err = Math.abs(product - amount);
  const denom = Math.max(Math.abs(amount), Math.abs(product), 1);
  const closeness = 1 - Math.min(1, err / denom);
  const exactBonus = moneyClose(product, amount, tolerance) ? 0.35 : 0;
  return Number((closeness * 0.65 + exactBonus).toFixed(4));
};

/**
 * Semantic qty/rate/amount from numeric candidates (OCR geometry may be wrong).
 * Tries combinations; locks when qty*rate ≈ amount.
 */
const assignSemanticNumerics = (candidates, geoRow, carryIn = null) => {
  const repairActions = [];
  const numericTokens = candidates.map((c) => ({ ...c }));

  let pool = candidates.slice();
  if (carryIn?.pendingAmount != null && Number.isFinite(carryIn.pendingAmount)) {
    pool.push({
      value: carryIn.pendingAmount,
      raw: String(carryIn.pendingAmount),
      centerX: -1,
      flags: ['carried_from_split'],
      isInteger: false,
      hasDecimal: true
    });
    repairActions.push({ type: 'carry_in_amount', value: carryIn.pendingAmount });
  }

  pool = pool.filter((c) => !looksLikeHsnToken(c.raw));

  const qtyLike = pool.filter((c) => (
    c.flags.includes('quantity_nos')
    || (c.isInteger && c.value >= 1 && c.value <= 5000 && !looksLikeHsnToken(c.raw))
  ));
  const ints = pool.filter((c) => c.isInteger && c.value >= 1 && c.value <= 50000 && !looksLikeHsnToken(c.raw));
  const decimals = pool.filter((c) => c.hasDecimal || (c.value % 1 !== 0));
  const anyMoney = pool.filter((c) => c.value > 0);

  const geoQty = toNumber(geoRow.quantity);
  const geoRate = toNumber(geoRow.unit_price);
  const geoAmt = toNumber(geoRow.amount);

  let best = {
    qty: geoQty,
    rate: geoRate,
    amount: geoAmt,
    score: 0,
    locked: false,
    classifications: {}
  };

  if (geoQty != null && geoRate != null && geoAmt != null) {
    best.score = validationScoreTriple(geoQty, geoRate, geoAmt, 1.5);
    best.locked = moneyClose(geoQty * geoRate, geoAmt, 1.5);
    best.classifications = {
      quantity: geoRow.quantity,
      unit_price: geoRow.unit_price,
      amount: geoRow.amount
    };
  }

  const tryTriple = (qty, rate, amt, source) => {
    const q = typeof qty === 'number' ? qty : null;
    const r = typeof rate === 'number' ? rate : null;
    const a = typeof amt === 'number' ? amt : null;
    if (q === null || r === null || a === null) return;
    const sc = validationScoreTriple(q, r, a, 1.5);
    const locked = moneyClose(q * r, a, 1.5);
    const beats = locked
      ? (!best.locked || sc > best.score)
      : (!best.locked && sc > best.score);
    if (beats) {
      best = {
        qty: q,
        rate: r,
        amount: a,
        score: sc,
        locked,
        classifications: { quantity: source.q, unit_price: source.r, amount: source.a }
      };
    }
  };

  const uniqValues = (arr) => {
    const out = [];
    const s = new Set();
    for (const c of arr) {
      const k = `${c.value}`;
      if (s.has(k)) continue;
      s.add(k);
      out.push(c);
    }
    return out;
  };

  let qPool = uniqValues([...qtyLike, ...ints.filter((c) => c.value <= 5000)]).slice(0, 8);
  if (qPool.length === 0) {
    qPool = uniqValues(ints.filter((c) => c.value <= 10000)).slice(0, 6);
  }

  const rPool = uniqValues([...decimals, ...anyMoney.filter((c) => c.value > 0 && c.value < 100000)]).slice(0, 10);
  const aPool = uniqValues([...anyMoney]).slice(0, 10);

  for (const qc of qPool) {
    for (const rc of rPool) {
      if (rc.value === qc.value && !rc.hasDecimal && !qc.flags.includes('quantity_nos')) continue;
      for (const ac of aPool) {
        if (ac === qc || ac === rc) continue;
        const q = qc.value;
        const r = rc.value;
        const a = ac.value;
        tryTriple(q, r, a, { q: qc.raw, r: rc.raw, a: ac.raw });
      }
    }
  }

  if (best.score < 0.4 && anyMoney.length >= 2) {
    const sortedByX = uniqValues(anyMoney).sort((a, b) => a.centerX - b.centerX);
    const sortedByVal = [...sortedByX].sort((a, b) => a.value - b.value);
    const smallest = sortedByVal[0];
    const mids = sortedByVal.slice(1, -1);
    const largest = sortedByVal[sortedByVal.length - 1];
    if (smallest && largest && smallest !== largest) {
      const mid = mids[0] || sortedByVal[1];
      if (mid) tryTriple(smallest.value, mid.value, largest.value, { q: smallest.raw, r: mid.raw, a: largest.raw });
    }
    const right = sortedByX[sortedByX.length - 1];
    const midR = sortedByX[sortedByX.length - 2];
    const leftQ = sortedByX[0];
    if (leftQ && midR && right && leftQ.isInteger && leftQ.value <= 5000) {
      tryTriple(leftQ.value, midR.value, right.value, { q: leftQ.raw, r: midR.raw, a: right.raw });
    }
  }

  let carryOut = null;
  const usedVals = new Set([best.qty, best.rate, best.amount].filter((v) => typeof v === 'number'));

  const isMoneyLike = (c) => {
    if (c.value < 1) return false;
    if (c.hasDecimal || c.value % 1 !== 0) return true;
    return c.value >= 10;
  };

  const leftoverMoney = pool.filter(
    (c) => isMoneyLike(c)
      && !usedVals.has(c.value)
      && !c.flags.includes('carried_from_split')
  ).sort((a, b) => b.centerX - a.centerX);

  if (best.locked && leftoverMoney.length >= 1) {
    const orphan = leftoverMoney[0];
    carryOut = { pendingAmount: orphan.value };
    repairActions.push({
      type: 'split_row_extra_amount',
      carriedToNext: orphan.value,
      reason: 'Extra money-like value after locked qty×rate≈amount; likely next line item'
    });
  }

  const rowOut = {
    hsn_code: geoRow.hsn_code ?? null,
    description: geoRow.description,
    quantity: best.qty != null ? String(best.qty) : geoRow.quantity,
    unit_price: best.rate != null ? String(best.rate) : geoRow.unit_price,
    amount: best.amount != null ? String(best.amount) : geoRow.amount
  };

  return {
    row: rowOut,
    debug: {
      numericTokens,
      semanticClassifications: {
        quantity: best.classifications.quantity ?? geoRow.quantity,
        unit_price: best.classifications.unit_price ?? geoRow.unit_price,
        amount: best.classifications.amount ?? geoRow.amount
      },
      validationScore: best.score,
      locked: best.locked,
      repairActions
    },
    carryOut
  };
};

const autoCorrectLineItem = (row) => {
  const qty = toNumber(row.quantity);
  const unit = toNumber(row.unit_price);
  const amt = toNumber(row.amount);

  const corrections = [];

  if (typeof qty === 'number' && typeof unit === 'number' && typeof amt === 'number') {
    const expected = qty * unit;
    if (moneyClose(expected, amt, 1)) {
      return { row, ok: true, corrections };
    }

    // Swap unit_price and amount if it makes sense (OCR sometimes shifts columns).
    const swappedExpected = qty * amt;
    if (moneyClose(swappedExpected, unit, 1)) {
      corrections.push('swap_unit_price_and_amount');
      return {
        row: {
          ...row,
          unit_price: row.amount,
          amount: row.unit_price
        },
        ok: true,
        corrections
      };
    }

    // Decimal shift fixes (e.g., 12345 vs 123.45)
    const shifts = [10, 100, 1000];
    for (const factor of shifts) {
      if (moneyClose(expected, amt / factor, 1)) {
        corrections.push(`amount_div_${factor}`);
        return { row: { ...row, amount: String(amt / factor) }, ok: true, corrections };
      }
      if (moneyClose(expected, amt * factor, 1)) {
        corrections.push(`amount_mul_${factor}`);
        return { row: { ...row, amount: String(amt * factor) }, ok: true, corrections };
      }
    }
  }

  return { row, ok: false, corrections };
};

const inferColumnsFromNumericAlignment = (rows, startIndex = 0) => {
  const candidates = rows.slice(startIndex, startIndex + 30)
    .filter((row) => !isTotalsRow(row.text))
    .map((row) => {
      const numericTokens = row.tokens.filter((t) => /\d/.test(t.text));
      if (numericTokens.length < 2) return null;
      const sorted = numericTokens.slice().sort((a, b) => b.box.centerX - a.box.centerX);
      // Take up to 3 rightmost numeric tokens: amount, rate, qty
      return {
        amountX: sorted[0]?.box.centerX ?? null,
        rateX: sorted[1]?.box.centerX ?? null,
        qtyX: sorted[2]?.box.centerX ?? null
      };
    })
    .filter(Boolean);

  if (candidates.length < 2) return null;

  const amountXs = candidates.map((c) => c.amountX).filter((v) => typeof v === 'number');
  const rateXs = candidates.map((c) => c.rateX).filter((v) => typeof v === 'number');
  const qtyXs = candidates.map((c) => c.qtyX).filter((v) => typeof v === 'number');

  const amountX = amountXs.length ? avg(amountXs) : null;
  const rateX = rateXs.length ? avg(rateXs) : null;
  const qtyX = qtyXs.length ? avg(qtyXs) : null;

  const anchors = [qtyX, rateX, amountX].filter((v) => typeof v === 'number').sort((a, b) => a - b);
  if (anchors.length < 2) return null;
  const boundaries = [];
  for (let i = 0; i < anchors.length - 1; i += 1) boundaries.push((anchors[i] + anchors[i + 1]) / 2);

  return {
    anchors: { qtyX, rateX, amountX },
    boundaries,
    strategy: 'numeric-alignment'
  };
};

export const reconstructInvoiceLineItemsFromBlocks = (textBlocks = []) => {
  const tokens = tokenizeBlocks(textBlocks);
  const rows = groupIntoRows(tokens);
  const headerDetection = findBestHeaderRow(rows);
  const headerIndex = headerDetection.headerIndex;

  let columns = null;
  let columnStrategy = 'header';
  let startIndex = headerIndex;

  if (headerIndex !== -1) {
    const headerRow = rows[headerIndex];
    columns = buildColumnBoundaries(headerRow);
  }

  if (!columns) {
    // Fallback: infer columns from numeric alignment, starting near the best guessed area.
    startIndex = Math.max(0, headerIndex === -1 ? 0 : headerIndex);
    columns = inferColumnsFromNumericAlignment(rows, startIndex);
    columnStrategy = columns ? (columns.strategy || 'numeric-alignment') : 'none';
  }

  if (!columns) {
    return {
      found: false,
      reason: headerIndex === -1 ? 'Header row not found and numeric fallback failed' : 'Unable to infer table columns',
      rows,
      items: [],
      headerIndex,
      headerDetection,
      columns: null,
      columnStrategy
    };
  }

  const extracted = [];
  const debugRows = [];
  let semanticCarry = null;

  const rowStart = headerIndex === -1 ? startIndex : headerIndex + 1;
  for (let i = rowStart; i < rows.length; i += 1) {
    const row = rows[i];
    if (shouldStopLineItemParsing(row.text) || isTotalsRow(row.text)) break;
    const assigned = assignTokensToColumns(row, columns.boundaries);
    const tokenLevelHsn = extractHsnFromRowTokens(row.tokens);
    if (!assigned.hsn_code && tokenLevelHsn) {
      assigned.hsn_code = tokenLevelHsn;
    }
    const numericCandidates = extractSemanticNumericCandidates(row.tokens);
    const semantic = assignSemanticNumerics(numericCandidates, assigned, semanticCarry);
    semanticCarry = semantic.carryOut;

    const corrected = autoCorrectLineItem(semantic.row);

    // Basic filter: skip rows with no numeric presence.
    const hasSomeValue = Boolean(
      semantic.row.description || semantic.row.quantity || semantic.row.unit_price || semantic.row.amount
    );
    const hasNumbers = /\d/.test(row.text);
    if (!hasSomeValue) continue;

    const qtyNum = toNumber(corrected.row.quantity);
    const unitNum = toNumber(corrected.row.unit_price);
    const amtNum = toNumber(corrected.row.amount);
    const hasNoNumericCols = qtyNum === null && unitNum === null && amtNum === null;

    // Continuation logic: if the row has no numeric columns, append it to previous description.
    if (hasNoNumericCols && extracted.length > 0 && corrected.row.description) {
      const last = extracted[extracted.length - 1];
      last.description = [last.description, corrected.row.description].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
      debugRows.push({
        ...corrected.row,
        rowIndex: row.rowIndex,
        page: row.page,
        confidence: row.confidence,
        rawText: row.text,
        corrections: corrected.corrections,
        mergedIntoPrevious: true,
        semanticNumeric: semantic.debug
      });
      continue;
    }

    if (!hasNumbers) continue;

    extracted.push(corrected.row);
    debugRows.push({
      ...corrected.row,
      rowIndex: row.rowIndex,
      page: row.page,
      confidence: row.confidence,
      rawText: row.text,
      corrections: corrected.corrections,
      mergedIntoPrevious: false,
      semanticNumeric: semantic.debug
    });
  }

  return {
    found: true,
    headerIndex,
    columns,
    columnStrategy,
    headerDetection,
    rows,
    items: extracted,
    debugRows
  };
};
