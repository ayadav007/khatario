import { readFileSync } from 'fs';

describe('migration runner', () => {
  const src = readFileSync('scripts/run-pending-migrations.js', 'utf8');

  it('prints database notices with the migration file name, so a skipped rule is visible', () => {
    expect(src).toMatch(/client\.on\('notice'/);
    expect(src).toContain('[migration notice] ');
    expect(src).toMatch(/currentMigrationFile = file/);
  });
});
