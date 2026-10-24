jest.mock('@/lib/db', () => ({
  query: jest.fn(),
}));

jest.mock('@/lib/authorization', () => {
  class AuthorizationError extends Error {
    toNextResponse() {
      const { NextResponse } = require('next/server');
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }
  }
  return {
    authorize: jest.fn(),
    AuthorizationError,
  };
});

jest.mock('@/lib/subscription/feature-access', () => ({
  denyIfFeatureMissing: jest.fn().mockResolvedValue(null),
}));

import { NextRequest } from 'next/server';
import { POST } from '@/app/api/templates/copy/route';
import { query } from '@/lib/db';
import { authorize } from '@/lib/authorization';
import { denyIfFeatureMissing } from '@/lib/subscription/feature-access';

const queryMock = query as jest.Mock;
const authorizeMock = authorize as jest.Mock;
const featureMock = denyIfFeatureMissing as jest.Mock;

const sessionBusiness = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const otherBusiness = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const userId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function request(body: unknown, headers?: Record<string, string>) {
  return new NextRequest('http://localhost:3000/api/templates/copy', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

describe('POST /api/templates/copy', () => {
  beforeEach(() => {
    queryMock.mockReset();
    authorizeMock.mockReset();
    featureMock.mockReset();
    featureMock.mockResolvedValue(null);
    authorizeMock.mockResolvedValue(undefined);
    queryMock.mockResolvedValue({ rows: [{ settings: { color: '#111' } }] });
  });

  it('rejects a signed-out request before writing', async () => {
    const res = await POST(request({
      business_id: otherBusiness,
      template_id: 'gst_standard',
      source_doc_type: 'tax_invoice',
      target_doc_types: ['quotation'],
    }));
    expect(res.status).toBe(401);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('does not write another business when the body names one', async () => {
    const res = await POST(request(
      {
        business_id: otherBusiness,
        template_id: 'gst_standard',
        source_doc_type: 'tax_invoice',
        target_doc_types: ['quotation'],
      },
      {
        'x-authenticated-user-id': userId,
        'x-authenticated-business-id': sessionBusiness,
      },
    ));
    expect(res.status).toBe(403);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('copies using the session business and the template plan', async () => {
    const res = await POST(request(
      {
        template_id: 'gst_standard',
        source_doc_type: 'tax_invoice',
        target_doc_types: ['quotation'],
      },
      {
        'x-authenticated-user-id': userId,
        'x-authenticated-business-id': sessionBusiness,
      },
    ));
    expect(res.status).toBe(200);
    expect(authorizeMock).toHaveBeenCalledWith(userId, 'settings', 'update', { businessId: sessionBusiness });
    expect(featureMock).toHaveBeenCalledWith(sessionBusiness, 'settings_template_customization');
    expect(queryMock).toHaveBeenCalledWith(expect.any(String), [sessionBusiness, 'tax_invoice']);
    const write = queryMock.mock.calls.find((call) => String(call[0]).includes('INSERT'));
    expect(write?.[1][0]).toBe(sessionBusiness);
  });
});
