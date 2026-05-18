import type { BankImportPreview, NormalizedBankRow } from '@/lib/bank/types';
import { makePreviewRow, parseInrAmount, parseStatementDate, roundMoney } from '@/lib/bank/normalize';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const execFileAsync = promisify(execFile);

/** Minimum extracted text chars to treat PDF as digital (text layer present). */
export const PDF_DIGITAL_TEXT_THRESHOLD = 400;

async function pdfBufferToText(buffer: Buffer): Promise<{ text: string; numpages: number }> {
  // pdf-parse is CommonJS
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pdfParse = require('pdf-parse') as (b: Buffer) => Promise<{ text: string; numpages: number }>;
  const res = await pdfParse(buffer);
  return { text: res.text || '', numpages: res.numpages || 0 };
}

async function tryOcrFirstPageWithPoppler(pdfBuffer: Buffer): Promise<string | null> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bkstmt-'));
  const pdfPath = path.join(dir, 'in.pdf');
  const outPrefix = path.join(dir, 'page');
  fs.writeFileSync(pdfPath, pdfBuffer);
  try {
    await execFileAsync('pdftoppm', ['-png', '-r', '144', '-f', '1', '-l', '1', pdfPath, outPrefix], {
      windowsHide: true,
    });
    const png = `${outPrefix}-1.png`;
    if (!fs.existsSync(png)) return null;
    const { createWorker } = await import('tesseract.js');
    const worker = await createWorker('eng');
    try {
      const {
        data: { text },
      } = await worker.recognize(png);
      return text || null;
    } finally {
      await worker.terminate();
    }
  } catch {
    return null;
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

/**
 * Heuristic row parser for messy PDF text dumps (one line per logical row when possible).
 */
export function parseLooseStatementText(fullText: string): NormalizedBankRow[] {
  const lines = fullText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const rows: NormalizedBankRow[] = [];

  for (const line of lines) {
    if (line.length < 6) continue;
    // Skip obvious headers
    if (/^date\s+particulars/i.test(line) || /^sl\.?\s*no/i.test(line)) continue;

    const date = parseStatementDate(line);
    if (!date) continue;

    const nums = [...line.matchAll(/[\d,]+(?:\.\d{1,2})?/g)]
      .map((m) => parseInrAmount(m[0]))
      .filter((n): n is number => n != null && n >= 0);

    if (nums.length === 0) continue;

    let debit = 0;
    let credit = 0;
    let balance: number | null = null;

    if (nums.length >= 3) {
      const a = nums[nums.length - 3]!;
      const b = nums[nums.length - 2]!;
      const c = nums[nums.length - 1]!;
      debit = a;
      credit = b;
      balance = c;
    } else if (nums.length === 2) {
      debit = nums[0]!;
      credit = 0;
      balance = nums[1]!;
    } else {
      credit = nums[0]!;
      balance = nums.length > 1 ? nums[1]! : null;
    }

    const dateMatch = line.match(/^(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{1,2}-\d{1,2})/);
    const rest = dateMatch ? line.slice(dateMatch[0].length).trim() : line;
    const desc = rest
      .replace(/[\d,]+(?:\.\d{1,2})?/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 2000);

    rows.push(
      makePreviewRow({
        date,
        description: desc || '—',
        debit: roundMoney(debit),
        credit: roundMoney(credit),
        balance: balance != null ? roundMoney(balance) : null,
      })
    );
  }

  return rows;
}

export async function extractBankRowsFromPdf(buffer: Buffer, fileName: string): Promise<BankImportPreview> {
  const warnings: string[] = [];
  const { text, numpages } = await pdfBufferToText(buffer);
  const stripped = text.replace(/\s+/g, ' ').trim();
  const isDigital = stripped.length >= PDF_DIGITAL_TEXT_THRESHOLD;

  let sourceType: BankImportPreview['sourceType'] = isDigital ? 'pdf_digital' : 'pdf_scanned';
  let workText = text;

  if (!isDigital) {
    warnings.push(
      'This appears to be a scanned statement (little or no text layer). OCR was attempted if Poppler (pdftoppm) is installed; please verify every row.'
    );
    const ocrText = await tryOcrFirstPageWithPoppler(buffer);
    if (ocrText && ocrText.trim().length > 50) {
      workText = ocrText;
      warnings.push('Used OCR on the first page only; additional pages may be missing — prefer CSV export when possible.');
    } else if (numpages > 1) {
      warnings.push(
        'OCR did not run (install Poppler and ensure `pdftoppm` is on PATH) or first page had no text. Only the first page would be OCR-scanned when enabled.'
      );
    }
  }

  const rows = parseLooseStatementText(workText);
  if (rows.length === 0) {
    warnings.push(
      'No transaction rows could be parsed from this PDF. Try exporting CSV from your bank, or ensure the PDF has a selectable text layer.'
    );
  }

  return {
    fileName,
    fileType: 'pdf',
    sourceType,
    rows,
    warnings,
    pdfTextLength: stripped.length,
  };
}
