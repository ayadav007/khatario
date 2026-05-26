import type {
  ConflictRecord,
  ConflictStrategy,
  OfflineAction,
} from '@/lib/offline/types';
import { GST_SENSITIVE_ACTIONS } from '@/lib/offline/types';
import { getOfflineDb } from '@/lib/offline/storage/indexed-db-client';
import { OFFLINE_STORES } from '@/lib/offline/storage/schema';

export interface ConflictContext {
  action: OfflineAction;
  serverPayload: unknown;
  clientPayload: unknown;
  serverVersion: number | null;
  clientVersion: number | null;
}

export type ConflictResolution =
  | { outcome: 'apply_server'; payload: unknown }
  | { outcome: 'apply_client'; payload: unknown }
  | { outcome: 'merged'; payload: unknown }
  | { outcome: 'manual_review'; conflict: ConflictRecord };

/**
 * Deterministic, audit-safe conflict resolution.
 * GST-sensitive finalized documents never auto-merge — manual review required.
 */
export function resolveConflict(ctx: ConflictContext): ConflictResolution {
  const { action, serverPayload, clientPayload } = ctx;
  const strategy: ConflictStrategy = action.conflictStrategy;

  if (GST_SENSITIVE_ACTIONS.has(action.type)) {
    return {
      outcome: 'manual_review',
      conflict: buildConflictRecord(ctx, 'pending'),
    };
  }

  switch (strategy) {
    case 'server_wins':
      return { outcome: 'apply_server', payload: serverPayload };
    case 'client_wins':
      return { outcome: 'apply_client', payload: clientPayload };
    case 'merge_fields': {
      if (
        typeof serverPayload === 'object' &&
        serverPayload &&
        typeof clientPayload === 'object' &&
        clientPayload
      ) {
        return {
          outcome: 'merged',
          payload: {
            ...(serverPayload as Record<string, unknown>),
            ...(clientPayload as Record<string, unknown>),
          },
        };
      }
      return {
        outcome: 'manual_review',
        conflict: buildConflictRecord(ctx, 'pending'),
      };
    }
    case 'manual_review':
    default:
      return {
        outcome: 'manual_review',
        conflict: buildConflictRecord(ctx, 'pending'),
      };
  }
}

function buildConflictRecord(
  ctx: ConflictContext,
  resolution: ConflictRecord['resolution']
): ConflictRecord {
  return {
    actionId: ctx.action.id,
    entityKey: ctx.action.optimisticRefs[0] ?? ctx.action.id,
    strategy: ctx.action.conflictStrategy,
    serverPayload: ctx.serverPayload,
    clientPayload: ctx.clientPayload,
    resolvedAt: resolution === 'pending' ? null : Date.now(),
    resolution,
  };
}

export async function persistConflict(record: ConflictRecord): Promise<void> {
  const db = await getOfflineDb();
  await db.put(OFFLINE_STORES.conflicts, record);
}

export async function listPendingConflicts(): Promise<ConflictRecord[]> {
  const db = await getOfflineDb();
  const all = await db.getAll(OFFLINE_STORES.conflicts);
  return all.filter((c) => c.resolution === 'pending' || c.resolution === null);
}
