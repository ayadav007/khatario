import type { OfflineActionType } from '@/lib/offline/types';
import { registerActionExecutor } from '@/lib/offline/sync/sync-engine';

const REPLAY_URL = '/api/offline-sync/replay';

function registerReplayExecutor(type: OfflineActionType): void {
  registerActionExecutor(type, async (action) => {
    const response = await fetch(REPLAY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Idempotency-Key': action.idempotencyKey,
      },
      body: JSON.stringify({
        action_type: action.type,
        business_id: action.businessId,
        user_id: action.userId,
        client_action_id: action.id,
        idempotency_key: action.idempotencyKey,
        payload: action.payload,
      }),
      credentials: 'include',
    });

    const data = (await response.json().catch(() => ({}))) as import('@/lib/offline-sync/types').StandardReplayResponse;

    if (
      data.replay_status === 'completed' ||
      data.replay_status === 'duplicate'
    ) {
      if (data.replay_status === 'duplicate') {
        const { recordDuplicatePrevented } = await import(
          '@/lib/offline/observability/sync-metrics'
        );
        recordDuplicatePrevented();
      }
      return {
        ok: true,
        serverPayload: data,
      };
    }

    if (data.replay_status === 'manual_review') {
      return {
        ok: false,
        conflict: true,
        statusCode: 409,
        serverPayload: data,
        error: data.error ?? 'Manual review required',
      };
    }

    if (!response.ok) {
      return {
        ok: false,
        error: data.error ?? `HTTP ${response.status}`,
        statusCode: response.status,
      };
    }

    return {
      ok: false,
      error: data.error ?? 'Replay failed',
      statusCode: response.status,
    };
  });
}

/** Wire queue executors — extend mapping as domain handlers land. */
export function registerDefaultOfflineExecutors(): void {
  const types: OfflineActionType[] = [
    'purchase.finalize',
    'sales.finalize',
    'sales.create',
    'sales.update',
    'purchase.create',
    'purchase.update',
    'stock.adjust',
    'payment.record',
  ];
  for (const type of types) {
    registerReplayExecutor(type);
  }
}
