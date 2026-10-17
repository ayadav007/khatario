jest.mock('@/lib/db', () => ({ getPool: jest.fn() }));
jest.mock('@/lib/authorization', () => ({
  authorize: jest.fn(),
  AuthorizationError: class AuthorizationError extends Error {},
}));
jest.mock('@/lib/auth-helpers', () => ({
  getAuthenticatedUserId: jest.fn(),
  getBusinessIdFromRequest: jest.fn(),
  getSessionScopedBusinessId: jest.fn(),
  getUserIdFromRequest: jest.fn(),
}));
jest.mock('@/lib/credit-alerts', () => ({ checkAndSendCreditAlerts: jest.fn() }));
jest.mock('@/lib/soft-delete-entitlements', () => ({ shouldUseSoftDelete: jest.fn() }));
jest.mock('@/lib/purchases/cancel-purchase', () => ({
  cancelFinalPurchase: jest.fn(),
  PurchaseCancelError: class PurchaseCancelError extends Error {},
}));
jest.mock('@/lib/purchases/delete-draft-purchase', () => ({ deleteDraftPurchase: jest.fn() }));
jest.mock('@/lib/purchases/purchase-return-lines', () => ({ purchaseReturnLineKey: jest.fn() }));

import { PATCH as patchPurchaseReturn } from '@/app/api/purchase-returns/[id]/route';
import { PUT as rejectPurchaseDate } from '@/app/api/purchases/[id]/route';
import { getBusinessIdFromRequest, getUserIdFromRequest } from '@/lib/auth-helpers';
import { NextRequest } from 'next/server';

describe('immutable purchase dates', () => {
  it('rejects a purchase date change', async () => {
    const response = await rejectPurchaseDate();
    expect(response.status).toBe(405);
    expect((await response.json()).code).toBe('DOCUMENT_DATE_IMMUTABLE');
  });

  it('rejects a purchase-return date change and leaves refund updates alone', async () => {
    (getUserIdFromRequest as jest.Mock).mockReturnValue('user-1');
    (getBusinessIdFromRequest as jest.Mock).mockReturnValue('biz-1');
    const request = new NextRequest('http://localhost/api/purchase-returns/1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', 'x-user-id': 'user-1' },
      body: JSON.stringify({ return_date: '2026-04-01', refund_status: 'pending' }),
    });
    const response = await patchPurchaseReturn(request, { params: { id: '1' } });
    expect(response.status).toBe(405);
    expect((await response.json()).code).toBe('DOCUMENT_DATE_IMMUTABLE');
  });
});
