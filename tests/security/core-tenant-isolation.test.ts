import './helpers/mock-deps';

jest.mock('@/lib/subscription/feature-access', () => ({
  getAllFeatureAccessForBusiness: jest.fn().mockResolvedValue(new Set(['items'])),
}));
jest.mock('@/lib/whatsapp', () => ({
  getWhatsAppStatus: jest.fn().mockResolvedValue({ connected: true }),
}));

import { GET as featuresEnabledGET } from '@/app/api/features/enabled/route';
import { GET as searchGET } from '@/app/api/search/route';
import { GET as whatsappStatusGET } from '@/app/api/whatsapp/status/route';
import { SUBSCRIPTION_SCENARIOS } from './fixtures/subscription-scenarios';
import { BUSINESS_A, BUSINESS_B } from './fixtures/identities';
import { buildBusinessARequest, buildUnauthenticatedRequest } from './helpers/api-request';
import {
  applySubscriptionScenario,
  mockHasWhatsAppBotAddon,
  resetSecurityMocks,
} from './helpers/mock-deps';
import { readJsonResponse } from './helpers/response';
import { query } from '@/lib/db';

const mockQuery = query as jest.MockedFunction<typeof query>;

describe('Core tenant isolation routes', () => {
  beforeEach(() => {
    resetSecurityMocks();
    applySubscriptionScenario(SUBSCRIPTION_SCENARIOS.find((s) => s.id === 'active')!);
    mockQuery.mockResolvedValue({
      rows: [],
      rowCount: 0,
    } as never);
  });

  describe('/api/features/enabled', () => {
    it('returns 401 without auth token', async () => {
      const req = buildUnauthenticatedRequest('/api/features/enabled', {
        business_id: BUSINESS_A,
      });
      const res = await featuresEnabledGET(req);
      expect(res.status).toBe(401);
    });

    it('returns 403 when business_id does not match session tenant', async () => {
      const req = buildBusinessARequest('/api/features/enabled', {
        claimedBusinessId: BUSINESS_B,
      });
      const res = await featuresEnabledGET(req);
      const { status, json } = await readJsonResponse(res);

      expect(status).toBe(403);
      expect(String(json.error)).toMatch(/session/i);
    });
  });

  describe('/api/search', () => {
    it('returns 403 when business_id does not match session tenant', async () => {
      const req = buildBusinessARequest('/api/search', {
        query: { q: 'test', business_id: BUSINESS_B },
      });
      const res = await searchGET(req);
      const { status, json } = await readJsonResponse(res);

      expect(status).toBe(403);
      expect(String(json.error)).toMatch(/session/i);
    });
  });
});

describe('WhatsApp premium route gates', () => {
  beforeEach(() => {
    resetSecurityMocks();
    applySubscriptionScenario(SUBSCRIPTION_SCENARIOS.find((s) => s.id === 'active')!);
  });

  it('/api/whatsapp/status returns 401 without auth token', async () => {
    const req = buildUnauthenticatedRequest('/api/whatsapp/status', {
      business_id: BUSINESS_A,
    });
    const res = await whatsappStatusGET(req);
    expect(res.status).toBe(401);
  });

  it('/api/whatsapp/status returns 403 for cross-tenant business_id', async () => {
    const req = buildBusinessARequest('/api/whatsapp/status', {
      claimedBusinessId: BUSINESS_B,
    });
    const res = await whatsappStatusGET(req);
    const { status, json } = await readJsonResponse(res);

    expect(status).toBe(403);
    expect(String(json.error)).toMatch(/session/i);
  });

  it('/api/whatsapp/status returns 403 when WhatsApp addon is missing', async () => {
    mockHasWhatsAppBotAddon.mockResolvedValue(false);
    const req = buildBusinessARequest('/api/whatsapp/status', {
      query: { business_id: BUSINESS_A },
    });
    const res = await whatsappStatusGET(req);
    const { status, json } = await readJsonResponse(res);

    expect(status).toBe(403);
    expect(String(json.error)).toMatch(/addon/i);
  });
});
