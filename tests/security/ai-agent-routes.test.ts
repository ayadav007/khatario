/**
 * Shop AI agent APIs: every handler sits behind the WhatsApp premium guard (session, business
 * membership, subscription, add-on), writes need `update`, the business comes from that guard
 * only, and handlers reject bad ids, file types and sizes before doing any work.
 */
import fs from 'fs';
import path from 'path';

const BIZ = '11111111-1111-4111-8111-111111111111';
const USER = '44444444-4444-4444-8444-444444444444';
const ITEM = '33333333-3333-4333-8333-333333333333';

const mockGetKnowledge = jest.fn();
const mockCountKnowledge = jest.fn();
const mockCreateKnowledge = jest.fn();
const mockSaveProvider = jest.fn();
const mockLoadProviderSummary = jest.fn();
const mockKhatarioAccess = jest.fn();
const mockPause = jest.fn();
const mockResume = jest.fn();
const mockResolveConv = jest.fn();

jest.mock('@/lib/security/premium-module-api', () => ({
  withWhatsAppPremiumApi:
    (opts: { parseJsonBody?: boolean }, handler: (ctx: unknown) => Promise<Response>) =>
    async (request: Request, route?: { params?: Record<string, string> }) =>
      handler({
        request,
        businessId: BIZ,
        userId: USER,
        params: route?.params ?? {},
        body: opts.parseJsonBody ? await request.json().catch(() => ({})) : undefined,
      }),
}));
jest.mock('@/lib/db', () => ({ query: jest.fn(), queryOne: jest.fn().mockResolvedValue(null), queryRows: jest.fn() }));
jest.mock('@/lib/ai-agent/knowledge', () => ({
  ...jest.requireActual('@/lib/ai-agent/knowledge'),
  getKnowledge: (...a: unknown[]) => mockGetKnowledge(...a),
  updateKnowledge: jest.fn(),
  deleteKnowledge: jest.fn(),
  countKnowledge: (...a: unknown[]) => mockCountKnowledge(...a),
  createKnowledge: (...a: unknown[]) => mockCreateKnowledge(...a),
}));
jest.mock('@/lib/documents/pdf-text', () => ({ pdfBufferToText: jest.fn() }));
jest.mock('@/lib/ai-agent/settings', () => ({
  ...jest.requireActual('@/lib/ai-agent/settings'),
  saveProvider: (...a: unknown[]) => mockSaveProvider(...a),
  loadProviderSummary: (...a: unknown[]) => mockLoadProviderSummary(...a),
}));
jest.mock('@/lib/ai-agent/billing', () => ({
  khatarioAccess: (...a: unknown[]) => mockKhatarioAccess(...a),
  khatarioAvailable: jest.fn().mockResolvedValue(false),
}));
jest.mock('@/lib/ai-agent/conversation', () => ({
  pauseConversationBot: (...a: unknown[]) => mockPause(...a),
  resumeConversationBot: (...a: unknown[]) => mockResume(...a),
}));
jest.mock('@/lib/whatsapp-conversation-resolve', () => ({
  resolveVisibleConversation: async (ctx: { businessId: string; userId: string }, id: string) => {
    const found = await mockResolveConv(ctx, id);
    return found ? { id: found, viewer: { ...ctx, isSupervisor: false } } : null;
  },
}));

import { GET as knowledgeItemGET } from '@/app/api/ai-agent/knowledge/[id]/route';
import { POST as uploadPOST } from '@/app/api/ai-agent/knowledge/upload/route';
import { PUT as providerPUT } from '@/app/api/ai-agent/provider/route';
import { POST as botPOST } from '@/app/api/whatsapp/conversations/[id]/bot/route';

const root = path.join(__dirname, '../..');

function routeFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? routeFiles(p) : e.name === 'route.ts' ? [p] : [];
  });
}

const ROUTES = [
  ...routeFiles(path.join(root, 'app/api/ai-agent')),
  path.join(root, 'app/api/whatsapp/conversations/[id]/bot/route.ts'),
];

type Handler = (req: Request, ctx?: { params: Record<string, string> }) => Promise<Response>;
const call = (h: unknown, req: Request, params: Record<string, string> = {}) => (h as Handler)(req, { params });

