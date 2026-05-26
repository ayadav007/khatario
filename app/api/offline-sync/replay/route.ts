import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSessionScopedBusinessId, getUserIdFromRequest } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import {
  withIdempotentReplay,
  type IdempotentReplayContext,
} from '@/lib/offline-sync/with-idempotent-replay';
import { executePurchaseFinalizeReplay } from '@/lib/offline-sync/execute-purchase-finalize-replay';
import { executeSalesFinalizeReplay } from '@/lib/offline-sync/execute-sales-finalize-replay';
import type { StandardReplayResponse } from '@/lib/offline-sync/types';

const replaySchema = z.object({
  action_type: z.enum([
    'purchase.finalize',
    'purchase.create',
    'purchase.update',
    'sales.finalize',
    'sales.create',
    'sales.update',
    'stock.adjust',
    'payment.record',
  ]),
  business_id: z.string().uuid(),
  user_id: z.string().uuid(),
  client_action_id: z.string().min(1),
  idempotency_key: z.string().min(1),
  device_id: z.string().optional().nullable(),
  payload: z.record(z.unknown()),
});

async function dispatchReplay(
  client: import('pg').PoolClient,
  ctx: IdempotentReplayContext
) {
  switch (ctx.actionType) {
    case 'purchase.finalize':
      return executePurchaseFinalizeReplay(client, ctx);
    case 'sales.finalize':
      return executeSalesFinalizeReplay(client, ctx);
    default:
      return {
        ok: false as const,
        kind: 'failed' as const,
        message: `Replay handler not implemented for ${ctx.actionType}`,
        permanent: false,
      };
  }
}

async function authorizeReplayAction(
  userId: string,
  businessId: string,
  actionType: string,
  payload: Record<string, unknown>
): Promise<void> {
  if (actionType === 'purchase.finalize' || actionType.startsWith('purchase.')) {
    await authorize(userId, 'purchases', 'create', { businessId });
    return;
  }
  if (actionType === 'sales.finalize' || actionType.startsWith('sales.')) {
    await authorize(userId, 'invoices', 'create', {
      businessId,
      branchId: payload.branch_id as string | undefined,
      invoice_date: payload.invoice_date as string | undefined,
    });
    return;
  }
  if (actionType === 'payment.record') {
    await authorize(userId, 'payments', 'create', { businessId });
    return;
  }
  if (actionType === 'stock.adjust') {
    await authorize(userId, 'stock', 'adjust_quantity', { businessId });
  }
}

export async function POST(request: NextRequest) {
  try {
    const sessionBusinessId = getSessionScopedBusinessId(request);
    const sessionUserId = getUserIdFromRequest(request);
    if (!sessionBusinessId || !sessionUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const headerKey = request.headers.get('X-Idempotency-Key');
    const body = replaySchema.parse(await request.json());

    if (body.business_id !== sessionBusinessId) {
      return NextResponse.json({ error: 'Business scope mismatch' }, { status: 403 });
    }
    if (body.user_id !== sessionUserId) {
      return NextResponse.json({ error: 'User scope mismatch' }, { status: 403 });
    }

    try {
      await authorizeReplayAction(
        sessionUserId,
        sessionBusinessId,
        body.action_type,
        body.payload
      );
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    const idempotencyKey = headerKey ?? body.idempotency_key;

    const result: StandardReplayResponse = await withIdempotentReplay(
      {
        businessId: body.business_id,
        userId: body.user_id,
        idempotencyKey,
        actionType: body.action_type,
        requestPayload: body.payload,
        deviceId: body.device_id ?? null,
      },
      (client, ctx) => dispatchReplay(client, ctx)
    );

    const httpStatus =
      result.replay_status === 'completed' || result.replay_status === 'duplicate'
        ? 200
        : result.replay_status === 'manual_review'
          ? 409
          : result.replay_status === 'failed'
            ? result.error?.includes('in progress')
              ? 409
              : 422
            : 500;

    return NextResponse.json(result, { status: httpStatus });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid replay payload', details: error.flatten() },
        { status: 400 }
      );
    }
    console.error('[offline-sync/replay]', error);
    return NextResponse.json(
      {
        success: false,
        replay_status: 'failed',
        error: 'Replay failed',
        details: (error as Error).message,
      },
      { status: 500 }
    );
  }
}
