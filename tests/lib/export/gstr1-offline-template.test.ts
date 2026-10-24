import { slimWorksheetXml } from '@/lib/export/gstr1-offline-tool-v22-excel';

describe('GSTR-1 offline template slimming', () => {
  it('drops the unused columns that make ExcelJS run out of memory', () => {
    const xml = [
      '<worksheet>',
      '<dimension ref="B1:XFC476"/>',
      '<row r="5" spans="2:11"><c r="B5" s="44" t="s"><v>3</v></c><c r="K5" s="46"/></row>',
      '<row r="124" spans="2:1023 1025:2047"><c r="B124" s="1"/><c r="XFC124" s="1"/></row>',
      '<cols><col min="1" max="16384" width="8"/></cols>',
      '<dataValidation sqref="H5:H20003"><formula1>0</formula1></dataValidation>',
      '<dataValidation sqref="J2003:J20003"><formula1>0</formula1></dataValidation>',
      '</worksheet>',
    ].join('');

    const slim = slimWorksheetXml(xml);

    expect(slim).toContain('<c r="B5"');
    expect(slim).toContain('<c r="K5"');
    expect(slim).not.toContain('<c r="B124"');
    expect(slim).not.toContain('XFC124');
    expect(slim).not.toContain('1025:2047');
    expect(slim).toContain('<dimension ref="A1:AF14"/>');
    expect(slim).toContain('max="32"');
    expect(slim).not.toContain('16384');
    expect(slim).toContain('sqref="H5:H14"');
    expect(slim).not.toContain('H20003');
  });

});
