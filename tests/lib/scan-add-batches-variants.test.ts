import { DEFAULT_OPENING_BATCH_NUMBER, normalizeOpeningBatch } from '@/lib/items/opening-batch';
import { batchErrors, batchPayload, emptyScanAddForm, fillBatch, nameWithoutSize, scanAddItemPayload } from '@/lib/items/scan-add-form';
import { addVariantFingerprint, validateAddVariant } from '@/lib/items/scan-add-variant';

describe('opening batch', () => {
  test('nothing given is no batch', () => {
    expect(normalizeOpeningBatch(null)).toBeNull();
    expect(normalizeOpeningBatch({ batch_number: '  ', expiry_date: '' })).toBeNull();
  });

  test('a month-only expiry runs to the end of that month; a month-only mfg date starts it', () => {
    expect(normalizeOpeningBatch({ batch_number: 'B12', manufacturing_date: '2026-09', expiry_date: '2027-02' })).toEqual({
      batchNumber: 'B12',
      manufacturingDate: '2026-09-01',
      expiryDate: '2027-02-28',
    });
  });

  test('dates without a batch code still make a batch, under a fixed name', () => {
    expect(normalizeOpeningBatch({ expiry_date: '2027-03-31' })).toEqual({
      batchNumber: DEFAULT_OPENING_BATCH_NUMBER,
      manufacturingDate: null,
      expiryDate: '2027-03-31',
    });
  });

  test('impossible dates and expiry before manufacture are refused', () => {
    expect(normalizeOpeningBatch({ expiry_date: '2027-02-30' })).toEqual({ error: expect.any(String) });
    expect(normalizeOpeningBatch({ expiry_date: '31/03/2027' })).toEqual({ error: expect.any(String) });
    expect(normalizeOpeningBatch({ manufacturing_date: '2027-05', expiry_date: '2027-01' })).toEqual({ error: expect.any(String) });
  });
});

describe('batch fields on the form', () => {
  const form = { ...emptyScanAddForm('8901058000016'), name: 'Maggi 70 g', opening_stock: '12', purchase_price: '11' };

  test('a batch is sent only with stock', () => {
    expect(batchPayload({ ...form, expiry_date: '2027-03' })).toEqual({ batch_number: undefined, manufacturing_date: undefined, expiry_date: '2027-03' });
    expect(batchPayload({ ...form, opening_stock: '0', expiry_date: '2027-03' })).toBeUndefined();
    expect(batchPayload(form)).toBeUndefined();
    expect(scanAddItemPayload({ ...form, batch_number: 'L45' }).opening_batch).toEqual(expect.objectContaining({ batch_number: 'L45' }));
  });

  test('date mistakes are caught before saving', () => {
    expect(batchErrors({ manufacturing_date: '09/2026', expiry_date: '' }).manufacturing_date).toBeDefined();
    expect(batchErrors({ manufacturing_date: '2027-05', expiry_date: '2027-01' }).expiry_date).toBeDefined();
    expect(batchErrors({ manufacturing_date: '2026-09', expiry_date: '2027-03-31' })).toEqual({});
  });

  test('the details photo fills only empty batch fields', () => {
    const typed = { ...form, batch_number: 'MINE' };
    expect(fillBatch(typed, { batch_number: 'L45', expiry_date: '2027-03' })).toEqual(expect.objectContaining({ batch_number: 'MINE', expiry_date: '2027-03' }));
  });
});

describe('sizes', () => {
  test('the size leaves the name when sizes become variants', () => {
    expect(nameWithoutSize('Harpic 500 ml', '500 ml')).toBe('Harpic');
    expect(nameWithoutSize('Harpic 500ml', '500 ml')).toBe('Harpic');
    expect(nameWithoutSize('Harpic Blue', '500 ml')).toBe('Harpic Blue');
    expect(nameWithoutSize('500 ml', '500 ml')).toBe('500 ml');
  });

  test('a new size needs a name, and stock needs a purchase price', () => {
    expect(validateAddVariant({ item_id: 'i', variant_name: ' ' })?.code).toBe('VARIANT_NAME_REQUIRED');
    expect(validateAddVariant({ item_id: 'i', variant_name: '75 g', opening_stock: 5 })?.code).toBe('PURCHASE_PRICE_REQUIRED');
    expect(validateAddVariant({ item_id: 'i', variant_name: '75 g', selling_price: -1 })?.code).toBe('INVALID_NUMBER');
    expect(validateAddVariant({ item_id: 'i', variant_name: '75 g', opening_stock: 5, purchase_price: 7 })).toBeNull();
  });

  test('a retry of the same size hashes the same; another quantity does not', () => {
    const a = addVariantFingerprint({ item_id: 'i', variant_name: '75 g', opening_stock: 5, purchase_price: 7 }, null);
    expect(addVariantFingerprint({ item_id: 'i', variant_name: ' 75 g ', opening_stock: '5', purchase_price: '7' }, null).hash).toBe(a.hash);
    expect(addVariantFingerprint({ item_id: 'i', variant_name: '75 g', opening_stock: 6, purchase_price: 7 }, null).hash).not.toBe(a.hash);
  });
});
