import { guessColumns } from '@/lib/import/match-columns';
import { EXPORT_INSTRUCTIONS } from '@/lib/import/presets';
import type { ImportField } from '@/lib/import/types';

const fields: ImportField[] = [
  { key: 'name', label: 'Customer name', type: 'text', required: true, aliases: ['name', 'customer', 'customer name', 'party name', 'party'] },
  { key: 'gstin', label: 'GSTIN', type: 'gstin', aliases: ['gstin', 'gst no', 'gst number'] },
  { key: 'phone', label: 'Phone', type: 'phone', aliases: ['phone', 'mobile', 'contact'] },
];
const base = { fields, sourceApp: 'other' as const, section: 'customers' as const, saved: {} };

test('alias match ignores case and punctuation', () => {
  expect(guessColumns({ ...base, headers: ['PARTY NAME', 'Gst No.'], sampleRows: [] })).toEqual({ 0: 'name', 1: 'gstin' });
});
test('preset beats general alias; saved beats preset', () => {
  expect(guessColumns({ ...base, sourceApp: 'tally', headers: ['Particulars', 'GSTIN/UIN'], sampleRows: [] })).toEqual({ 0: 'name', 1: 'gstin' });
  expect(guessColumns({ ...base, sourceApp: 'tally', headers: ['Particulars'], sampleRows: [], saved: { particulars: 'phone' } })).toEqual({ 0: 'phone' });
});
test('values decide when the header is unknown', () => {
  const rows = [['27AAAPA1234A1Z5', '9876543210'], ['29AAAPA1234A1Z5', '9123456780']];
  expect(guessColumns({ ...base, headers: ['Col A', 'Col B'], sampleRows: rows })).toEqual({ 0: 'gstin', 1: 'phone' });
});
test('unknown column is not imported; a field goes to one column only', () => {
  expect(guessColumns({ ...base, headers: ['Salesman', 'Name', 'Customer'], sampleRows: [] })).toEqual({ 0: null, 1: 'name', 2: null });
});

describe('value-based guessing', () => {
  const phones = ['9876543210', '9123456780', '9988776655', '9812345678'];
  test('empty cells are ignored', () => {
    const rows = [[phones[0]], [''], [phones[1]], ['  '], [phones[2]]];
    expect(guessColumns({ ...base, headers: ['Col A'], sampleRows: rows })).toEqual({ 0: 'phone' });
  });
  test('4 of 5 passes, 3 of 5 does not', () => {
    const four = [...phones, 'abc'].map((v) => [v]);
    expect(guessColumns({ ...base, headers: ['Col A'], sampleRows: four })).toEqual({ 0: 'phone' });
    const three = [phones[0], phones[1], phones[2], 'abc', 'def'].map((v) => [v]);
    expect(guessColumns({ ...base, headers: ['Col A'], sampleRows: three })).toEqual({ 0: null });
  });
  test('a 6-digit PIN column is not guessed as phone or gstin', () => {
    const rows = [['400001'], ['560001'], ['110001']];
    expect(guessColumns({ ...base, headers: ['Col A'], sampleRows: rows })).toEqual({ 0: null });
  });
  test('with no sample rows an unknown header gets null', () => {
    expect(guessColumns({ ...base, headers: ['Mystery'], sampleRows: [] })).toEqual({ 0: null });
  });
});

describe('presets', () => {
  test('a preset entry for a field the section does not have is ignored', () => {
    // Tally maps "PAN/IT No." to pan, which these fields lack.
    expect(guessColumns({ ...base, sourceApp: 'tally', headers: ['PAN/IT No.'], sampleRows: [] })).toEqual({ 0: null });
  });
  test('sourceApp other uses no preset', () => {
    expect(guessColumns({ ...base, headers: ['Particulars', 'GSTIN/UIN'], sampleRows: [] })).toEqual({ 0: null, 1: null });
  });
  test('every app and section has two steps ending with the exact save sentence', () => {
    for (const app of ['tally', 'vyapar', 'zoho_books'] as const) {
      for (const section of ['customers', 'suppliers', 'items'] as const) {
        const steps = EXPORT_INSTRUCTIONS[app][section];
        expect(steps).toHaveLength(2);
        expect(steps[steps.length - 1]).toBe('Save as Excel or CSV, then upload the file here.');
      }
    }
  });
});

describe('tiered assignment', () => {
  test('a saved match on a later column beats an alias on an earlier column', () => {
    expect(
      guessColumns({ ...base, headers: ['Customer', 'X', 'Particulars'], sampleRows: [], saved: { particulars: 'name' } }),
    ).toEqual({ 0: null, 1: null, 2: 'name' });
  });
  test('a preset on a later column beats a general alias on an earlier column', () => {
    expect(guessColumns({ ...base, sourceApp: 'tally', headers: ['Customer', 'Particulars'], sampleRows: [] })).toEqual({ 0: null, 1: 'name' });
  });
  test('a column that loses its alias match falls through to a value match', () => {
    const f: ImportField[] = [fields[0], fields[2]];
    const rows = [['A', '9876543210'], ['B', '9123456780']];
    expect(guessColumns({ ...base, fields: f, headers: ['Name', 'Party Name'], sampleRows: rows })).toEqual({ 0: 'name', 1: 'phone' });
  });
  test('a 6-digit column is guessed as pincode when the section has that field', () => {
    const f: ImportField[] = [...fields, { key: 'pincode', label: 'PIN code', type: 'pincode', aliases: [] }];
    const rows = [['400001'], ['560001'], ['110001']];
    expect(guessColumns({ ...base, fields: f, headers: ['Col A'], sampleRows: rows })).toEqual({ 0: 'pincode' });
  });
  test('a saved entry for a field the section lacks falls through to the alias stage', () => {
    expect(guessColumns({ ...base, headers: ['Party Name'], sampleRows: [], saved: { partyname: 'nonexistent' } })).toEqual({ 0: 'name' });
  });
});
