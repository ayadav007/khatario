export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface PremiumRouteSpec {
  module: string;
  path: string;
  importPath: string;
  method: HttpMethod;
  /** Query string params appended to the request URL. */
  query?: Record<string, string>;
  /** Route params for dynamic segments, e.g. { id: '...' }. */
  routeParams?: Record<string, string>;
  /** POST/PATCH body (business_id injected by tests when needed). */
  body?: Record<string, unknown>;
  parseJsonBody?: boolean;
  /** Handler uses authorize() after the subscription gate. */
  requiresRbacMock?: boolean;
}

/** One representative read route per premium module (subscription matrix). */
export const PREMIUM_READ_ROUTES: PremiumRouteSpec[] = [
  {
    module: 'Work Orders',
    path: '/api/work-orders',
    importPath: '@/app/api/work-orders/route',
    method: 'GET',
    requiresRbacMock: true,
  },
  {
    module: 'Ledger',
    path: '/api/ledger',
    importPath: '@/app/api/ledger/route',
    method: 'GET',
    requiresRbacMock: true,
  },
  {
    module: 'Accounts',
    path: '/api/accounts',
    importPath: '@/app/api/accounts/route',
    method: 'GET',
    requiresRbacMock: true,
  },
  {
    module: 'Budgets',
    path: '/api/budgets',
    importPath: '@/app/api/budgets/route',
    method: 'GET',
  },
  {
    module: 'TDS',
    path: '/api/tds/categories',
    importPath: '@/app/api/tds/categories/route',
    method: 'GET',
  },
  {
    module: 'GST',
    path: '/api/gst/outstanding',
    importPath: '@/app/api/gst/outstanding/route',
    method: 'GET',
    query: { as_on_date: '2024-01-31' },
    requiresRbacMock: true,
  },
  {
    module: 'Bank Statements',
    path: '/api/bank-statements/unreconciled',
    importPath: '@/app/api/bank-statements/unreconciled/route',
    method: 'GET',
  },
];

/** Cross-tenant write/delete probes (Business A session, Business B claim). */
export const TENANT_WRITE_ROUTES: PremiumRouteSpec[] = [
  {
    module: 'Work Orders',
    path: '/api/work-orders',
    importPath: '@/app/api/work-orders/route',
    method: 'POST',
    parseJsonBody: true,
    body: {
      work_order_number: 'WO-TENANT-TEST',
      work_order_date: '2024-01-01',
      work_description: 'tenant probe',
      created_by: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
    },
    requiresRbacMock: true,
  },
  {
    module: 'Budgets',
    path: '/api/budgets',
    importPath: '@/app/api/budgets/route',
    method: 'POST',
    parseJsonBody: true,
    body: {
      budget_name: 'Tenant Probe',
      budget_type: 'annual',
      financial_year: '2024-25',
      period_start_date: '2024-04-01',
      period_end_date: '2025-03-31',
      lines: [],
    },
  },
  {
    module: 'Accounts',
    path: '/api/accounts/{id}',
    importPath: '@/app/api/accounts/[id]/route',
    method: 'PATCH',
    routeParams: { id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee' },
    parseJsonBody: true,
    body: { account_name: 'Hijacked' },
    requiresRbacMock: true,
  },
  {
    module: 'TDS',
    path: '/api/tds/categories/{id}',
    importPath: '@/app/api/tds/categories/[id]/route',
    method: 'PUT',
    routeParams: { id: 'ffffffff-ffff-ffff-ffff-ffffffffffff' },
    parseJsonBody: true,
    body: { section_name: 'Hijacked' },
  },
  {
    module: 'GST',
    path: '/api/gst/payment',
    importPath: '@/app/api/gst/payment/route',
    method: 'POST',
    parseJsonBody: true,
    body: { amount: 1, payment_date: '2024-01-01' },
    requiresRbacMock: true,
  },
  {
    module: 'Bank Statements',
    path: '/api/bank-statements/import',
    importPath: '@/app/api/bank-statements/import/route',
    method: 'POST',
    parseJsonBody: true,
    body: {
      bank_account_id: '11111111-1111-1111-1111-111111111111',
      statement_period_start: '2024-01-01',
      statement_period_end: '2024-01-31',
      opening_balance: 0,
      closing_balance: 0,
      transactions: [],
    },
  },
];

export const TENANT_DELETE_ROUTES: PremiumRouteSpec[] = [
  {
    module: 'Accounts',
    path: '/api/accounts/{id}',
    importPath: '@/app/api/accounts/[id]/route',
    method: 'DELETE',
    routeParams: { id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee' },
    requiresRbacMock: true,
  },
  {
    module: 'TDS',
    path: '/api/tds/categories/{id}',
    importPath: '@/app/api/tds/categories/[id]/route',
    method: 'DELETE',
    routeParams: { id: 'ffffffff-ffff-ffff-ffff-ffffffffffff' },
  },
];
