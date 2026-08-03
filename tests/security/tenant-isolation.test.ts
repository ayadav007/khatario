import './helpers/mock-deps';

import {
  PREMIUM_READ_ROUTES,
  TENANT_DELETE_ROUTES,
  TENANT_WRITE_ROUTES,
} from './fixtures/premium-routes';
import { SUBSCRIPTION_SCENARIOS } from './fixtures/subscription-scenarios';
import { BUSINESS_A, BUSINESS_B } from './fixtures/identities';
import { buildBusinessARequest } from './helpers/api-request';
import {
  applySubscriptionScenario,
  resetSecurityMocks,
} from './helpers/mock-deps';
import { buildPathWithQuery, invokePremiumRoute } from './helpers/route-invoker';
import { readJsonResponse } from './helpers/response';

const activeScenario = SUBSCRIPTION_SCENARIOS.find((s) => s.id === 'active')!;

describe('Premium module tenant isolation', () => {
  beforeEach(() => {
    resetSecurityMocks();
    applySubscriptionScenario(activeScenario);
  });

  describe('Business A reads Business B', () => {
    it.each(PREMIUM_READ_ROUTES)('$module GET with foreign business_id → 403', async (route) => {
      const path = buildPathWithQuery(route.path, {
        business_id: BUSINESS_B,
        ...route.query,
      });
      const req = buildBusinessARequest(path);
      const res = await invokePremiumRoute(route, req);
      const { status, json } = await readJsonResponse(res);

      expect(status).toBe(403);
      expect(String(json.error)).toMatch(/session/i);
    });
  });

  describe('Business A updates Business B', () => {
    it.each(TENANT_WRITE_ROUTES)(
      '$module $method with foreign business_id → 403',
      async (route) => {
        const path = buildPathWithQuery(route.path, route.query);
        const req = buildBusinessARequest(path, {
          method: route.method,
          claimedBusinessId: BUSINESS_B,
          body: route.body,
        });
        const res = await invokePremiumRoute(route, req);
        const { status, json } = await readJsonResponse(res);

        expect(status).toBe(403);
        expect(String(json.error)).toMatch(/session/i);
      },
    );
  });

  describe('Business A deletes Business B', () => {
    it.each(TENANT_DELETE_ROUTES)(
      '$module DELETE with foreign business_id → 403',
      async (route) => {
        const path = buildPathWithQuery(route.path, {
          business_id: BUSINESS_B,
          ...route.query,
        });
        const req = buildBusinessARequest(path, { method: 'DELETE' });
        const res = await invokePremiumRoute(route, req);
        const { status, json } = await readJsonResponse(res);

        expect(status).toBe(403);
        expect(String(json.error)).toMatch(/session/i);
      },
    );
  });

  describe('protection regression', () => {
    it('allows foreign business_id when tenant check is bypassed (removed protection)', async () => {
      const route = PREMIUM_READ_ROUTES[0];
      const { requireTenantBusinessId } = require('@/lib/auth-helpers');
      (requireTenantBusinessId as jest.Mock).mockReturnValueOnce({
        ok: true,
        businessId: BUSINESS_B,
      });

      const path = buildPathWithQuery(route.path, { business_id: BUSINESS_B });
      const req = buildBusinessARequest(path);
      const res = await invokePremiumRoute(route, req);
      const { status } = await readJsonResponse(res);

      expect(status).not.toBe(403);
    });
  });
});
