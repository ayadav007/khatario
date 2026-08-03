import './helpers/mock-subscription-deps';

jest.mock('@/lib/authorization', () => ({
  authorize: jest.fn().mockResolvedValue(undefined),
  AuthorizationError: class AuthorizationError extends Error {
    statusCode = 403;
    code = 'FORBIDDEN';
    toNextResponse() {
      const { NextResponse } = require('next/server');
      return NextResponse.json({ error: this.message, code: this.code }, { status: 403 });
    }
  },
}));
jest.mock('@/lib/enforce-access', () => ({
  enforceAccess: jest.fn().mockResolvedValue(undefined),
  enforceAccessErrorResponse: jest.fn().mockReturnValue(null),
}));
jest.mock('@/lib/auth-helpers', () => {
  const actual = jest.requireActual('@/lib/auth-helpers');
  return {
    ...actual,
    assertSessionValidForCookieAuth: jest.fn().mockResolvedValue(undefined),
  };
});

import { NextResponse } from 'next/server';
import { withPremiumSubscriptionApi } from '@/lib/security/premium-module-api';
import * as requireOpSubModule from '@/lib/security/require-operational-subscription';
import {
  SUBSCRIPTION_SCENARIOS,
  NO_TOKEN_SCENARIO,
} from './fixtures/subscription-scenarios';
import { BUSINESS_A, BUSINESS_B } from './fixtures/identities';
import { buildBusinessARequest, buildUnauthenticatedRequest } from './helpers/api-request';
import { readJsonResponse } from './helpers/response';
import {
  applySubscriptionScenario,
  resetSubscriptionMocks,
} from './helpers/mock-subscription-deps';

const probeHandler = jest.fn(async () =>
  NextResponse.json({ ok: true }, { status: 200 }),
);

const GET = withPremiumSubscriptionApi({}, probeHandler);

describe('withPremiumSubscriptionApi wrapper', () => {
  beforeEach(() => {
    resetSubscriptionMocks();
    probeHandler.mockClear();
  });

  it(`${NO_TOKEN_SCENARIO.label} → ${NO_TOKEN_SCENARIO.expectedGateStatus}`, async () => {
    const req = buildUnauthenticatedRequest('/api/probe', { business_id: BUSINESS_A });
    const res = await GET(req);
    const { status } = await readJsonResponse(res);

    expect(status).toBe(NO_TOKEN_SCENARIO.expectedGateStatus);
    expect(probeHandler).not.toHaveBeenCalled();
  });

  it.each(SUBSCRIPTION_SCENARIOS.filter((s) => s.expectedGateStatus === 403))(
    '$label → 403 (handler not reached)',
    async (scenario) => {
      applySubscriptionScenario(scenario);
      const req = buildBusinessARequest('/api/probe', { query: { business_id: BUSINESS_A } });
      const res = await GET(req);
      const { status, json } = await readJsonResponse(res);

      expect(status).toBe(403);
      if (scenario.expectedCode) {
        expect(json.code).toBe(scenario.expectedCode);
      }
      expect(probeHandler).not.toHaveBeenCalled();
    },
  );

  it.each(SUBSCRIPTION_SCENARIOS.filter((s) => s.expectedGateStatus === 200))(
    '$label → 200 (handler reached)',
    async (scenario) => {
      applySubscriptionScenario(scenario);
      const req = buildBusinessARequest('/api/probe', { query: { business_id: BUSINESS_A } });
      const res = await GET(req);
      const { status } = await readJsonResponse(res);

      expect(status).toBe(200);
      expect(probeHandler).toHaveBeenCalledTimes(1);
    },
  );

  it('cross-tenant business_id claim → 403', async () => {
    applySubscriptionScenario(SUBSCRIPTION_SCENARIOS[0]);
    const req = buildBusinessARequest('/api/probe', { claimedBusinessId: BUSINESS_B });
    const res = await GET(req);
    const { status, json } = await readJsonResponse(res);

    expect(status).toBe(403);
    expect(String(json.error)).toMatch(/session/i);
    expect(probeHandler).not.toHaveBeenCalled();
  });

  describe('protection regression', () => {
    it('blocks expired subscription with gate enabled', async () => {
      applySubscriptionScenario(
        SUBSCRIPTION_SCENARIOS.find((s) => s.id === 'expired')!,
      );
      const req = buildBusinessARequest('/api/probe');
      const res = await GET(req);
      expect(res.status).toBe(403);
      expect(probeHandler).not.toHaveBeenCalled();
    });

    it('reaches handler when requireOperationalSubscription is bypassed (removed protection)', async () => {
      applySubscriptionScenario(
        SUBSCRIPTION_SCENARIOS.find((s) => s.id === 'expired')!,
      );
      jest
        .spyOn(requireOpSubModule, 'requireOperationalSubscription')
        .mockResolvedValue({ status: 'active' } as never);

      const req = buildBusinessARequest('/api/probe');
      const res = await GET(req);

      expect(res.status).toBe(200);
      expect(probeHandler).toHaveBeenCalled();

      jest.restoreAllMocks();
    });
  });
});
