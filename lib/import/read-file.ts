import ExcelJS from 'exceljs';
import { parse } from 'csv-parse/sync';
import { normaliseKey } from '@/lib/import/parse-values';

export type ReadFileResult = {
  headers: string[];
  rows: string[][];
  /** 1-based row of rows[i] in the user's file. */
  rowNumbers: number[];
  headerRowNumber: number;
  firstDataRowNumber: number;
};

export type ImportFileErrorCode =
  | 'UNSUPPORTED_TYPE'
  | 'TOO_LARGE'
  | 'TOO_MANY_ROWS'
  | 'NO_HEADER'
  | 'UNREADABLE';

export class ImportFileError extends Error {
  code: ImportFileErrorCode;
  constructor(code: ImportFileErrorCode, message: string) {
    super(message);
    this.name = 'ImportFileError';
    this.code = code;
  }
}

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_DATA_ROWS = 10000;
const MAX_COLUMNS = 200;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** exceljs reads a sheet date as a UTC instant, so UTC getters give the date the user sees. */
function isoDate(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function valueToString(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : isoDate(value);
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'object') {
    const v = value as unknown as Record<string, unknown>;
    if (Array.isArray(v.richText)) {
      return (v.richText as { text?: string }[]).map((t) => t.text ?? '').join('').trim();
    }
    if (typeof v.text === 'string') return v.text.trim();
    if (typeof v.error === 'string') return v.error.trim();
  }
  return '';
}

function cellToString(cell: ExcelJS.Cell): string {
  // A merged slave reports its master's value; only the master carries content.
  if (cell.type === ExcelJS.ValueType.Merge) return '';
  if (cell.type === ExcelJS.ValueType.Formula) {
    const f = cell.formula;
    return typeof f === 'string' && f !== '' ? `=${f}`.trim() : '';
  }
  return valueToString(cell.value);
}

/** Rows are read on demand so a huge sheet is never turned into strings in full. */
type RowSource = {
  length: number;
  get(i: number): string[];
  /** 1-based row number in the user's file of row i. */
  numberOf(i: number): number;
};

async function xlsxSource(buffer: Buffer): Promise<RowSource> {
  const unreadable = () =>
    new ImportFileError('UNREADABLE', 'The file could not be read as an Excel workbook.');
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw unreadable();
  }
  const ws = wb.worksheets[0];
  if (!ws) throw new ImportFileError('UNREADABLE', 'The workbook has no worksheets.');
  let colCount: number;
  let length: number;
  try {
    colCount = Math.min(ws.columnCount, MAX_COLUMNS);
    length = ws.rowCount;
  } catch {
    throw unreadable();
  }
  return {
    length,
    get(i) {
      try {
        const row = ws.getRow(i + 1);
        const cells: string[] = [];
        for (let c = 1; c <= colCount; c++) cells.push(cellToString(row.getCell(c)));
        return cells;
      } catch {
        throw unreadable();
      }
    },
    numberOf: (i) => i + 1,
  };
}

function decodeCsv(buffer: Buffer): string {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.subarray(2).toString('utf16le');
  }
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return buffer.subarray(3).toString('utf8');
  }
  return buffer.toString('utf8');
}

/** Counts , tab ; outside double quotes over the first 20 non-empty lines; ties go to comma. */
function detectDelimiter(text: string): string {
  const counts: Record<string, number> = { ',': 0, '\t': 0, ';': 0 };
  let inQuote = false;
  let lineHasContent = false;
  let lines = 0;
  for (let i = 0; i < text.length && lines < 20; i++) {
    const ch = text[i];
    if (ch === '"') {
      inQuote = !inQuote;
      lineHasContent = true;
    } else if (ch === '\n' && !inQuote) {
      if (lineHasContent) lines++;
      lineHasContent = false;
    } else {
      if (ch !== '\r') lineHasContent = true;
      if (!inQuote && ch in counts) counts[ch]++;
    }
  }
  let best = ',';
  for (const d of ['\t', ';']) if (counts[d] > counts[best]) best = d;
  return best;
}

function csvSource(buffer: Buffer): RowSource {
  const text = decodeCsv(buffer).replace(/\r\n?/g, '\n');
  let records: { record: unknown[]; info: { lines: number } }[];
  try {
    records = parse(text, {
      delimiter: detectDelimiter(text),
      relax_column_count: true,
      relax_quotes: true,
      skip_empty_lines: false,
      info: true,
    });
  } catch {
    throw new ImportFileError('UNREADABLE', 'The file could not be read as CSV.');
  }
  // info.lines is the line where a record ends; a record starts after the previous one ends.
  return {
    length: records.length,
    get: (i) => records[i].record.map((c) => String(c ?? '').trim()),
    numberOf: (i) => (i === 0 ? 1 : records[i - 1].info.lines + 1),
  };
}

const hasValue = (row: string[]) => row.some((c) => c !== '');

export async function readImportFile(buffer: Buffer, fileName: string): Promise<ReadFileResult> {
  const dot = fileName.lastIndexOf('.');
  const ext = dot >= 0 ? fileName.slice(dot + 1).toLowerCase() : '';
  if (ext !== 'xlsx' && ext !== 'csv') {
    throw new ImportFileError('UNSUPPORTED_TYPE', 'Upload an .xlsx or .csv file.');
  }
  if (buffer.length > MAX_BYTES) {
    throw new ImportFileError('TOO_LARGE', 'The file is larger than 10 MB.');
  }

  const src = ext === 'xlsx' ? await xlsxSource(buffer) : csvSource(buffer);

  let headerIdx = -1;
  for (let i = 0; i < src.length; i++) {
    if (src.get(i).filter((c) => c !== '').length < 2) continue;
    let hasData = false;
    for (let j = i + 1; j < src.length && !hasData; j++) hasData = hasValue(src.get(j));
    // No data after this row means none after any later row either.
    if (!hasData) break;
    headerIdx = i;
    break;
  }
  if (headerIdx < 0) {
    throw new ImportFileError('NO_HEADER', 'No header row was found in the file.');
  }

  const headers = src.get(headerIdx);
  while (headers.length > 0 && headers[headers.length - 1] === '') headers.pop();

  const rows: string[][] = [];
  const rowNumbers: number[] = [];
  for (let i = headerIdx + 1; i < src.length; i++) {
    const raw = src.get(i);
    if (!hasValue(raw)) continue;
    const first = normaliseKey(raw.find((c) => c !== '') ?? '');
    if (first === 'total' || first === 'grandtotal') continue;
    if (rows.length >= MAX_DATA_ROWS) {
      throw new ImportFileError('TOO_MANY_ROWS', 'The file has more than 10,000 data rows.');
    }
    rows.push(headers.map((_, j) => (raw[j] ?? '').trim()));
    rowNumbers.push(src.numberOf(i));
  }

  return {
    headers,
    rows,
    rowNumbers,
    headerRowNumber: src.numberOf(headerIdx),
    firstDataRowNumber: rowNumbers.length > 0 ? rowNumbers[0] : src.numberOf(headerIdx) + 1,
  };
}
