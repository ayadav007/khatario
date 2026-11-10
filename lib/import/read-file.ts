import ExcelJS from 'exceljs';
import { parse } from 'csv-parse/sync';
import { normaliseKey } from '@/lib/import/parse-values';

export type ReadFileResult = {
  headers: string[];
  rows: string[][];
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

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** exceljs reads a sheet date as a UTC instant, so UTC getters give the date the user sees. */
function isoDate(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function cellToString(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : isoDate(value);
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'object') {
    const v = value as unknown as Record<string, unknown>;
    if (typeof v.formula === 'string') return `=${v.formula}`.trim();
    if (typeof v.sharedFormula === 'string') return `=${v.sharedFormula}`.trim();
    if (Array.isArray(v.richText)) {
      return (v.richText as { text?: string }[]).map((t) => t.text ?? '').join('').trim();
    }
    if (typeof v.text === 'string') return v.text.trim();
    if (typeof v.error === 'string') return v.error.trim();
  }
  return '';
}

async function readXlsx(buffer: Buffer): Promise<string[][]> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw new ImportFileError('UNREADABLE', 'The file could not be read as an Excel workbook.');
  }
  const ws = wb.worksheets[0];
  if (!ws) throw new ImportFileError('UNREADABLE', 'The workbook has no worksheets.');
  const out: string[][] = [];
  const colCount = ws.columnCount;
  for (let r = 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const cells: string[] = [];
    for (let c = 1; c <= colCount; c++) cells.push(cellToString(row.getCell(c).value));
    out.push(cells);
  }
  return out;
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

function readCsv(buffer: Buffer): string[][] {
  const text = decodeCsv(buffer);
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const count = (ch: string) => firstLine.split(ch).length - 1;
  const commas = count(',');
  let delimiter = ',';
  if (count('\t') > commas && count('\t') >= count(';')) delimiter = '\t';
  else if (count(';') > commas) delimiter = ';';
  try {
    const records = parse(text, {
      delimiter,
      relax_column_count: true,
      skip_empty_lines: false,
    }) as unknown[][];
    return records.map((rec) => rec.map((c) => String(c ?? '').trim()));
  } catch {
    throw new ImportFileError('UNREADABLE', 'The file could not be read as CSV.');
  }
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

  const grid = ext === 'xlsx' ? await readXlsx(buffer) : readCsv(buffer);

  const headerIdx = grid.findIndex(
    (row, i) =>
      row.filter((c) => c !== '').length >= 2 && grid.slice(i + 1).some(hasValue),
  );
  if (headerIdx < 0) {
    throw new ImportFileError('NO_HEADER', 'No header row was found in the file.');
  }

  const headers = grid[headerIdx].map((h) => h.trim());
  while (headers.length > 0 && headers[headers.length - 1] === '') headers.pop();

  const rows: string[][] = [];
  for (const raw of grid.slice(headerIdx + 1)) {
    if (!hasValue(raw)) continue;
    const first = normaliseKey(raw.find((c) => c !== '') ?? '');
    if (first === 'total' || first === 'grandtotal') continue;
    const row = headers.map((_, j) => (raw[j] ?? '').trim());
    rows.push(row);
    if (rows.length > MAX_DATA_ROWS) {
      throw new ImportFileError('TOO_MANY_ROWS', 'The file has more than 10,000 data rows.');
    }
  }

  return {
    headers,
    rows,
    headerRowNumber: headerIdx + 1,
    firstDataRowNumber: headerIdx + 2,
  };
}
