jest.mock('@/lib/queue/redis', () => ({ getRedisConnection: () => null }));

import { MIGRATION_DATABASE, MigrationRefusedError, migrationDatabaseAllowed, migrationExitCode } from '@/lib/store/engine/migrate-runner';

describe('migration database guard (D34)', () => {
  it('allows only the test database unless another is named exactly', () => {
    expect(MIGRATION_DATABASE).toBe('kh_phase2_test');
    expect(migrationDatabaseAllowed('kh_phase2_test', null)).toBe(true);
    expect(migrationDatabaseAllowed('khatario', null)).toBe(false);
    expect(migrationDatabaseAllowed('khatario', 'khatario')).toBe(true);
    expect(migrationDatabaseAllowed('khatario', 'kh_phase2_test')).toBe(false);
    expect(migrationDatabaseAllowed('khatario', '')).toBe(false);
  });

  it('is case and whitespace exact', () => {
    expect(migrationDatabaseAllowed('khatario', 'Khatario')).toBe(false);
    expect(migrationDatabaseAllowed('khatario', ' khatario')).toBe(false);
    expect(migrationDatabaseAllowed('', '')).toBe(false);
  });

  it('MigrationRefusedError is an Error with its own name', () => {
    const e = new MigrationRefusedError('no');
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(MigrationRefusedError);
    expect(e.name).toBe('MigrationRefusedError');
  });
});

describe('migrationExitCode', () => {
  it('is 1 when a business failed or an explicit id was not found, else 0', () => {
    expect(migrationExitCode([], true)).toBe(0);
    expect(migrationExitCode([{ status: 'migrated' }, { status: 'skipped_live' }, { status: 'would_migrate' }], true)).toBe(0);
    expect(migrationExitCode([{ status: 'migrated' }, { status: 'not_found' }], true)).toBe(1);
    expect(migrationExitCode([{ status: 'failed' }], true)).toBe(1);
    expect(migrationExitCode([{ status: 'failed' }], false)).toBe(1);
    // Under --all a business that vanished mid-run is not the operator's typo.
    expect(migrationExitCode([{ status: 'not_found' }], false)).toBe(0);
  });
});
