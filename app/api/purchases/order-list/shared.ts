import { NextResponse } from 'next/server';
import { AuthorizationError } from '@/lib/authorization';
import { OrderListError } from '@/lib/order-list';
import { SupplyOrderInputError } from '@/lib/supply-orders';
import { InviteOrderError } from '@/lib/supplier-invites';

/** Error response shared by the order list routes. */
export function orderListError(error: unknown, fallback: string) {
  if (error instanceof OrderListError || error instanceof InviteOrderError || error instanceof SupplyOrderInputError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof AuthorizationError) return error.toNextResponse();
  console.error(fallback, error);
  return NextResponse.json({ error: fallback }, { status: 500 });
}
