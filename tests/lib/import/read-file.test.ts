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
    // An Excel date is a serial with no time zone and exceljs reads it as a UTC instant,
    // hence Date.UTC: exceljs stores and reads dates as UTC instants, so this is
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

describe('fix round 1', () => {
  test('merged title across A1:D1 is not mistaken for the header', async () => {
    const buf = await xlsxBuffer((ws) => {
      ws.addRow(['Sharma Traders']);
      ws.mergeCells('A1:D1');
      ws.addRow([]);
      ws.addRow(['Name', 'City', 'Mobile', 'GST']);
      ws.addRow(['A', 'Pune', '98', 'x']);
    });
    const r = await readImportFile(buf, 'x.xlsx');
    expect(r.headerRowNumber).toBe(3);
    expect(r.headers).toEqual(['Name', 'City', 'Mobile', 'GST']);
    expect(r.rows).toEqual([['A', 'Pune', '98', 'x']]);
  });

  test('csv row numbers survive blank, total and multi-line rows', async () => {
    const r = await readImportFile(Buffer.from('Name,Amount\nA,10\n\nB,20\nGrand Total,30\nC,5\n'), 'x.csv');
    expect(r.rows.map((x) => x[0])).toEqual(['A', 'B', 'C']);
    expect(r.rowNumbers).toEqual([2, 4, 6]);
    expect(r.firstDataRowNumber).toBe(2);

    const m = await readImportFile(Buffer.from('Name,Note\nA,"line1\nline2"\nB,x\r\nC,y\n'), 'x.csv');
    expect(m.rowNumbers).toEqual([2, 4, 5]);
    expect(m.rows[0]).toEqual(['A', 'line1\nline2']);
  });

  test('xlsx row numbers with a blank row between data rows', async () => {
    const buf = await xlsxBuffer((ws) => {
      ws.addRow(['Name', 'City']);
      ws.addRow(['A', 'Pune']);
      ws.addRow([]);
      ws.addRow(['B', 'Delhi']);
    });
    const r = await readImportFile(buf, 'x.xlsx');
    expect(r.rowNumbers).toEqual([2, 4]);
    expect(r.firstDataRowNumber).toBe(2);
  });

  test('shared formula cell yields its own formula text', async () => {
    const buf = await xlsxBuffer((ws) => {
      ws.addRow(['Name', 'Double']);
      ws.addRow([1, { formula: 'A2*2', result: 2, shareType: 'shared', ref: 'B2:B3' }]);
      ws.addRow([5, { sharedFormula: 'B2', result: 10 }]);
    });
    const r = await readImportFile(buf, 'x.xlsx');
    expect(r.rows).toEqual([['1', '=A2*2'], ['5', '=A3*2']]);
  });

  test('xlsx row limit: 10,000 accepted, 10,001 rejected', async () => {
    const make = (n: number) =>
      xlsxBuffer((ws) => {
        ws.addRow(['Name', 'City']);
        for (let i = 0; i < n; i++) ws.addRow(['A', 'B']);
      });
    expect((await readImportFile(await make(10000), 'x.xlsx')).rows).toHaveLength(10000);
    await expect(readImportFile(await make(10001), 'x.xlsx')).rejects.toMatchObject({ code: 'TOO_MANY_ROWS' });
  }, 60000);

  test('csv with exactly 10,000 data rows is accepted', async () => {
    const r = await readImportFile(Buffer.from('Name,City\n' + 'A,B\n'.repeat(10000)), 'x.csv');
    expect(r.rows).toHaveLength(10000);
  });

  test('columns beyond 200 are ignored', async () => {
    const buf = await xlsxBuffer((ws) => {
      ws.addRow(['Name', 'City']);
      ws.getCell(2, 250).value = 'far';
      ws.getCell(2, 1).value = 'A';
    });
    const r = await readImportFile(buf, 'x.xlsx');
    expect(r.rows).toEqual([['A', '']]);
    expect(r.headers).toEqual(['Name', 'City']);
  });

  test('delimiter detection over the first lines, outside quotes', async () => {
    const semi = await readImportFile(Buffer.from('Sharma Traders, Pune\nList of Ledgers\nName;City;Mobile\nA;Pune;98\n'), 'x.csv');
    expect(semi.headers).toEqual(['Name', 'City', 'Mobile']);
    const tab = await readImportFile(Buffer.from('Title line\nAnother\nName\tCity\tMobile\nA\tPune\t98\n'), 'x.csv');
    expect(tab.headers).toEqual(['Name', 'City', 'Mobile']);
    const comma = await readImportFile(Buffer.from('"Name, Full",City\nA,Pune\n'), 'x.csv');
    expect(comma.headers).toEqual(['Name, Full', 'City']);
  });

  test('unreadable files', async () => {
    await expect(readImportFile(Buffer.from('not a zip'), 'x.xlsx')).rejects.toMatchObject({ code: 'UNREADABLE' });
  });

  test('stray quote inside an unquoted field is tolerated', async () => {
    const r = await readImportFile(Buffer.from('Name,Size\nPipe 5" long,10\n'), 'x.csv');
    expect(r.rows).toEqual([['Pipe 5" long', '10']]);
  });
});

describe('scan bound', () => {
  test('a sheet formatted down to row 30,000 with 5 data rows is refused as too many rows', async () => {
    const buf = await xlsxBuffer((ws) => {
      ws.addRow(['Name', 'City']);
      for (let i = 0; i < 5; i++) ws.addRow([`Party ${i}`, 'Pune']);
      // Formatting alone (no value) still makes the rows part of the sheet.
      for (let r = 7; r <= 30000; r++) ws.getRow(r).getCell(1).style = { font: { bold: true } };
    });
    await expect(readImportFile(buf, 'x.xlsx')).rejects.toMatchObject({
      code: 'TOO_MANY_ROWS',
      message: expect.stringMatching(/Delete the empty rows/),
    });
  }, 60000);

  test('blank rows within 20,000 rows of the header are skipped as before', async () => {
    const buf = await xlsxBuffer((ws) => {
      ws.addRow(['Name', 'City']);
      ws.addRow(['First', 'Pune']);
      for (let r = 3; r <= 19000; r++) ws.getRow(r).getCell(1).style = { font: { bold: true } };
      ws.getRow(19001).values = ['Last', 'Pune'];
    });
    const r = await readImportFile(buf, 'x.xlsx');
    expect(r.rows).toEqual([
      ['First', 'Pune'],
      ['Last', 'Pune'],
    ]);
    expect(r.rowNumbers).toEqual([2, 19001]);
  }, 60000);
});

test("a problem-rows file uploaded again loses the apostrophe that guarded formulas", async () => {
  const csv = "Name,Phone,Note\n\"'=HYPERLINK(\"\"x\"\")\",'+919876543210,'it's fine\n'@home,'-5,'plain\n";
  const r = await readImportFile(Buffer.from(csv), 'problems.csv');
  expect(r.rows).toEqual([
    ['=HYPERLINK("x")', '+919876543210', "'it's fine"],
    ['@home', '-5', "'plain"],
  ]);
});
