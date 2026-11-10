import ExcelJS from 'exceljs';
import { readImportFile } from '@/lib/import/read-file';

async function xlsxBuffer(fill: (ws: ExcelJS.Worksheet) => void): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  fill(wb.addWorksheet('Sheet1'));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

test('title lines above the header are skipped', async () => {
  const csv = 'Sharma Traders\nList of Ledgers\n\nName,GSTIN/UIN,Mobile\nA,27AAAPA1234A1Z5,9876543210\n';
  const r = await readImportFile(Buffer.from(csv), 'ledgers.csv');
  expect(r.headers).toEqual(['Name', 'GSTIN/UIN', 'Mobile']);
  expect(r.headerRowNumber).toBe(4);
  expect(r.firstDataRowNumber).toBe(5);
  expect(r.rows).toEqual([['A', '27AAAPA1234A1Z5', '9876543210']]);
});

test('blank and total rows are dropped', async () => {
  const csv = 'Name,Amount\nA,10\n\nGrand Total,10\n';
  expect((await readImportFile(Buffer.from(csv), 'x.csv')).rows).toEqual([['A', '10']]);
});

test('UTF-8 BOM, UTF-16 LE and Hindi text', async () => {
  const text = 'Name,City\nशर्मा ट्रेडर्स,पुणे\n';
  const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text)]);
  const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
  for (const b of [bom, utf16]) {
    const r = await readImportFile(b, 'x.csv');
    expect(r.headers[0]).toBe('Name');
    expect(r.rows[0]).toEqual(['शर्मा ट्रेडर्स', 'पुणे']);
  }
});

test('xlsx formula cell is text, date cell is ISO, number is plain', async () => {
  const buf = await xlsxBuffer((ws) => {
    ws.addRow(['Name', 'Value', 'When', 'Amount']);
    // Date.UTC: exceljs stores and reads dates as UTC instants, so this is
    // 1 April on every machine time zone.
    ws.addRow(['A', { formula: '1+1' }, new Date(Date.UTC(2026, 3, 1)), 1250.5]);
  });
  const r = await readImportFile(buf, 'x.XLSX');
  expect(r.headers).toEqual(['Name', 'Value', 'When', 'Amount']);
  expect(r.rows).toEqual([['A', '=1+1', '2026-04-01', '1250.5']]);
});

test('xlsx reads only the first sheet and skips title rows', async () => {
  const wb = new ExcelJS.Workbook();
  const a = wb.addWorksheet('One');
  a.addRow(['Report']);
  a.addRow(['Name', 'City']);
  a.addRow(['A', 'Pune']);
  wb.addWorksheet('Two').addRow(['X', 'Y']);
  const r = await readImportFile(Buffer.from(await wb.xlsx.writeBuffer()), 'x.xlsx');
  expect(r.headerRowNumber).toBe(2);
  expect(r.firstDataRowNumber).toBe(3);
  expect(r.rows).toEqual([['A', 'Pune']]);
});

test('short rows are padded and cells trimmed', async () => {
  const r = await readImportFile(Buffer.from('Name,City,Mobile\n A ,Pune\n'), 'x.csv');
  expect(r.rows).toEqual([['A', 'Pune', '']]);
});

test('tab and semicolon delimiters are detected', async () => {
  const tab = await readImportFile(Buffer.from('Name\tCity\nA\tPune\n'), 'x.csv');
  expect(tab.headers).toEqual(['Name', 'City']);
  expect(tab.rows).toEqual([['A', 'Pune']]);
  const semi = await readImportFile(Buffer.from('Name;City\nA;Pune\n'), 'x.csv');
  expect(semi.headers).toEqual(['Name', 'City']);
  expect(semi.rows).toEqual([['A', 'Pune']]);
});

test('quoted field with comma and newline stays one cell', async () => {
  const r = await readImportFile(Buffer.from('Name,Address\nA,"12 Main St,\nPune"\nB,Delhi\n'), 'x.csv');
  expect(r.rows).toEqual([['A', '12 Main St,\nPune'], ['B', 'Delhi']]);
});

test('limits and types', async () => {
  await expect(readImportFile(Buffer.from('a'), 'x.pdf')).rejects.toMatchObject({ code: 'UNSUPPORTED_TYPE' });
  await expect(readImportFile(Buffer.alloc(10 * 1024 * 1024 + 1), 'x.csv')).rejects.toMatchObject({ code: 'TOO_LARGE' });
  await expect(readImportFile(Buffer.from('only one cell\n'), 'x.csv')).rejects.toMatchObject({ code: 'NO_HEADER' });
  const big = 'Name,City\n' + 'A,B\n'.repeat(10001);
  await expect(readImportFile(Buffer.from(big), 'x.csv')).rejects.toMatchObject({ code: 'TOO_MANY_ROWS' });
});
