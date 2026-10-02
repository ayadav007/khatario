import {
  canConvertToInvoice,
  canTransition,
  computeWorkOrderCosts,
  isWorkOrderEditable,
} from '@/lib/work-orders/work-order-math';
import { buildWorkOrderInvoiceLines } from '@/lib/work-orders/work-order';
import { toDateInputValue } from '@/lib/date-input';

describe('computeWorkOrderCosts', () => {
  it('totals materials, labour and other charges, ignoring blank rows', () => {
    const { lines, costs } = computeWorkOrderCosts(
      [
        { item_name: 'Copper pipe', qty: 3, unit_price: 120.5, tax_rate: 18 },
        { item_name: 'Gas refill', qty: '1', unit_price: '850', tax_rate: 18 },
        { item_name: '', qty: 2, unit_price: 10 },
        { item_name: 'Zero qty', qty: 0, unit_price: 10 },
      ],
      '1500',
      200
    );
    expect(lines.map((l) => l.total_cost)).toEqual([361.5, 850]);
    expect(costs).toEqual({ labor_cost: 1500, material_cost: 1211.5, other_cost: 200, total_cost: 2911.5 });
  });

  it('clamps negative amounts to zero', () => {
    const { costs } = computeWorkOrderCosts([{ item_name: 'X', qty: 1, unit_price: -5 }], -100, 'abc');
    expect(costs).toEqual({ labor_cost: 0, material_cost: 0, other_cost: 0, total_cost: 0 });
  });
});

describe('work order status rules', () => {
  it('follows draft → scheduled → in progress → completed', () => {
    expect(canTransition('draft', 'scheduled')).toBe(true);
    expect(canTransition('draft', 'in_progress')).toBe(true);
    expect(canTransition('scheduled', 'in_progress')).toBe(true);
    expect(canTransition('in_progress', 'completed')).toBe(true);
    expect(canTransition('draft', 'completed')).toBe(false);
    expect(canTransition('completed', 'cancelled')).toBe(false);
    expect(canTransition('cancelled', 'draft')).toBe(false);
  });

  it('locks completed and cancelled work orders', () => {
    expect(isWorkOrderEditable('in_progress')).toBe(true);
    expect(isWorkOrderEditable('completed')).toBe(false);
    expect(isWorkOrderEditable('cancelled')).toBe(false);
  });

  it('invoices only completed work orders, once', () => {
    expect(canConvertToInvoice({ status: 'completed', converted_invoice_id: null })).toBe(true);
    expect(canConvertToInvoice({ status: 'completed', converted_invoice_id: 'inv-1' })).toBe(false);
    expect(canConvertToInvoice({ status: 'in_progress', converted_invoice_id: null })).toBe(false);
  });
});

describe('buildWorkOrderInvoiceLines', () => {
  const wo = {
    work_order_number: 'WO-007',
    work_description: 'AC servicing',
    labor_cost: '1500.00',
    other_cost: '200.00',
    labor_sac: '998719',
    labor_tax_rate: '18.00',
  };

  it('bills materials, then labour and other charges as service lines', () => {
    const lines = buildWorkOrderInvoiceLines(wo, [
      { item_id: 'i1', item_name: 'Copper pipe', qty: '3', used_qty: '0', unit: 'MTR', unit_price: '120.50', tax_rate: '18' },
      { item_id: 'i2', item_name: 'Filter', qty: '2', used_qty: '1', unit: 'PCS', unit_price: '300', tax_rate: '18' },
    ]);
    expect(lines).toHaveLength(4);
    expect(lines[0]).toMatchObject({ item_id: 'i1', quantity: '3' });
    expect(lines[1]).toMatchObject({ item_id: 'i2', quantity: '1' });
    expect(lines[2]).toMatchObject({ item_name: 'Labour charges', hsn_sac: '998719', unit_price: '1500.00', tax_rate: '18.00' });
    expect(lines[2].description).toContain('WO-007');
    expect(lines[3]).toMatchObject({ item_name: 'Other charges', unit_price: '200.00' });
  });

  it('skips labour and other lines when they are zero', () => {
    const lines = buildWorkOrderInvoiceLines({ ...wo, labor_cost: '0', other_cost: null }, []);
    expect(lines).toEqual([]);
  });
});

describe('toDateInputValue', () => {
  it('keeps plain dates and converts timestamps to the local calendar day', () => {
    expect(toDateInputValue('2026-10-02')).toBe('2026-10-02');
    expect(toDateInputValue(null)).toBe('');
    const local = new Date(2026, 9, 2);
    expect(toDateInputValue(local.toISOString())).toBe('2026-10-02');
  });
});
