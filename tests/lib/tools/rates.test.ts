import fs from 'fs';
import path from 'path';
import { GST_RATE_SLABS } from '@/lib/gst/rates';
import { GST_QUICK_RATES } from '@/lib/tools/gst-quick-rates';
import { TDS_RATES, TDS_RATES_SOURCE, TDS_PUBLIC, RATES_CHECKED_ON } from '@/lib/tools/tds-rates';

describe('free tools statutory rates', () => {
  it('offers only current GST slabs as quick picks', () => {
    expect([...GST_QUICK_RATES]).toEqual([0, 5, 18, 40]);
    for (const r of GST_QUICK_RATES) expect(GST_RATE_SLABS as readonly number[]).toContain(r);
  });
  it('gives every HSN entry a current slab or no rate', () => {
    const rows = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'public/data/hsn_master.json'), 'utf8'));
    for (const row of rows) {
      expect(row.code).toMatch(/^\d{4,8}$/);
      if (row.rate !== '' && row.rate != null) expect(GST_RATE_SLABS as readonly number[]).toContain(Number(row.rate));
    }
  });
  it('has a dated, sourced TDS table with no old rates', () => {
    expect(TDS_RATES_SOURCE.url).toMatch(/^https:\/\/([a-z0-9-]+\.)*incometax(india)?\.gov\.in\//);
    expect(TDS_RATES_SOURCE.checkedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    for (const r of TDS_RATES) { expect(Number.isFinite(r.rate)).toBe(true); expect(r.section.trim()).not.toBe(''); }
    const commission = TDS_RATES.find((r) => /commission|brokerage/i.test(r.label) && !/insurance/i.test(r.label));
    if (TDS_PUBLIC) expect(commission?.rate).toBe(2);
  });
  it('records when the rates were checked', () => expect(RATES_CHECKED_ON).toMatch(/^\d{4}-\d{2}$/));
});
