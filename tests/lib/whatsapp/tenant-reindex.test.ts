/**
 * Tenant re-index target: keyword-only, scoped to one business, and a load error never deletes
 * the shop's live knowledge.
 */
const mockIndexSource = jest.fn();
const mockRemoveTenant = jest.fn();
const mockCatalog = jest.fn();
const mockPolicy = jest.fn();
const mockFaq = jest.fn();
const mockText = jest.fn();
const mockFile = jest.fn();

jest.mock('@/lib/db', () => ({ query: jest.fn(), queryOne: jest.fn(), queryRows: jest.fn().mockResolvedValue([]), getPool: jest.fn() }));
jest.mock('@/lib/rag/ingest/indexer', () => ({
  indexSource: (...a: unknown[]) => mockIndexSource(...a),
  removeStaleSources: jest.fn().mockResolvedValue([]),
  removeStaleTenantSources: (...a: unknown[]) => mockRemoveTenant(...a),
}));
jest.mock('@/lib/rag/ingest/tenant-sources', () => ({
  loadTenantCatalogSource: (...a: unknown[]) => mockCatalog(...a),
  loadTenantPolicySource: (...a: unknown[]) => mockPolicy(...a),
  loadTenantFaqSource: (...a: unknown[]) => mockFaq(...a),
  loadTenantTextSource: (...a: unknown[]) => mockText(...a),
  loadTenantFileSource: (...a: unknown[]) => mockFile(...a),
}));

import { reindex } from '@/lib/rag/ingest/run';
import { TENANT_SOURCE_KINDS } from '@/lib/rag/types';

const BIZ = '11111111-1111-4111-8111-111111111111';
const doc = { docKey: 'x', title: 'x', audiences: ['tenant_customer'], locale: 'en', tags: [], body: 'x' };
const src = (kind: string, locator: string, documents: unknown[] = [doc]) => ({
  kind,
  locator,
  audiences: ['tenant_customer'],
  businessId: BIZ,
  documents,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockIndexSource.mockImplementation(async (s: { kind: string; locator: string }) => ({ kind: s.kind, locator: s.locator, status: 'indexed', documents: 1, chunks: 1, embedded: 0, reusedEmbeddings: 0 }));
  mockRemoveTenant.mockResolvedValue([]);
  mockFaq.mockResolvedValue(src('tenant_faq', 'faqs', []));
  mockText.mockResolvedValue(src('tenant_text', 'notes', []));
  mockFile.mockResolvedValue(src('tenant_file', 'files', []));
});

it('needs a business id', async () => {
  const report = await reindex({ target: 'tenant' });
  expect(report.errors[0]).toContain('businessId');
  expect(mockCatalog).not.toHaveBeenCalled();
});

it('indexes catalog and policies keyword-only for that business', async () => {
  mockCatalog.mockResolvedValue(src('tenant_catalog', 'catalog'));
  mockPolicy.mockResolvedValue(src('tenant_policy', 'policies'));
  const report = await reindex({ target: 'tenant', businessId: BIZ });
  expect(report.errors).toEqual([]);
  expect(mockIndexSource).toHaveBeenCalledTimes(2);
  for (const [, opts] of mockIndexSource.mock.calls) expect(opts.keywordOnly).toBe(true);
  expect(mockRemoveTenant).toHaveBeenCalledWith(BIZ, [...TENANT_SOURCE_KINDS], ['tenant_catalog:catalog', 'tenant_policy:policies'], undefined);
});

it("indexes the owner's FAQs, notes and files alongside the catalog", async () => {
  mockCatalog.mockResolvedValue(src('tenant_catalog', 'catalog'));
  mockPolicy.mockResolvedValue(src('tenant_policy', 'policies', []));
  mockFaq.mockResolvedValue(src('tenant_faq', 'faqs'));
  mockText.mockResolvedValue(src('tenant_text', 'notes'));
  mockFile.mockResolvedValue(src('tenant_file', 'files'));
  await reindex({ target: 'tenant', businessId: BIZ });
  for (const loader of [mockFaq, mockText, mockFile]) expect(loader).toHaveBeenCalledWith(BIZ);
  expect(mockRemoveTenant).toHaveBeenCalledWith(
    BIZ,
    [...TENANT_SOURCE_KINDS],
    ['tenant_catalog:catalog', 'tenant_faq:faqs', 'tenant_text:notes', 'tenant_file:files'],
    undefined,
  );
});

it('removes an emptied catalog but keeps everything when a load fails', async () => {
  mockCatalog.mockResolvedValue(src('tenant_catalog', 'catalog', []));
  mockPolicy.mockResolvedValue(src('tenant_policy', 'policies'));
  await reindex({ target: 'tenant', businessId: BIZ });
  expect(mockRemoveTenant).toHaveBeenCalledWith(BIZ, expect.any(Array), ['tenant_policy:policies'], undefined);

  mockRemoveTenant.mockClear();
  mockCatalog.mockRejectedValue(new Error('db down'));
  const report = await reindex({ target: 'tenant', businessId: BIZ });
  expect(report.errors.some((e) => e.includes('catalog'))).toBe(true);
  expect(mockRemoveTenant).not.toHaveBeenCalled();

  mockRemoveTenant.mockClear();
  mockCatalog.mockResolvedValue(src('tenant_catalog', 'catalog'));
  mockFaq.mockRejectedValue(new Error('db down'));
  await reindex({ target: 'tenant', businessId: BIZ });
  expect(mockRemoveTenant).not.toHaveBeenCalled();
});

it("'all' never touches shop knowledge", async () => {
  await reindex({ target: 'all', dryRun: true }).catch(() => undefined);
  expect(mockCatalog).not.toHaveBeenCalled();
  expect(mockPolicy).not.toHaveBeenCalled();
  expect(mockFaq).not.toHaveBeenCalled();
});
