/**
 * /api/employees/expenses/[id]/voucher, /voucher/pdf and /attachments.
 *
 * These paths sit under the employee-portal (ESS) allowlist prefix, so middleware forwards them
 * with no identity headers whenever a 64-hex portal cookie is present. Each handler must therefore
 * establish identity itself: a business session (with `expenses` permission) or a database-validated
 * portal session limited to the employee's own expense. Every query is scoped to that business.
 */
const mockQueryOne = jest.fn();
const mockQueryRows = jest.fn();
const mockQuery = jest.fn();
jest.mock('@/lib/db', () => ({
  queryOne: (...a: unknown[]) => mockQueryOne(...a),
  queryRows: (...a: unknown[]) => mockQueryRows(...a),
  query: (...a: unknown[]) => mockQuery(...a),
}));
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
const mockPortal = jest.fn();
jest.mock('@/lib/employee-portal/session', () => ({
  getEmployeePortalSessionFromRequest: (...a: unknown[]) => mockPortal(...a),
}));
jest.mock('@/lib/subscription/feature-access', () => {
  class FeatureAccessDeniedError extends Error {}
  return { assertFeatureAccess: jest.fn().mockResolvedValue(undefined), FeatureAccessDeniedError };
});
jest.mock('@/lib/access-boundary', () => ({ isEmployee: jest.fn().mockResolvedValue(false) }));
jest.mock('@/lib/invoice-renderer', () => ({
  InvoiceRenderer: class {
    async renderHtml() {
      return '<html>voucher</html>';
    }
  },
}));
jest.mock('@/lib/invoice-presenter', () => ({
  prepareInvoiceForRendering: jest.fn().mockResolvedValue({ invoice: { amount_in_words: 'Five hundred' } }),
}));
jest.mock('@/lib/print-branding', () => ({
  maybeAppendKhatarioPrintFooter: jest.fn(async (html: string) => html),
}));
const mockLaunch = jest.fn();
jest.mock('puppeteer', () => ({ __esModule: true, default: { launch: (...a: unknown[]) => mockLaunch(...a) } }));
jest.mock('@/lib/puppeteer-launch', () => ({ getPuppeteerLaunchOptions: (o: unknown) => o }));

import { NextRequest } from 'next/server';
import { GET as voucherGet } from '@/app/api/employees/expenses/[id]/voucher/route';
import { GET as pdfGet } from '@/app/api/employees/expenses/[id]/voucher/pdf/route';
import { GET as attachmentsGet, POST as attachmentsPost } from '@/app/api/employees/expenses/[id]/attachments/route';
import { BUSINESS_A, BUSINESS_B, USER_A, SESSION_VERSION } from './fixtures/identities';

const EXPENSE_A = '10000000-0000-4000-8000-000000000001';
const EXPENSE_B = '20000000-0000-4000-8000-000000000002';
const EMPLOYEE_A1 = '30000000-0000-4000-8000-000000000003';
const EMPLOYEE_A2 = '40000000-0000-4000-8000-000000000004';

const sessionA = {
  'x-authenticated-user-id': USER_A,
  'x-authenticated-business-id': BUSINESS_A,
  'x-authenticated-session-version': SESSION_VERSION,
};

