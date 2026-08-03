import './helpers/mock-deps';

import { PREMIUM_READ_ROUTES } from './fixtures/premium-routes';
import {
  SUBSCRIPTION_SCENARIOS,
  NO_TOKEN_SCENARIO,
} from './fixtures/subscription-scenarios';
import { BUSINESS_A } from './fixtures/identities';
import { buildBusinessARequest, buildUnauthenticatedRequest } from './helpers/api-request';
import {
  applySubscriptionScenario,
  resetSecurityMocks,
} from './helpers/mock-deps';
import { buildPathWithQuery, invokePremiumRoute } from './helpers/route-invoker';
import { readJsonResponse } from './helpers/response';

describe('Premium module subscription gate', () => {
  beforeEach(() => {
    resetSecurityMocks();
  });

  describe.each(PREMIUM_READ_ROUTES)('$module — $method $path', (route) => {
    it(`${NO_TOKEN_SCENARIO.label} → ${NO_TOKEN_SCENARIO.expectedGateStatus}`, async () => {
      const path = buildPathWithQuery(route.path, {
        business_id: BUSINESS_A,
        ...route.query,
      });
      const req = buildUnauthenticatedRequest(path);
      const res = await invokePremiumRoute(route, req);
      const { status } = await readJsonResponse(res);

      expect(status).toBe(NO_TOKEN_SCENARIO.expectedGateStatus);
    });

    it.each(SUBSCRIPTION_SCENARIOS.filter((s) => s.expectedGateStatus === 403))(
      '$label → 403',
      async (scenario) => {
        applySubscriptionScenario(scenario);
        const path = buildPathWithQuery(route.path, {
          business_id: BUSINESS_A,
          ...route.query,
        });
        const req = buildBusinessARequest(path);
        const res = await invokePremiumRoute(route, req);
        const { status, json } = await readJsonResponse(res);

        expect(status).toBe(403);
        if (scenario.expectedCode) {
          expect(json.code).toBe(scenario.expectedCode);
        }
      },
    );

    it.each(SUBSCRIPTION_SCENARIOS.filter((s) => s.expectedGateStatus === 200))(
      '$label → passes subscription gate',
      async (scenario) => {
        applySubscriptionScenario(scenario);
        const path = buildPathWithQuery(route.path, {
          business_id: BUSINESS_A,
          ...route.query,
        });
        const req = buildBusinessARequest(path);
        const res = await invokePremiumRoute(route, req);
        const { status, json } = await readJsonResponse(res);

        expect(status).not.toBe(401);
        expect(json.code).not.toBe('NO_SUBSCRIPTION');
        expect(json.code).not.toBe('SUBSCRIPTION_EXPIRED');
        expect(json.code).not.toBe('TRIAL_EXPIRED');
        expect(json.code).not.toBe('BUSINESS_SUSPENDED');
      },
    );
  });
});
