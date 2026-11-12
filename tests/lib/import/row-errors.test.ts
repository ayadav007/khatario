import { rowFailureReason } from '@/lib/import/row-errors';

const pgError = (fields: Record<string, string>) => Object.assign(new Error(fields.message ?? 'db error'), fields);

describe('rowFailureReason', () => {
  test('a barcode unique violation on items names the barcode', () => {
    const e = pgError({ code: '23505', table: 'items', constraint: 'idx_items_barcode_business_unique' });
    expect(rowFailureReason(e)).toBe('Barcode is already used by another item (it may be deleted).');
  });

  test('another unique violation names the column from the key', () => {
    const e = pgError({
      code: '23505',
      table: 'customers',
      constraint: 'uq_customers_business_email_active',
      detail: 'Key (business_id, lower(TRIM(BOTH FROM email)))=(1, a@b.c) already exists.',
    });
    expect(rowFailureReason(e)).toBe('Already exists (duplicate email).');
  });

  test('a unique violation without a readable key says value', () => {
    expect(rowFailureReason(pgError({ code: '23505' }))).toBe('Already exists (duplicate value).');
  });

  test('a value too long names the column when the error carries it', () => {
    expect(rowFailureReason(pgError({ code: '22001', column: 'hsn_sac' }))).toBe('hsn_sac is too long.');
    expect(rowFailureReason(pgError({ code: '22001' }))).toBe('A value is too long.');
  });

  test('other data and integrity errors give a short message without SQL', () => {
    const e = pgError({ code: '22003', message: 'numeric field overflow' });
    expect(rowFailureReason(e)).toBe('Could not be saved: numeric field overflow');
    const long = pgError({ code: '23514', message: 'x'.repeat(500) });
    expect(rowFailureReason(long)!.length).toBeLessThanOrEqual(140);
  });

  test('connection, resource and internal errors are not row failures', () => {
    for (const code of ['08006', '53300', '57P01', 'XX000', '40001']) {
      expect(rowFailureReason(pgError({ code }))).toBeNull();
    }
    expect(rowFailureReason(new Error('database went away'))).toBeNull();
    expect(rowFailureReason(Object.assign(new Error('reset'), { code: 'ECONNRESET' }))).toBeNull();
    expect(rowFailureReason('not an error')).toBeNull();
  });
});
