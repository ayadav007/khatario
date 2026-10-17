import { debitNoteLineSuppliesGoods } from '@/lib/debit-notes/supply-goods';

describe('debit note stock intent', () => {
  it('treats a goods line without an explicit supply as a price adjustment', () => {
    expect(debitNoteLineSuppliesGoods({ item_id: 'item-1' }, 'goods')).toBe(false);
    expect(debitNoteLineSuppliesGoods({ item_id: null, supply_goods: true }, 'goods')).toBe(false);
    expect(debitNoteLineSuppliesGoods({ item_id: 'item-1', supply_goods: true }, 'service')).toBe(false);
  });

  it('issues stock only when the line says goods were supplied', () => {
    expect(debitNoteLineSuppliesGoods({ item_id: 'item-1', supply_goods: true }, 'goods')).toBe(true);
  });
});
