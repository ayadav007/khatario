import {
  counterSeriesFor,
  peekNextDocumentNumber,
  reserveDocumentNumber,
  reserveFormattedDocumentNumber,
  setNextDocumentNumber,
} from '@/lib/invoices/document-counter';

/** Minimal in-memory stand-in for the tables document-counter touches. */
function fakeDb(opts: { seed?: Record<string, number>; maxUsed?: Record<string, number> } = {}) {
  const counters = new Map<string, number>();
  const branchNext = new Map<string, number>();
  const key = (branchId: string, series: string) => `${branchId}:${series}`;

  return {
    counters,
    branchNext,
    async query(text: string, params: any[] = []) {
      const sql = text.replace(/\s+/g, ' ');
      if (sql.includes('INSERT INTO branch_document_counters') && sql.includes('DO NOTHING')) {
        const [branchId, series] = params;
        if (!counters.has(key(branchId, series))) {
          counters.set(key(branchId, series), opts.seed?.[series] ?? 1);
        }
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO branch_document_counters') && sql.includes('DO UPDATE')) {
        const [branchId, series, value] = params;
        counters.set(key(branchId, series), value);
        return { rows: [] };
      }
      if (sql.startsWith('SELECT next_number FROM branch_document_counters')) {
        const [branchId, series] = params;
        const n = counters.get(key(branchId, series));
        return { rows: n === undefined ? [] : [{ next_number: n }] };
      }
      if (sql.startsWith('UPDATE branch_document_counters')) {
        const [branchId, series, issued] = params;
        const k = key(branchId, series);
        counters.set(k, Math.max(counters.get(k) ?? 1, issued + 1));
        return { rows: [] };
      }
      if (sql.startsWith('UPDATE branches')) {
        const [branchId, value] = params;
        const isGreatest = sql.includes('GREATEST');
        branchNext.set(branchId, isGreatest ? Math.max(branchNext.get(branchId) ?? 1, value + 1) : value);
        return { rows: [] };
      }
      if (sql.includes('FROM branch_document_prefixes')) {
        return { rows: [] };
      }
      if (sql.includes('AS max_used')) {
        const types: string[] = params[1];
        return { rows: [{ max_used: opts.maxUsed?.[types[0]] ?? 0 }] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

const BRANCH = '00000000-0000-0000-0000-000000000001';

describe('document-counter', () => {
  it('maps document types to their series', () => {
    expect(counterSeriesFor('proforma_invoice')).toBe('proforma_invoice');
    expect(counterSeriesFor('bill_of_supply')).toBe('bill_of_supply');
    expect(counterSeriesFor('tax_invoice')).toBe('tax_invoice');
    expect(counterSeriesFor('regular')).toBe('tax_invoice');
    expect(counterSeriesFor(null)).toBe('tax_invoice');
  });

  it('saving an estimate does not advance the tax invoice series', async () => {
    const db = fakeDb();
    expect(await reserveDocumentNumber(db, BRANCH, 'tax_invoice')).toBe(1);
    expect(await reserveDocumentNumber(db, BRANCH, 'proforma_invoice')).toBe(1);
    expect(await reserveDocumentNumber(db, BRANCH, 'proforma_invoice')).toBe(2);
    expect(await reserveDocumentNumber(db, BRANCH, 'tax_invoice')).toBe(2);
    expect(await peekNextDocumentNumber(db, BRANCH, 'tax_invoice')).toBe(3);
    expect(await peekNextDocumentNumber(db, BRANCH, 'proforma_invoice')).toBe(3);
  });

  it('seeds a missing counter from existing history', async () => {
    const db = fakeDb({ seed: { tax_invoice: 8 } });
    expect(await reserveDocumentNumber(db, BRANCH, 'tax_invoice')).toBe(8);
    expect(db.branchNext.get(BRANCH)).toBe(9);
  });

  it('honours a requested number only when it is ahead of the counter', async () => {
    const db = fakeDb({ seed: { tax_invoice: 5 } });
    expect(await reserveDocumentNumber(db, BRANCH, 'tax_invoice', 3)).toBe(5);
    expect(await reserveDocumentNumber(db, BRANCH, 'tax_invoice', 20)).toBe(20);
    expect(await peekNextDocumentNumber(db, BRANCH, 'tax_invoice')).toBe(21);
  });

  it('formats with the default prefix for the series', async () => {
    const db = fakeDb();
    expect(await reserveFormattedDocumentNumber(db, BRANCH, 'tax_invoice')).toBe('INV-001');
    expect(await reserveFormattedDocumentNumber(db, BRANCH, 'proforma_invoice')).toBe('PI-001');
    expect(await reserveFormattedDocumentNumber(db, BRANCH, 'bill_of_supply')).toBe('BOS-001');
  });

  it('settings cannot move a counter below numbers already used', async () => {
    const db = fakeDb({ maxUsed: { tax_invoice: 12 } });
    expect(await setNextDocumentNumber(db, BRANCH, 'tax_invoice', 1)).toBe(13);
    expect(await setNextDocumentNumber(db, BRANCH, 'tax_invoice', 100)).toBe(100);
    expect(db.branchNext.get(BRANCH)).toBe(100);
  });
});