function req(path: string, init: { method?: string; headers?: Record<string, string>; body?: unknown } = {}) {
  return new NextRequest(`http://localhost${path}`, {
    method: init.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

/** The row business A's expense query returns; anything scoped to another business returns null. */
function expenseRowFor(businessId: string, employeeId: string) {
  return {
    id: EXPENSE_A,
    employee_id: employeeId,
    business_id: businessId,
    amount: '500.00',
    expense_date: '2026-10-01',
    description: 'Taxi',
    category: 'Travel',
    employee_name: 'Asha',
    business_name: 'Shop A',
  };
}

beforeEach(() => {
  mockQueryOne.mockReset();
  mockQueryRows.mockReset().mockResolvedValue([]);
  mockQuery.mockReset();
  mockAuthorize.mockReset().mockResolvedValue(undefined);
  mockPortal.mockReset().mockResolvedValue(null);
  mockLaunch.mockReset();
});

function scopedExpenseLookup(ownerBusiness: string, employeeId: string) {
  mockQueryOne.mockImplementation(async (_sql: string, params: unknown[]) => {
    // The expense exists only inside `ownerBusiness`; a lookup scoped to any other business finds nothing.
    if (params.includes(EXPENSE_A) && params.includes(ownerBusiness)) return expenseRowFor(ownerBusiness, employeeId);
    if (params.includes(EXPENSE_A) && !params.some((p) => typeof p === 'string' && /^[0-9a-f-]{36}$/.test(p) && p !== EXPENSE_A)) {
      // Unscoped lookup: the defect under test. Return the row so a missing scope shows up as a leak.
      return expenseRowFor(ownerBusiness, employeeId);
    }
    return null;
  });
}

describe('voucher HTML', () => {
  it('refuses a request with no business session and no portal session', async () => {
    const res = await voucherGet(req(`/api/employees/expenses/${EXPENSE_A}/voucher`), { params: { id: EXPENSE_A } });
    expect(res.status).toBe(401);
    expect(mockQueryOne).not.toHaveBeenCalled();
  });

  it('refuses a forged portal header when the portal session does not validate', async () => {
    const res = await voucherGet(
      req(`/api/employees/expenses/${EXPENSE_A}/voucher`, { headers: { 'x-employee-portal-session': '1' } }),
      { params: { id: EXPENSE_A } },
    );
    expect(res.status).toBe(401);
    expect(mockQueryOne).not.toHaveBeenCalled();
  });

  it("does not show business A another business's expense", async () => {
    scopedExpenseLookup(BUSINESS_B, EMPLOYEE_A1);
    const res = await voucherGet(req(`/api/employees/expenses/${EXPENSE_A}/voucher`, { headers: sessionA }), {
      params: { id: EXPENSE_A },
    });
    expect(res.status).toBe(404);
    const [, params] = mockQueryOne.mock.calls[0];
    expect(params).toContain(BUSINESS_A);
  });

  it('requires the expenses read permission for a business session', async () => {
    scopedExpenseLookup(BUSINESS_A, EMPLOYEE_A1);
    const { AuthorizationError } = jest.requireMock('@/lib/authorization');
    mockAuthorize.mockRejectedValue(new AuthorizationError('denied'));
    const res = await voucherGet(req(`/api/employees/expenses/${EXPENSE_A}/voucher`, { headers: sessionA }), {
      params: { id: EXPENSE_A },
    });
    expect(res.status).toBe(403);
    expect(mockAuthorize).toHaveBeenCalledWith(USER_A, 'expenses', 'read', expect.objectContaining({ businessId: BUSINESS_A }));
  });

  it('renders for an authorised business session', async () => {
    scopedExpenseLookup(BUSINESS_A, EMPLOYEE_A1);
    const res = await voucherGet(req(`/api/employees/expenses/${EXPENSE_A}/voucher`, { headers: sessionA }), {
      params: { id: EXPENSE_A },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).html).toContain('voucher');
  });

  it('lets a validated portal employee open their own expense only', async () => {
    mockPortal.mockResolvedValue({ employee_id: EMPLOYEE_A1, business_id: BUSINESS_A });
    scopedExpenseLookup(BUSINESS_A, EMPLOYEE_A1);
    const own = await voucherGet(
      req(`/api/employees/expenses/${EXPENSE_A}/voucher`, { headers: { 'x-employee-portal-session': '1' } }),
      { params: { id: EXPENSE_A } },
    );
    expect(own.status).toBe(200);
    expect(mockAuthorize).not.toHaveBeenCalled();

    scopedExpenseLookup(BUSINESS_A, EMPLOYEE_A2);
    const other = await voucherGet(
      req(`/api/employees/expenses/${EXPENSE_A}/voucher`, { headers: { 'x-employee-portal-session': '1' } }),
      { params: { id: EXPENSE_A } },
    );
    expect([403, 404]).toContain(other.status);
  });
});

describe('voucher PDF', () => {
  it('never launches a browser for an unauthenticated request', async () => {
    const res = await pdfGet(req(`/api/employees/expenses/${EXPENSE_A}/voucher/pdf`), { params: { id: EXPENSE_A } });
    expect(res.status).toBe(401);
    expect(mockLaunch).not.toHaveBeenCalled();
    expect(mockQueryOne).not.toHaveBeenCalled();
  });

  it("does not render another business's expense", async () => {
    scopedExpenseLookup(BUSINESS_B, EMPLOYEE_A1);
    const res = await pdfGet(req(`/api/employees/expenses/${EXPENSE_A}/voucher/pdf`, { headers: sessionA }), {
      params: { id: EXPENSE_A },
    });
    expect(res.status).toBe(404);
    expect(mockLaunch).not.toHaveBeenCalled();
  });
});

describe('attachments', () => {
  it('GET refuses an unauthenticated request', async () => {
    const res = await attachmentsGet(req(`/api/employees/expenses/${EXPENSE_A}/attachments`), {
      params: { id: EXPENSE_A },
    });
    expect(res.status).toBe(401);
    expect(mockQueryRows).not.toHaveBeenCalled();
  });

  it("GET does not list another business's attachments", async () => {
    scopedExpenseLookup(BUSINESS_B, EMPLOYEE_A1);
    const res = await attachmentsGet(req(`/api/employees/expenses/${EXPENSE_A}/attachments`, { headers: sessionA }), {
      params: { id: EXPENSE_A },
    });
    expect(res.status).toBe(404);
    expect(mockQueryRows).not.toHaveBeenCalled();
  });

  it('GET lists attachments for an authorised business session', async () => {
    scopedExpenseLookup(BUSINESS_A, EMPLOYEE_A1);
    mockQueryRows.mockResolvedValue([{ id: 'att-1', expense_id: EXPENSE_A, file_name: 'receipt.jpg' }]);
    const res = await attachmentsGet(req(`/api/employees/expenses/${EXPENSE_A}/attachments`, { headers: sessionA }), {
      params: { id: EXPENSE_A },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).attachments).toHaveLength(1);
    expect(mockAuthorize).toHaveBeenCalledWith(USER_A, 'expenses', 'read', expect.objectContaining({ businessId: BUSINESS_A }));
  });

  it("POST does not attach a file to another business's expense", async () => {
    scopedExpenseLookup(BUSINESS_B, EMPLOYEE_A1);
    const res = await attachmentsPost(
      req(`/api/employees/expenses/${EXPENSE_A}/attachments`, {
        method: 'POST',
        headers: sessionA,
        body: { file_name: 'x.pdf', file_url: 'https://evil.example/x.pdf' },
      }),
      { params: { id: EXPENSE_A } },
    );
    expect(res.status).toBe(404);
    const inserted = mockQueryOne.mock.calls.some(([sql]) => /INSERT INTO expense_attachments/i.test(String(sql)));
    expect(inserted).toBe(false);
  });

  it('POST refuses an unauthenticated request', async () => {
    const res = await attachmentsPost(
      req(`/api/employees/expenses/${EXPENSE_A}/attachments`, {
        method: 'POST',
        body: { file_name: 'x.pdf', file_url: 'https://example.com/x.pdf' },
      }),
      { params: { id: EXPENSE_A } },
    );
    expect(res.status).toBe(401);
    expect(mockQueryOne).not.toHaveBeenCalled();
  });

  it('POST lets a validated portal employee attach to their own expense but not a colleague’s', async () => {
    mockPortal.mockResolvedValue({ employee_id: EMPLOYEE_A1, business_id: BUSINESS_A });
    mockQueryOne.mockImplementation(async (sql: string, params: unknown[]) => {
      if (/INSERT INTO expense_attachments/i.test(sql)) return { id: 'att-new', expense_id: EXPENSE_A };
      if (params.includes(EXPENSE_A) && params.includes(BUSINESS_A)) return expenseRowFor(BUSINESS_A, EMPLOYEE_A1);
      return null;
    });
    const own = await attachmentsPost(
      req(`/api/employees/expenses/${EXPENSE_A}/attachments`, {
        method: 'POST',
        headers: { 'x-employee-portal-session': '1' },
        body: { file_name: 'r.jpg', file_url: 'https://cdn.example/r.jpg' },
      }),
      { params: { id: EXPENSE_A } },
    );
    expect(own.status).toBe(201);

    mockQueryOne.mockImplementation(async (sql: string, params: unknown[]) => {
      if (/INSERT INTO expense_attachments/i.test(sql)) return { id: 'att-bad' };
      if (params.includes(EXPENSE_A) && params.includes(BUSINESS_A)) return expenseRowFor(BUSINESS_A, EMPLOYEE_A2);
      return null;
    });
    const colleague = await attachmentsPost(
      req(`/api/employees/expenses/${EXPENSE_A}/attachments`, {
        method: 'POST',
        headers: { 'x-employee-portal-session': '1' },
        body: { file_name: 'r.jpg', file_url: 'https://cdn.example/r.jpg' },
      }),
      { params: { id: EXPENSE_A } },
    );
    expect([403, 404]).toContain(colleague.status);
    const inserted = mockQueryOne.mock.calls.filter(([sql]) => /INSERT INTO expense_attachments/i.test(String(sql)));
    expect(inserted).toHaveLength(1);
  });
});
