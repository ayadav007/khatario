/**
 * Offline-first domain types.
 * Server remains source of truth; local state is UX + queue until reconciled.
 */

export type ConnectivityState =
  | 'online'
  | 'degraded'
  | 'offline'
  | 'reconnecting'
  | 'syncing';

export type OfflineActionType =
  | 'purchase.finalize'
  | 'sales.finalize'
  | 'sales.create'
  | 'sales.update'
  | 'purchase.create'
  | 'purchase.update'
  | 'stock.adjust'
  | 'payment.record';

export type OfflineActionStatus =
  | 'pending'
  | 'syncing'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'manual_review'
  | 'conflict';

export type ConflictStrategy =
  | 'server_wins'
  | 'client_wins'
  | 'merge_fields'
  | 'manual_review';

export type EntityKind =
  | 'dashboard'
  | 'invoice'
  | 'purchase'
  | 'customer'
  | 'supplier'
  | 'item'
  | 'stock_summary'
  | 'form_draft'
  | 'auth_session'
  | 'sync_meta';

export interface TenantScope {
  businessId: string;
  userId: string;
}

export interface CachedEntityRecord<T = unknown> {
  id: string;
  kind: EntityKind;
  businessId: string;
  userId: string;
  /** Stable server id when known; otherwise client-generated id. */
  entityKey: string;
  data: T;
  serverVersion: number | null;
  updatedAt: number;
  syncedAt: number | null;
}

export interface OfflineAction<TPayload = Record<string, unknown>> {
  id: string;
  businessId: string;
  userId: string;
  type: OfflineActionType;
  payload: TPayload;
  /** Deterministic key for server deduplication (GST-safe retries). */
  idempotencyKey: string;
  /** Monotonic per-tenant ordering. */
  sequence: number;
  status: OfflineActionStatus;
  createdAt: number;
  updatedAt: number;
  attempts: number;
  lastError: string | null;
  /** Optimistic entity refs updated by this action. */
  optimisticRefs: string[];
  conflictStrategy: ConflictStrategy;
}

export interface FormDraftRecord {
  id: string;
  businessId: string;
  userId: string;
  formKey: string;
  payload: Record<string, unknown>;
  updatedAt: number;
}

export interface SyncMetaRecord {
  id: string;
  businessId: string;
  userId: string;
  lastSuccessfulSyncAt: number | null;
  lastAttemptAt: number | null;
  pendingActionCount: number;
  failedActionCount: number;
}

export interface SyncMetricsSnapshot {
  totalProcessed: number;
  totalSucceeded: number;
  totalFailed: number;
  totalConflicts: number;
  totalDuplicatesPrevented: number;
  totalManualReview: number;
  lastRunDurationMs: number | null;
  lastRunAt: number | null;
}

export interface SyncLogEntry {
  id: string;
  at: number;
  level: 'info' | 'warn' | 'error';
  event: string;
  detail?: Record<string, unknown>;
}

export interface ConflictRecord {
  actionId: string;
  entityKey: string;
  strategy: ConflictStrategy;
  serverPayload: unknown;
  clientPayload: unknown;
  resolvedAt: number | null;
  resolution: 'server' | 'client' | 'merged' | 'pending' | null;
}

export interface OptimisticPatch {
  entityKey: string;
  kind: EntityKind;
  patch: Record<string, unknown>;
  rollback: Record<string, unknown> | null;
}

export interface SyncEngineRunResult {
  processed: number;
  succeeded: number;
  failed: number;
  conflicts: number;
  durationMs: number;
}

/** Maps action types to default conflict strategies (accounting-safe defaults). */
export const DEFAULT_CONFLICT_STRATEGY: Record<OfflineActionType, ConflictStrategy> = {
  'purchase.finalize': 'manual_review',
  'sales.finalize': 'manual_review',
  'sales.create': 'manual_review',
  'sales.update': 'manual_review',
  'purchase.create': 'manual_review',
  'purchase.update': 'manual_review',
  'stock.adjust': 'server_wins',
  'payment.record': 'manual_review',
};

/** GST-sensitive actions must never silently overwrite server state. */
export const GST_SENSITIVE_ACTIONS: ReadonlySet<OfflineActionType> = new Set([
  'purchase.finalize',
  'sales.finalize',
  'sales.create',
  'sales.update',
  'purchase.create',
  'purchase.update',
  'payment.record',
]);
