import { computeExpenseLineBill } from '@/lib/accounting/expense-lines';
import { expensePostingHash } from '@/lib/accounting/expense-posting';

const item = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Office pen',
  item_type: 'goods' as const,
  unit: 'PCS',
  hsn_sac: '9608',
  is_active: true,
};

const base = {
  businessId: 'b',
  branchId: null,
  categoryId: 'c',
  description: null,
  expenseDate: '2026-10-22',
  paymentMode: 'cash',
  referenceNumber: null,
  settlementAccountId: null,
  itcEligible: true,
  isReverseCharge: false,
  tdsSection: null,
  tdsAmount: 0,
  supplierId: null,
  supplierGstin: null,
  supplyReceivedOn: null,
  supplierRegistrationStatus: 'unknown',
};

describe('expense line totals', () => {
  it('splits an odd GST paisa so CGST and SGST add back to the tax', () => {
    const bill = computeExpenseLineBill({
      pricesIncludeGst: false,
      intraState: true,
      isReverseCharge: false,
      expenseDate: '2026-10-22',
      rows: [{ ...item, quantity: 1, unit_price: '100.05', tax_rate: 18 }],
    });
    expect(bill.lines[0]).toMatchObject({ taxableValue: '100.05', cgst: '9.01', sgst: '9.00', igst: '0.00', lineTotal: '118.06' });
    expect(bill.amount).toBe(118.06);
  });

  it('keeps a reverse-charge bill exclusive of GST and an inclusive rate as the price paid', () => {
    const exclusive = computeExpenseLineBill({
      pricesIncludeGst: false,
      intraState: false,
      isReverseCharge: true,
      expenseDate: '2026-10-22',
      rows: [{ ...item, item_type: 'service', name: 'Legal advice', quantity: 1, unit_price: 10000, tax_rate: 18 }],
    });
    expect(exclusive.amount).toBe(10000);
    expect(exclusive.igst).toBe(1800);

    const inclusive = computeExpenseLineBill({
      pricesIncludeGst: true,
      intraState: true,
      isReverseCharge: false,
      expenseDate: '2026-10-22',
      rows: [{ ...item, quantity: 10, unit_price: 11.8, tax_rate: 18 }],
    });
    expect(inclusive.amount).toBe(118);
    expect(inclusive.lines[0].taxableValue).toBe('100.00');
  });

  it('leaves a header-only expense hash unchanged when lines are omitted', () => {
    const without = expensePostingHash({ ...base, amount: 100, cgst: 0, sgst: 0, igst: 0 });
    const withEmpty = expensePostingHash({ ...base, amount: 100, cgst: 0, sgst: 0, igst: 0, lines: undefined });
    expect(withEmpty).toBe(without);
    const withLines = expensePostingHash({
      ...base,
      amount: 118,
      cgst: 9,
      sgst: 9,
      igst: 0,
      lines: [
        {
          line_no: 1,
          expense_item_id: item.id,
          item_name: item.name,
          item_type: 'goods',
          quantity: '10.000',
          unit_price: '10.00',
          tax_rate: '18.00',
          taxable: '100.00',
          cgst: '9.00',
          sgst: '9.00',
          igst: '0.00',
          line_total: '118.00',
        },
      ],
      pricesIncludeGst: false,
    });
    expect(withLines).not.toBe(without);
  });
});
