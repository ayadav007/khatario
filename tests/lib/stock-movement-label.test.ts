import { stockMovementPresentation } from '@/lib/stock-movement-label';

describe('stockMovementPresentation', () => {
  it('names a damage adjustment and links the adjustment', () => {
    expect(
      stockMovementPresentation({
        referenceType: 'adjustment',
        reasonCode: 'DAMAGE',
        documentNumber: 'ADJ-12',
        referenceId: 'adj-1',
      }),
    ).toEqual({
      label: 'Damage',
      documentNumber: 'ADJ-12',
      href: '/inventory-adjustments/adj-1',
    });
  });

  it('names a sale from the invoice number', () => {
    expect(
      stockMovementPresentation({
        referenceType: 'invoice',
        documentNumber: 'INV-9',
        referenceId: 'inv-1',
      }),
    ).toEqual({
      label: 'Sale',
      documentNumber: 'INV-9',
      href: '/invoices/inv-1',
    });
  });

  it('names a purchase', () => {
    expect(
      stockMovementPresentation({
        referenceType: 'purchase',
        documentNumber: 'BILL-3',
        referenceId: 'pur-1',
      }).label,
    ).toBe('Purchase');
  });
});
