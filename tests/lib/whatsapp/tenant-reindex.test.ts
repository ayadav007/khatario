/**
 * Tenant re-index target: keyword-only, scoped to one business, and a load error never deletes
 * the shop's live knowledge.
 */
const mockIndexSource = jest.fn();
const mockRemoveTenant = jest.fn();
const mockCatalog = jest.fn();
const mockPolicy = jest.fn();

jest.mock('@/lib/db', () => ({ query: jest.fn(), queryOne: jest.fn(), queryRows: jest.fn().mockResolvedValue([]), getPool: jest.fn() }));
jest.mock('@/lib/rag/ingest/indexer', () => ({
  indexSource: (...a: unknown[]) => mockIndexSource(...a),
  removeStaleSources: jest.fn().mockResolvedValue([]),
  removeStaleTenantSources: (...a: unknown[]) => mockRemoveTenant(...a),
}));
jest.mock('@/lib/rag/ingest/tenant-sources', () => ({
  loadTenantCatalogSource: (...a: unknown[]) => mockCatalog(...a),
  loadTenantPolicySource: (...a: unknown[]) => mockPolicy(...a),
}));

import { reindex } from '@/lib/rag/ingest/run';

const BIZ = '11111111-1111-4111-8111-111111111111';
const doc = { docKey: 'x', title: 'x', audiences: ['tenant_customer'], locale: 'en', tags: [], body: 'x' };

beforeEach(() => {
  jest.clearAllMocks();
  mockIndexSource.mockImplementation(async (s: { kind: string; locator: string }) => ({ kind: s.kind, locator: s.locator, status: 'indexed', documents: 1, chunks: 1, embedded: 0, reusedEmbeddings: 0 }));
  mockRemoveTenant.mockResolvedValue([]);
});

it('needs a business id', async () => {
  const report = await reindex({ target: 'tenant' });
  expect(report.errors[0]).toContain('businessId');
  expect(mockCatalog).not.toHaveBeenCalled();
});

it('indexes catalog and policies keyword-only for that business', async () => {
  mockCatalog.mockResolvedValue({ kind: 'tenant_catalog', locator: 'catalog', audiences: ['tenant_customer'], businessId: BIZ, documents: [doc] });
  mockPolicy.mockResolvedValue({ kind: 'tenant_policy', locator: 'policies', audiences: ['tenant_customer'], businessId: BIZ, documents: [doc] });
  const report = await reindex({ target: 'tenant', businessId: BIZ });
  expect(report.errors).toEqual([]);
  expect(mockIndexSource).toHaveBeenCalledTimes(2);
  for (const [, opts] of mockIndexSource.mock.calls) expect(opts.keywordOnly).toBe(true);
  expect(mockRemoveTenant).toHaveBeenCalledWith(BIZ, ['tenant_catalog', 'tenant_policy'], ['tenant_catalog:catalog', 'tenant_policy:policies'], undefined);
});

it('removes an emptied catalog but keeps everything when a load fails', async () => {
  mockCatalog.mockResolvedValue({ kind: 'tenant_catalog', locator: 'catalog', audiences: ['tenant_customer'], businessId: BIZ, documents: [] });
  mockPolicy.mockResolvedValue({ kind: 'tenant_policy', locator: 'policies', audiences: ['tenant_customer'], businessId: BIZ, documents: [doc] });
  await reindex({ target: 'tenant', businessId: BIZ });
  expect(mockRemoveTenant).toHaveBeenCalledWith(BIZ, expect.any(Array), ['tenant_policy:policies'], undefined);

  mockRemoveTenant.mockClear();
  mockCatalog.mockRejectedValue(new Error('db down'));
  const report = await reindex({ target: 'tenant', businessId: BIZ });
  expect(report.errors.some((e) => e.includes('catalog'))).toBe(true);
  expect(mockRemoveTenant).not.toHaveBeenCalled();
});

it("'all' never touches shop knowledge", async () => {
  await reindex({ target: 'all', dryRun: true }).catch(() => undefined);
  expect(mockCatalog).not.toHaveBeenCalled();
  expect(mockPolicy).not.toHaveBeenCalled();
});
