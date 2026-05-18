/**
 * Lightweight table column inference from HTML strings (no DOM parser).
 * Uses the first data/header row of the first <table> to guess text vs numeric columns.
 */

export type ColumnKind = 'text' | 'numeric';

function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#160;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Cell contents from a single <tr> inner HTML, in column order. */
function splitRowCells(trInner: string): string[] {
  const out: string[] = [];
  const re = /<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(trInner)) !== null) {
    out.push(m[1]);
  }
  return out;
}

/**
 * First row of first table: prefer <thead>, then <tbody>, then first <tr>.
 */
function extractFirstRowCells(html: string): string[] | null {
  const tableMatch = html.match(/<table\b[^>]*>/i);
  if (!tableMatch || tableMatch.index === undefined) return null;

  const fromTable = html.slice(tableMatch.index);

  const thead = fromTable.match(/<thead\b[^>]*>([\s\S]*?)<\/thead>/i);
  if (thead) {
    const tr = thead[1].match(/<tr\b[^>]*>([\s\S]*?)<\/tr>/i);
    if (tr) {
      const cells = splitRowCells(tr[1]);
      if (cells.length > 0) return cells;
    }
  }

  const tbody = fromTable.match(/<tbody\b[^>]*>([\s\S]*?)<\/tbody>/i);
  if (tbody) {
    const tr = tbody[1].match(/<tr\b[^>]*>([\s\S]*?)<\/tr>/i);
    if (tr) {
      const cells = splitRowCells(tr[1]);
      if (cells.length > 0) return cells;
    }
  }

  const tr = fromTable.match(/<tr\b[^>]*>([\s\S]*?)<\/tr>/i);
  if (!tr) return null;
  const cells = splitRowCells(tr[1]);
  return cells.length > 0 ? cells : null;
}

const NUMERIC_HINT = /[\d₹$€£.,]/;

function cellLooksNumeric(cellHtml: string): boolean {
  const cellContent = stripTags(cellHtml);
  return NUMERIC_HINT.test(cellContent);
}

export function detectColumns(html: string): {
  totalColumns: number;
  columnTypes: ColumnKind[];
} {
  try {
    const cells = extractFirstRowCells(html);
    if (!cells || cells.length === 0) {
      return { totalColumns: 0, columnTypes: [] };
    }

    const columnTypes: ColumnKind[] = cells.map((cell) =>
      cellLooksNumeric(cell) ? 'numeric' : 'text'
    );

    return {
      totalColumns: columnTypes.length,
      columnTypes,
    };
  } catch {
    return { totalColumns: 0, columnTypes: [] };
  }
}

function pct(n: number): string {
  return `${Number(n.toFixed(2))}%`;
}

/**
 * Width + alignment rules scoped under body.thermal-mode tables.
 * First text column ~55%; remaining columns share 45% equally.
 * Numeric columns: right-aligned, nowrap (and no aggressive word-break).
 */
export function generateColumnCSS(columnTypes: ColumnKind[]): string {
  const n = columnTypes.length;
  if (n === 0) return '';

  const sel = (i: number) =>
    `body.thermal-mode table td:nth-child(${i}),\nbody.thermal-mode table th:nth-child(${i})`;

  const chunks: string[] = [];

  if (n === 1) {
    chunks.push(`${sel(1)} {
  width: 100%;
}`);
    if (columnTypes[0] === 'numeric') {
      chunks.push(`${sel(1)} {
  text-align: right !important;
  white-space: nowrap;
  word-break: normal;
  overflow-wrap: normal;
}`);
    }
    return chunks.join('\n\n');
  }

  const firstTextIdx = columnTypes.indexOf('text');

  if (firstTextIdx === -1) {
    const w = 100 / n;
    const widthSelectors = Array.from({ length: n }, (_, i) => sel(i + 1)).join(',\n');
    chunks.push(`${widthSelectors} {
  width: ${pct(w)};
  text-align: right !important;
  white-space: nowrap;
  word-break: normal;
  overflow-wrap: normal;
}`);
    return chunks.join('\n\n');
  }

  const otherIndices = columnTypes.map((_, i) => i).filter((i) => i !== firstTextIdx);
  const share = 45 / otherIndices.length;

  chunks.push(`${sel(firstTextIdx + 1)} {
  width: ${pct(55)};
}`);

  const restSelectors = otherIndices.map((i) => sel(i + 1)).join(',\n');
  chunks.push(`${restSelectors} {
  width: ${pct(share)};
}`);

  const numericIndices = columnTypes
    .map((t, i) => (t === 'numeric' ? i : -1))
    .filter((i) => i >= 0);

  if (numericIndices.length > 0) {
    const numSelectors = numericIndices.map((i) => sel(i + 1)).join(',\n');
    chunks.push(`${numSelectors} {
  text-align: right !important;
  white-space: nowrap;
  word-break: normal;
  overflow-wrap: normal;
}`);
  }

  return chunks.join('\n\n');
}
