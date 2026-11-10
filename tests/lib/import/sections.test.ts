// The sections import the services, which load the session helpers (ESM `jose`); none run here.
jest.mock('@/lib/jwt', () => ({}));
jest.mock('@/lib/platform-jwt', () => ({}));
jest.mock('@/lib/customers/create-customer', () => ({
  ...jest.requireActual('@/lib/customers/create-customer'),
  createCustomer: jest.fn(),
}));

import { SECTIONS, buildRow, VALUE_CHOICES } from '@/lib/import/sections';
import { referenceColumnsFrom } from '@/lib/import/record-usage';
import type { ColumnMatches } from '@/lib/import/types';
import { createCustomer, CustomerAccessRefused } from '@/lib/customers/create-customer';
import { EnforceAccessError } from '@/lib/enforce-access';

const opts = { dateOrder: 'dmy' as const, valueMatches: {} as Record<string, Record<string, string>> };

describe('buildRow (customers)', () => {
  const headers = ['Name', 'GSTIN/UIN', 'Mobile', 'State'];
  const matches: ColumnMatches = { 0: 'name', 1: 'gstin', 2: 'phone', 3: 'state' };
  const build = (cells: string[], o = opts) => buildRow(SECTIONS.customers, cells, headers, matches, o);

  test('a clean row is ready with parsed values', () => {
    const r = build(['Sharma Traders', '27aaapa1234a1zt', '+91 98765 43210', 'Maharashtra']);
    expect(r.issues).toEqual([]);
    expect(r.unmatched).toEqual([]);
    expect(r.values).toMatchObject({
      name: 'Sharma Traders',
      gstin: '27AAAPA1234A1ZT',
      phone: '9876543210',
      state: 'Maharashtra',
    });
  });

  test('a bad GSTIN is an error naming the column header', () => {
    const r = build(['Sharma Traders', '27BAD', '', '']);
    expect(r.issues).toEqual([
      { field: 'gstin', level: 'error', message: '"GSTIN/UIN" is not a valid GSTIN: 27BAD' },
    ]);
  });

  test('a bad phone is a warning and the phone is dropped', () => {
    const r = build(['Sharma Traders', '', 'n/a', '']);
    expect(r.values.phone).toBeNull();
    expect(r.issues).toEqual([
      { field: 'phone', level: 'warning', message: 'Imported without phone: "n/a" is not a valid number' },
    ]);
  });

  test('state MH resolves to Maharashtra', () => {
    const r = build(['Sharma Traders', '', '', 'MH']);
    expect(r.values.state).toBe('Maharashtra');
    expect(r.issues).toEqual([]);
  });

  test('an unknown state is unmatched until the user chooses', () => {
    const r = build(['Sharma Traders', '', '', 'Bombay State']);
    expect(r.unmatched).toEqual([{ field: 'state', value: 'Bombay State' }]);
    expect(r.issues.map((i) => i.level)).toEqual(['error']);
    const chosen = build(['Sharma Traders', '', '', 'Bombay State'], {
      ...opts,
      valueMatches: { state: { bombaystate: 'Maharashtra' } },
    });
    expect(chosen.values.state).toBe('Maharashtra');
    expect(chosen.issues).toEqual([]);
  });

  test('an empty name is an error', () => {
    const r = build(['  ', '', '', '']);
    expect(r.values.name).toBeNull();
    expect(r.issues).toEqual([{ field: 'name', level: 'error', message: '"Name" is empty' }]);
  });

  test('a required field with no matched column is named by its label', () => {
    const r = buildRow(SECTIONS.customers, ['x'], ['Mobile'], { 0: 'phone' }, opts);
    expect(r.issues).toContainEqual({ field: 'name', level: 'error', message: '"Customer name" is empty' });
  });

  test('columns matched to a field the section does not have are ignored', () => {
    const r = buildRow(SECTIONS.customers, ['Sharma', 'AAAPA1234A'], ['Name', 'PAN'], { 0: 'name', 1: 'pan' }, opts);
    expect(r.values).not.toHaveProperty('pan');
    expect(r.issues).toEqual([]);
  });

  test('an amount that does not parse is an error', () => {
    const r = buildRow(SECTIONS.customers, ['Sharma', 'lots'], ['Name', 'Limit'], { 0: 'name', 1: 'credit_limit' }, opts);
    expect(r.issues).toEqual([{ field: 'credit_limit', level: 'error', message: '"Limit" is not a valid amount: lots' }]);
    const ok = buildRow(SECTIONS.customers, ['Sharma', '₹ 1,500'], ['Name', 'Limit'], { 0: 'name', 1: 'credit_limit' }, opts);
    expect(ok.values.credit_limit).toBe(1500);
  });

  test('duplicateKeys normalises GSTIN, phone and name', () => {
    const keys = SECTIONS.customers.duplicateKeys({
      gstin: '27aaapa1234a1z5',
      phone: '+91 98765 43210',
      name: 'Sharma  Traders',
    });
    expect(keys).toContain('gstin:27AAAPA1234A1Z5');
    expect(keys).toContain('phone:9876543210');
    expect(keys).toContain('name:sharmatraders');
  });
});

