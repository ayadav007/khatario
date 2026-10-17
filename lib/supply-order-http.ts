import { NextResponse } from 'next/server';
import { authorize, AuthorizationError } from './authorization';
import { SupplyOrderInputError } from './supply-orders';

/** Buyers act through purchase permissions, suppliers through invoice permissions. */
export async function authorizeOrderRole(
  userId: string,
  businessId: string,
  role: 'buyer' | 'vendor',
  action: 'read' | 'create' | 'update'
) {
  await authorize(userId, role === 'buyer' ? 'purchases' : 'invoices', action, { businessId });
}

export function supplyOrderErrorResponse(error: unknown, fallback: string) {
  if (error instanceof SupplyOrderInputError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  }
  if (error instanceof AuthorizationError) return error.toNextResponse();
  console.error(fallback, error);
  return NextResponse.json({ error: fallback }, { status: 500 });
}
