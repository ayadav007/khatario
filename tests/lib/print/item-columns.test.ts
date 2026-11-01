import {
  baseQuantity,
  buildItemTable,
  buildSlabSummary,
  casesAndPieces,
  pickCaseUnit,
  resolveColumnIds,
} from '@/lib/print/item-columns';

const line = (o: Record<string, unknown>) => ({
  index: 1, item_name: 'Item', hsn_sac: '3401', quantity: 1, unit: 'PCS', unit_price: '10.00',
  discount_amount: '0.00', taxable_value: '10.00', tax_rate: '18.00', cgst_amount: '0.90', sgst_amount: '0.90',
  igst_amount: '0.00', tax_amount: '1.80', line_total: '11.80', cess_amount: '0.00', ...o,
});

describe('cases and pieces', () => {
  it('splits base pieces into whole cases and loose pieces', () => {
    expect(casesAndPieces(line({ quantity: 50, case_unit: 'CASE', case_factor: 12 }))).toEqual({ cases: 4, pieces: 2 });
    expect(casesAndPieces(line({ quantity: 12, case_unit: 'CASE', case_factor: 12 }))).toEqual({ cases: 1, pieces: 0 });
  });

  it('counts a line sold in cases as factor × qty pieces', () => {
    const l = line({ quantity: 3, unit: 'case', case_unit: 'CASE', case_factor: 12 });
    expect(baseQuantity(l)).toBe(36);
    expect(casesAndPieces(l)).toEqual({ cases: 3, pieces: 0 });
  });

  it('prints everything as pieces when the item has no case unit', () => {
    expect(casesAndPieces(line({ quantity: 7 }))).toEqual({ cases: 0, pieces: 7 });
  });

  it('picks a unit named like a case, else the largest', () => {
    expect(pickCaseUnit([{ unit: 'BOX', factor_to_base: 12 }, { unit: 'BAG', factor_to_base: 50 }])).toEqual({ unit: 'BOX', factor: 12 });
    expect(pickCaseUnit([{ unit: 'STRIP', factor_to_base: 10 }, { unit: 'BAG', factor_to_base: 50 }])).toEqual({ unit: 'BAG', factor: 50 });
    expect(pickCaseUnit([{ unit: 'PCS', factor_to_base: 1 }])).toBeNull();
  });
});

describe('resolveColumnIds', () => {
  const lines = [line({ mrp: 20, item_code: 'P1', case_unit: 'CASE', case_factor: 12 })];

  it('uses the distributor default and drops columns with nothing to show', () => {
    const ids = resolveColumnIds({ isIgst: false, lines: [line({})], docType: 'tax_invoice' });
    expect(ids).toEqual(['sno', 'hsn', 'description', 'pieces', 'rate', 'gross', 'discount', 'taxable', 'gst_rate', 'cgst_igst', 'sgst', 'net']);
  });

  it('keeps MRP, code and case columns when lines have them', () => {
    const ids = resolveColumnIds({ isIgst: false, lines, docType: 'tax_invoice' });
    expect(ids).toEqual(expect.arrayContaining(['item_code', 'mrp', 'cases', 'upc']));
  });

  it('puts back the columns a tax invoice must print, in registry order', () => {
    const ids = resolveColumnIds({ chosen: ['description', 'qty', 'net'], isIgst: false, lines, docType: 'tax_invoice' });
    expect(ids).toEqual(['hsn', 'description', 'qty', 'taxable', 'gst_rate', 'cgst', 'sgst', 'net']);
  });

  it('adds IGST rather than CGST/SGST on an inter-state bill', () => {
    const ids = resolveColumnIds({ chosen: ['description', 'qty', 'net'], isIgst: true, lines, docType: 'tax_invoice' });
    expect(ids).toEqual(['hsn', 'description', 'qty', 'taxable', 'gst_rate', 'igst', 'net']);
  });

  it('leaves a proforma invoice exactly as chosen', () => {
    expect(resolveColumnIds({ chosen: ['description', 'net'], isIgst: false, lines, docType: 'proforma_invoice' })).toEqual(['description', 'net']);
  });

  it('ignores unknown ids and duplicates', () => {
    const ids = resolveColumnIds({ chosen: ['description', 'bogus', 'description', 'qty'], isIgst: false, lines, docType: 'sales_order' });
    expect(ids).toEqual(['description', 'qty']);
  });

  it('accepts item custom fields as columns', () => {
    const ids = resolveColumnIds({
      chosen: ['description', 'cf:shade', 'net'], isIgst: false, lines, docType: 'sales_order',
      customColumns: [{ key: 'shade', label: 'Shade' }],
    });
    expect(ids).toEqual(['description', 'cf:shade', 'net']);
  });
});

describe('buildItemTable', () => {
  it('formats cells, totals and widths', () => {
    const t = buildItemTable({
      lines: [
        line({ index: 1, quantity: 50, unit_price: '120.00', taxable_value: '6000.00', line_total: '6300.00', case_unit: 'CASE', case_factor: 12, item_custom_fields: { shade: 'Red' } }),
        line({ index: 2, quantity: 5, unit_price: '100.00', taxable_value: '500.00', line_total: '590.00' }),
      ],
      chosen: ['sno', 'description', 'cases', 'pieces', 'gross', 'cf:shade', 'net'],
      docType: 'sales_order',
      isIgst: false,
      customColumns: [{ key: 'shade', label: 'Shade' }],
    });
    expect(t.columns.map((c) => c.label)).toEqual(['#', 'Item Description', 'Cs', 'Pcs', 'Gross Amt', 'Shade', 'Net Amt']);
    expect(t.rows[0].cells.map((c) => c.text)).toEqual(['1', 'Item', '4', '2', '6,000.00', 'Red', '6,300.00']);
    expect(t.rows[1].cells[2].text).toBe('');
    expect(t.totals.map((c) => c.text)).toEqual(['', 'Total', '4', '7', '6,500.00', '', '6,890.00']);
    expect(Math.round(t.columns.reduce((s, c) => s + c.width_pct, 0))).toBe(100);
  });
});

describe('buildSlabSummary', () => {
  it('groups by GST rate and works out the retailer margin from MRP', () => {
    const s = buildSlabSummary([
      line({ quantity: 10, unit_price: '18.00', taxable_value: '180.00', tax_rate: '5.00', tax_amount: '9.00', line_total: '189.00', mrp: 23 }),
      line({ quantity: 2, unit_price: '100.00', taxable_value: '200.00', tax_rate: '18.00', tax_amount: '36.00', line_total: '236.00', mrp: 140 }),
      line({ quantity: 1, unit_price: '50.00', taxable_value: '50.00', tax_rate: '0', tax_amount: '0', line_total: '50.00' }),
    ]);
    expect(s.rows.map((r) => r.tax_rate)).toEqual(['0', '5', '18']);
    expect(s.rows[0].margin).toBe('');
    // 5%: MRP 230 − net 189 = 41, 21.69% of 189
    expect(s.rows[1]).toMatchObject({ pieces: '10', net: '189.00', margin: '41.00', margin_pct: '21.69' });
    // Totals over lines with MRP: 230 + 280 − (189 + 236) = 85, 20.00% of 425
    expect(s.totals).toMatchObject({ pieces: '13', net: '475.00', margin: '85.00', margin_pct: '20.00' });
    expect(s.has_margin).toBe(true);
  });

  it('shows no margin when no line has an MRP', () => {
    expect(buildSlabSummary([line({})]).has_margin).toBe(false);
  });
});
