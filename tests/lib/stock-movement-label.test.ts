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

describe('stockMovementPresentation for repacks', () => {
  it('names both legs after the other item and links the repack', () => {
    expect(
      stockMovementPresentation({
        referenceType: 'adjustment',
        reasonCode: 'REPACK_OUT',
        documentNumber: 'ADJ-4',
        referenceId: 'adj-4',
        repackId: 'rpk-1',
        repackNumber: 'RPK-0001',
        repackOtherItem: 'Rice 1 kg pack',
      }),
    ).toEqual({
      label: 'Repacked into Rice 1 kg pack',
      documentNumber: 'RPK-0001',
      href: '/inventory-adjustments/repacks/rpk-1',
    });
    expect(
      stockMovementPresentation({
        referenceType: 'adjustment',
        reasonCode: 'REPACK_IN',
        referenceId: 'adj-5',
        repackId: 'rpk-1',
        repackOtherItem: 'Rice',
      }).label,
    ).toBe('Repacked from Rice');
  });

  it('names a cancelled repack', () => {
    expect(
      stockMovementPresentation({ referenceType: 'repack_cancel', referenceId: 'rpk-1', repackNumber: 'RPK-0001' }),
    ).toEqual({ label: 'Repack cancelled', documentNumber: 'RPK-0001', href: '/inventory-adjustments/repacks/rpk-1' });
  });
});
