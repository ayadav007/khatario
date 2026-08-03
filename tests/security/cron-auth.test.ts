jest.mock('@/lib/campaign-processor', () => ({
  processAllCampaigns: jest.fn(),
}));

import { NextRequest } from 'next/server';
import { assertCronAuthorized } from '@/lib/cron-auth';
import { POST } from '@/app/api/cron/process-campaigns/route';
import { processAllCampaigns } from '@/lib/campaign-processor';

function cronRequest(bearer?: string): NextRequest {
  const headers = new Headers();
  if (bearer !== undefined) {
    headers.set('authorization', bearer);
  }
  return new NextRequest('http://localhost:3000/api/cron/process-campaigns', {
    method: 'POST',
    headers,
  });
}

describe('assertCronAuthorized', () => {
  const originalSecret = process.env.CRON_SECRET;

  afterEach(() => {
    if (originalSecret === undefined) {
      delete process.env.CRON_SECRET;
    } else {
      process.env.CRON_SECRET = originalSecret;
    }
  });

  it('returns 503 when CRON_SECRET is missing', () => {
    delete process.env.CRON_SECRET;
    const res = assertCronAuthorized(cronRequest('Bearer anything'));
    expect(res?.status).toBe(503);
  });

  it('returns 401 when bearer token is wrong', () => {
    process.env.CRON_SECRET = 'test-secret';
    const res = assertCronAuthorized(cronRequest('Bearer wrong'));
    expect(res?.status).toBe(401);
  });

  it('returns null when bearer matches CRON_SECRET', () => {
    process.env.CRON_SECRET = 'test-secret';
    const res = assertCronAuthorized(cronRequest('Bearer test-secret'));
    expect(res).toBeNull();
  });
});

describe('process-campaigns cron route', () => {
  const originalSecret = process.env.CRON_SECRET;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.CRON_SECRET = 'route-test-secret';
  });

  afterEach(() => {
    if (originalSecret === undefined) {
      delete process.env.CRON_SECRET;
    } else {
      process.env.CRON_SECRET = originalSecret;
    }
  });

  it('rejects unauthenticated cron invocation before handler work', async () => {
    const res = await POST(
      new NextRequest('http://localhost:3000/api/cron/process-campaigns', {
        method: 'POST',
      }),
    );

    expect(res.status).toBe(401);
    expect(processAllCampaigns).not.toHaveBeenCalled();
  });
});