const json = (url: string, method: string, body: unknown) =>
  new Request(`http://localhost${url}`, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

beforeEach(() => {
  jest.clearAllMocks();
  mockLoadProviderSummary.mockResolvedValue({ keySource: 'own', hasKey: true, keyLast4: '1234', mode: 'dev' });
  mockCountKnowledge.mockResolvedValue(0);
  mockResolveConv.mockResolvedValue(ITEM);
});

describe('every AI agent route is guarded', () => {
  it('finds the routes', () => {
    expect(ROUTES.length).toBeGreaterThanOrEqual(12);
  });

  it.each(ROUTES.map((f) => [path.relative(root, f).replace(/\\/g, '/'), f]))('%s', (_rel, file) => {
    const src = fs.readFileSync(file, 'utf8');
    expect(src).not.toMatch(/export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE)\b/);
    const exports = [...src.matchAll(/export const (GET|POST|PUT|PATCH|DELETE)\s*=\s*([\s\S]*?)async\s*\(/g)];
    expect(exports.length).toBeGreaterThan(0);
    for (const [, method, head] of exports) {
      expect(head).toMatch(/^withWhatsAppPremiumApi(<[^>]+>)?\(\s*\{/);
      expect(head).toContain("module: 'whatsapp'");
      if (method !== 'GET') expect(head).toContain("action: 'update'");
    }
    expect(src).not.toMatch(/body\.business_id|searchParams\.get\(['"]business_id['"]\)|getBusinessIdFromRequest/);
  });
});

describe('handler input checks', () => {
  it('knowledge item: malformed ids are rejected without a lookup', async () => {
    const res = await call(knowledgeItemGET, new Request('http://localhost/api/ai-agent/knowledge/x'), { id: "x' OR 1=1 --" });
    expect(res.status).toBe(404);
    expect(mockGetKnowledge).not.toHaveBeenCalled();

    mockGetKnowledge.mockResolvedValue(null);
    await call(knowledgeItemGET, new Request('http://localhost/api/ai-agent/knowledge/x'), { id: ITEM });
    expect(mockGetKnowledge).toHaveBeenCalledWith(BIZ, ITEM);
  });

  it('upload: only PDF, TXT or CSV up to 5 MB', async () => {
    const upload = (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return call(uploadPOST, new Request('http://localhost/api/ai-agent/knowledge/upload', { method: 'POST', body: form }));
    };
    const exe = await upload(new File(['MZ'], 'run.exe', { type: 'application/octet-stream' }));
    expect(exe.status).toBe(400);
    const big = await upload(new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'big.txt', { type: 'text/plain' }));
    expect(big.status).toBe(400);
    expect(mockCreateKnowledge).not.toHaveBeenCalled();

    mockCreateKnowledge.mockImplementation(async (_b: string, input: { content: string }) => ({ id: ITEM, content: input.content }));
    const csv = await upload(new File(['Item,Price\nRice,120\nDal,90'], 'prices.csv', { type: 'text/csv' }));
    expect(csv.status).toBe(201);
    const [biz, input] = mockCreateKnowledge.mock.calls[0];
    expect(biz).toBe(BIZ);
    expect(input).toMatchObject({ kind: 'file', fileName: 'prices.csv' });
    expect(input.content).toContain('Item: Rice\nPrice: 120');
  });

  it('provider: never echoes the submitted key', async () => {
    const res = await call(providerPUT, json('/api/ai-agent/provider', 'PUT', { keySource: 'own', provider: 'groq', apiKey: 'gsk_super_secret_value' }));
    expect(res.status).toBe(200);
    expect(JSON.stringify(await res.json())).not.toContain('gsk_super_secret_value');
    expect(mockSaveProvider).toHaveBeenCalledWith(BIZ, expect.objectContaining({ apiKey: 'gsk_super_secret_value' }));
  });

  it('provider: going live on Khatario AI without the add-on is refused', async () => {
    mockLoadProviderSummary.mockResolvedValue({ keySource: 'khatario', hasKey: false, mode: 'dev' });
    mockKhatarioAccess.mockResolvedValue({ ok: false, reason: 'live_needs_addon' });
    const res = await call(providerPUT, json('/api/ai-agent/provider', 'PUT', { mode: 'prod' }));
    expect(res.status).toBe(402);
    expect((await res.json()).code).toBe('KHATARIO_AI_REQUIRED');
    expect(mockSaveProvider).not.toHaveBeenCalled();
  });

  it('conversation bot toggle: resolves a chat the user can see and caps pauses', async () => {
    const bad = await call(botPOST, json(`/api/whatsapp/conversations/${ITEM}/bot`, 'POST', { action: 'explode' }), { id: ITEM });
    expect(bad.status).toBe(400);

    await call(botPOST, json(`/api/whatsapp/conversations/${ITEM}/bot`, 'POST', { action: 'pause', minutes: 999999 }), { id: ITEM });
    expect(mockResolveConv).toHaveBeenCalledWith({ businessId: BIZ, userId: USER }, ITEM);
    expect(mockPause).toHaveBeenCalledWith(BIZ, ITEM, 7 * 24 * 60, 'manual');

    mockResolveConv.mockResolvedValue(null);
    const missing = await call(botPOST, json('/api/whatsapp/conversations/other/bot', 'POST', { action: 'resume' }), { id: 'other' });
    expect(missing.status).toBe(404);
    expect(mockResume).not.toHaveBeenCalled();
  });
});