describe('buildRow (items)', () => {
  const headers = ['Item', 'UOM', 'GST %', 'Opening'];
  const matches: ColumnMatches = { 0: 'name', 1: 'unit', 2: 'tax_rate', 3: 'opening_stock' };

  test('unit Bndl is unmatched, then resolves once the user picks BOX', () => {
    const r = buildRow(SECTIONS.items, ['Tea', 'Bndl', '5%', '10'], headers, matches, opts);
    expect(r.unmatched).toEqual([{ field: 'unit', value: 'Bndl' }]);
    expect(r.issues.some((i) => i.level === 'error' && i.field === 'unit')).toBe(true);
    const chosen = buildRow(SECTIONS.items, ['Tea', 'Bndl', '5%', '10'], headers, matches, {
      ...opts,
      valueMatches: { unit: { bndl: 'BOX' } },
    });
    expect(chosen.unmatched).toEqual([]);
    expect(chosen.issues).toEqual([]);
    expect(chosen.values).toMatchObject({ unit: 'BOX', tax_rate: 5, opening_stock: 10 });
  });

  test('a number that does not parse is an error', () => {
    const r = buildRow(SECTIONS.items, ['Tea', 'pcs', '5', 'ten'], headers, matches, opts);
    expect(r.issues).toEqual([{ field: 'opening_stock', level: 'error', message: '"Opening" is not a valid number: ten' }]);
  });

  test('an HSN longer than its 10-character column is an error naming the header', () => {
    const r = buildRow(SECTIONS.items, ['Tea', '12345678901'], ['Item', 'HSN Code'], { 0: 'name', 1: 'hsn_sac' }, opts);
    expect(r.issues).toEqual([{ field: 'hsn_sac', level: 'error', message: '"HSN Code" is longer than 10 characters' }]);
    const ok = buildRow(SECTIONS.items, ['Tea', '0902'], ['Item', 'HSN Code'], { 0: 'name', 1: 'hsn_sac' }, opts);
    expect(ok.issues).toEqual([]);
  });

  test('every text field has a maximum length taken from its column', () => {
    const lengthOf = (section: keyof typeof SECTIONS, key: string) =>
      SECTIONS[section].fields.find((f) => f.key === key)?.maxLength;
    expect(lengthOf('items', 'hsn_sac')).toBe(10);
    expect(lengthOf('items', 'name')).toBe(255);
    expect(lengthOf('items', 'code')).toBe(100);
    expect(lengthOf('items', 'barcode')).toBe(100);
    expect(lengthOf('customers', 'city')).toBe(100);
    expect(lengthOf('customers', 'pincode')).toBe(10);
    expect(lengthOf('suppliers', 'pan')).toBe(10);
    expect(lengthOf('suppliers', 'email')).toBe(255);
  });

  test('duplicateKeys uses code, barcode and name', () => {
    expect(SECTIONS.items.duplicateKeys({ code: 'T-01', barcode: '890123', name: 'Green  Tea' })).toEqual([
      'code:t-01',
      'barcode:890123',
      'name:greentea',
    ]);
  });

  test('choices offered for unmatched values', () => {
    expect(VALUE_CHOICES.tax_rate).toEqual(['0', '0.25', '3', '5', '12', '18', '28']);
    expect(VALUE_CHOICES.unit).toContain('BOX');
    expect(VALUE_CHOICES.state).toContain('Maharashtra');
    expect(VALUE_CHOICES.state).not.toContain('Other Territory');
  });
});

describe('checkRow (service rules at preview)', () => {
  test('customers: a GSTIN registered in another state than the State column is an error', () => {
    const r = buildRow(SECTIONS.customers, ['Sharma Traders', '27AAAPA1234A1ZT', 'Karnataka'], ['Name', 'GSTIN', 'State'], { 0: 'name', 1: 'gstin', 2: 'state' }, opts);
    expect(r.issues).toEqual([
      {
        field: 'gstin',
        level: 'error',
        message: 'This GSTIN is registered in Maharashtra (27). Change the GSTIN or the state so the first two digits match the address.',
      },
    ]);
    const same = buildRow(SECTIONS.customers, ['Sharma Traders', '27AAAPA1234A1ZT', 'MH'], ['Name', 'GSTIN', 'State'], { 0: 'name', 1: 'gstin', 2: 'state' }, opts);
    expect(same.issues).toEqual([]);
  });

  const supplierHeaders = ['Name', 'GSTIN', 'State', 'PAN'];
  const supplierMatches: ColumnMatches = { 0: 'name', 1: 'gstin', 2: 'state', 3: 'pan' };
  const supplier = (cells: string[]) => buildRow(SECTIONS.suppliers, cells, supplierHeaders, supplierMatches, opts);

  test('suppliers: the GSTIN and State must agree', () => {
    expect(supplier(['Patil', '27AAAPA1234A1ZT', 'Goa', '']).issues.map((i) => [i.field, i.level])).toEqual([['gstin', 'error']]);
  });

  test('suppliers: a malformed PAN is an error with the service message', () => {
    expect(supplier(['Patil', '', '', 'ABC12']).issues).toEqual([
      { field: 'pan', level: 'error', message: 'Invalid PAN "ABC12". Expected format: ABCDE1234F' },
    ]);
  });

  test('suppliers: a PAN that differs from the PAN inside the GSTIN is an error', () => {
    expect(supplier(['Patil', '27AAAPA1234A1ZT', '', 'BBBPB5678B']).issues).toEqual([
      { field: 'pan', level: 'error', message: 'PAN BBBPB5678B does not match the PAN inside GSTIN (AAAPA1234A).' },
    ]);
    expect(supplier(['Patil', '27AAAPA1234A1ZT', '', 'aaapa1234a']).issues).toEqual([]);
  });

  test('suppliers: an empty name is reported once, by the required check', () => {
    expect(supplier(['', '', '', '']).issues).toEqual([{ field: 'name', level: 'error', message: '"Name" is empty' }]);
  });
});

