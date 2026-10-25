/**
 * Registration numbers and certificates follow the signed-in business.
 * A business id in the form cannot store the file on another company.
 */
jest.mock('@/lib/db', () => ({ query: jest.fn(), queryOne: jest.fn(), queryRows: jest.fn() }));
const mockAuthorize = jest.fn();
jest.mock('@/lib/authorization', () => {
  class AuthorizationError extends Error {
    toNextResponse() {
      const { NextResponse } = jest.requireActual('next/server');
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }
  return { authorize: (...a: unknown[]) => mockAuthorize(...a), AuthorizationError };
});
jest.mock('@/lib/rag/tenant-reindex', () => ({ noteShopChanged: jest.fn() }));

import { NextRequest } from 'next/server';
import { POST } from '@/app/api/business/registration-documents/route';
import { PATCH } from '@/app/api/business/[id]/route';

const USER = '11111111-1111-4111-8111-111111111111';
const BIZ = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';

const session = {
  'x-authenticated-user-id': USER,
  'x-authenticated-business-id': BIZ,
};

function jpegFile(name = 'udyam.jpg') {
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0x00, 0x11]);
  return new File([bytes], name, { type: 'application/octet-stream' });
}

beforeEach(() => {
  mockAuthorize.mockReset().mockResolvedValue(undefined);
  const db = jest.requireMock('@/lib/db') as { query: jest.Mock; queryOne: jest.Mock; queryRows: jest.Mock };
  db.query.mockReset().mockResolvedValue({ rows: [] });
  db.queryOne.mockReset().mockResolvedValue({ id: BIZ });
  db.queryRows.mockReset().mockResolvedValue([]);
});

it('rejects a certificate upload with no session', async () => {
  const form = new FormData();
  form.set('kind', 'msme');
  form.set('business_id', BIZ);
  form.set('file', jpegFile());
  const res = await POST(new NextRequest('http://localhost/api/business/registration-documents', { method: 'POST', body: form }));
  expect(res.status).toBe(401);
  const db = jest.requireMock('@/lib/db') as { query: jest.Mock };
  expect(db.query).not.toHaveBeenCalled();
});

it('stores the certificate on the session business and ignores the file content type', async () => {
  const form = new FormData();
  form.set('kind', 'msme');
  form.set('business_id', OTHER);
  form.set('file', jpegFile());
  const res = await POST(
    new NextRequest('http://localhost/api/business/registration-documents', {
      method: 'POST',
      headers: session,
      body: form,
    }),
  );
  expect(res.status).toBe(200);
  const db = jest.requireMock('@/lib/db') as { query: jest.Mock };
  expect(db.query).toHaveBeenCalledWith(expect.stringContaining('business_registration_documents'), [
    BIZ,
    'msme',
    'udyam.jpg',
    'image/jpeg',
    expect.any(Buffer),
    USER,
  ]);
  expect(mockAuthorize).toHaveBeenCalledWith(USER, 'settings', 'update', { businessId: BIZ });
});

it('rejects a file that is not a pdf or image', async () => {
  const form = new FormData();
  form.set('kind', 'tan');
  form.set('file', new File([new Uint8Array([1, 2, 3, 4])], 'notes.txt', { type: 'text/plain' }));
  const res = await POST(
    new NextRequest('http://localhost/api/business/registration-documents', {
      method: 'POST',
      headers: session,
      body: form,
    }),
  );
  expect(res.status).toBe(400);
  const body = await res.json();
  expect(body.code).toBe('INVALID_FILE_TYPE');
});

it('rejects an Udyam number that does not match, and stores a valid one', async () => {
  const bad = await PATCH(
    new NextRequest(`http://localhost/api/business/${BIZ}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...session },
      body: JSON.stringify({ udyam_number: 'MSME-1' }),
    }),
    { params: { id: BIZ } },
  );
  expect(bad.status).toBe(400);
  const db = jest.requireMock('@/lib/db') as { queryOne: jest.Mock };
  expect(db.queryOne).not.toHaveBeenCalled();

  const ok = await PATCH(
    new NextRequest(`http://localhost/api/business/${BIZ}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...session },
      body: JSON.stringify({ udyam_number: 'UDYAM-KA-12-1234567', tan: '', din: '00123456' }),
    }),
    { params: { id: BIZ } },
  );
  expect(ok.status).toBe(200);
  const sql = String(db.queryOne.mock.calls[0][0]);
  const values = db.queryOne.mock.calls[0][1] as unknown[];
  expect(sql).toContain('udyam_number');
  expect(values).toEqual(expect.arrayContaining(['UDYAM-KA-12-1234567', null, '00123456', BIZ]));
});
