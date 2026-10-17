/**
 * A debit note in the product UI is an upward price or tax adjustment.
 * Stock moves only when the caller explicitly says goods were supplied.
 * A goods catalogue id alone is not that statement.
 */

export function debitNoteLineSuppliesGoods(line: {
  item_id?: string | null;
  supply_goods?: boolean;
}, itemType: string | null | undefined): boolean {
  return line.supply_goods === true && Boolean(line.item_id) && (itemType || 'goods') === 'goods';
}