describe('section fields', () => {
  test('name is required in all three sections', () => {
    for (const def of Object.values(SECTIONS)) {
      expect(def.fields.find((f) => f.key === 'name')?.required).toBe(true);
    }
  });
  test('suppliers have pan, customers do not', () => {
    expect(SECTIONS.suppliers.fields.map((f) => f.key)).toContain('pan');
    expect(SECTIONS.customers.fields.map((f) => f.key)).not.toContain('pan');
  });
});

describe('referenceColumnsFrom', () => {
  const fk = (o: Partial<Parameters<typeof referenceColumnsFrom>[0][number]>) => ({
    table_schema: 'public',
    table_name: 'invoices',
    ref_schema: 'public',
    ref_table: 'customers',
    columns: ['customer_id'],
    ref_columns: ['id'],
    ...o,
  });

  test('keeps only keys that point at public customers, suppliers or items', () => {
    const map = referenceColumnsFrom([
      fk({}),
      fk({ ref_schema: 'archive', table_name: 'old_invoices' }),
      fk({ ref_table: 'customer_groups', table_name: 'customers', columns: ['group_id'] }),
    ]);
    expect(map.customers).toEqual([{ schema: 'public', table: 'invoices', columns: ['customer_id'] }]);
    expect(map.suppliers).toEqual([]);
    expect(map.items).toEqual([]);
  });

  test('a composite key uses the column that points at id', () => {
    const map = referenceColumnsFrom([
      fk({ table_name: 'item_links', ref_table: 'items', columns: ['business_id', 'item_id'], ref_columns: ['business_id', 'id'] }),
      fk({ table_name: 'odd', ref_table: 'items', columns: ['code'], ref_columns: ['code'] }),
    ]);
    expect(map.items).toEqual([{ schema: 'public', table: 'item_links', columns: ['item_id'] }]);
  });

  test('two keys from one table are merged; self-references and import_run_records are left out', () => {
    const map = referenceColumnsFrom([
      fk({ table_name: 'bundle_items', ref_table: 'items', columns: ['bundle_id'] }),
      fk({ table_name: 'bundle_items', ref_table: 'items', columns: ['item_id'] }),
      fk({ table_name: 'items', ref_table: 'items', columns: ['parent_item_id'] }),
      fk({ table_name: 'import_run_records', ref_table: 'items', columns: ['record_id'] }),
    ]);
    expect(map.items).toEqual([{ schema: 'public', table: 'bundle_items', columns: ['bundle_id', 'item_id'] }]);
  });
});

describe('saveRow access refusals', () => {
  const ctx = { businessId: 'b', userId: 'u' };
  const create = createCustomer as jest.MockedFunction<typeof createCustomer>;

  test('a plan or limit refusal is a row failure carrying its message', async () => {
    create.mockRejectedValueOnce(
      new CustomerAccessRefused(new EnforceAccessError(403, 'SUBSCRIPTION_LIMIT_EXCEEDED', 'Limit reached'))
    );
    await expect(SECTIONS.customers.saveRow(ctx, { name: 'A' })).resolves.toEqual({ ok: false, error: 'Limit reached' });
  });

  test('a refusal with no message reads as the plan sentence', async () => {
    create.mockRejectedValueOnce(new CustomerAccessRefused(new EnforceAccessError(403, 'NO_SUBSCRIPTION', '')));
    await expect(SECTIONS.customers.saveRow(ctx, { name: 'A' })).resolves.toEqual({
      ok: false,
      error: 'Your plan does not allow adding more customers',
    });
  });

  test('an outage inside the access check is thrown, not reported as a row problem', async () => {
    const outage = new Error('connection terminated');
    create.mockRejectedValueOnce(new CustomerAccessRefused(outage));
    await expect(SECTIONS.customers.saveRow(ctx, { name: 'A' })).rejects.toBe(outage);
  });
});

describe('undoRecords batch size', () => {
  test('more than 500 ids is refused before touching the database', async () => {
    const ids = Array.from({ length: 501 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    await expect(SECTIONS.customers.undoRecords({ businessId: 'b', userId: 'u' }, ids)).rejects.toThrow(
      'Undo takes at most 500 records per call (got 501)'
    );
  });
});
