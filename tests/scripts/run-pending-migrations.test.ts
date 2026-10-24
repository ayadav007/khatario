/* eslint-disable @typescript-eslint/no-var-requires */
const { unwrapExplicitTransaction, parseArgs } = require('../../scripts/run-pending-migrations.js');

describe('run-pending-migrations: transaction framing', () => {
  it('leaves a plain migration untouched', () => {
    expect(unwrapExplicitTransaction('ALTER TABLE x ADD COLUMN y int;')).toBe('ALTER TABLE x ADD COLUMN y int;');
  });

  it('strips one outer BEGIN/COMMIT even after a comment header', () => {
    const sql = '-- header\n-- more\nBEGIN;\nALTER TABLE x ADD COLUMN y int;\nCOMMIT;\n-- trailer\n';
    const out = unwrapExplicitTransaction(sql);
    expect(out).not.toBeNull();
    expect(out).not.toMatch(/^\s*BEGIN\s*;/im);
    expect(out).not.toMatch(/^\s*COMMIT\s*;/im);
    expect(out).toContain('ALTER TABLE x');
  });

  it('refuses a file with a mid-file COMMIT (would commit partially)', () => {
    const sql = 'BEGIN;\nUPDATE a SET b = 1;\nCOMMIT;\nUPDATE c SET d = 2;\nCOMMIT;';
    expect(unwrapExplicitTransaction(sql)).toBeNull();
  });

  it('ignores BEGIN/END inside DO $$ and tagged dollar-quoted bodies', () => {
    const sql = [
      'DO $$',
      'BEGIN',
      '  PERFORM 1;',
      'END $$;',
      'CREATE FUNCTION f() RETURNS void AS $fn$',
      'BEGIN;',
      'END;',
      '$fn$ LANGUAGE plpgsql;',
    ].join('\n');
    expect(unwrapExplicitTransaction(sql)).not.toBeNull();
  });

  it('accept-already-exists is opt-in', () => {
    expect(parseArgs([]).acceptExisting).toBe(false);
    expect(parseArgs(['--accept-already-exists']).acceptExisting).toBe(true);
  });
});
