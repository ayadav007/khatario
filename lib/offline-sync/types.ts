import { createHash } from 'crypto';

export type ReplayLogStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'manual_review';

export type ReplayActionType =
  | 'purchase.finalize'
  | 'purchase.create'
  | 'purchase.update'
  | 'sales.finalize'
  | 'sales.create'
  | 'sales.update'
  | 'stock.adjust'
  | 'payment.record';

export interface OfflineReplayLogRow {
  id: string;
  business_id: string;
  idempotency_key: string;
  action_type: ReplayActionType | string;
  request_hash: string;
  request_payload: Record<string, unknown>;
  response_payload: Record<string, unknown> | null;
  status: ReplayLogStatus;
  error_message: string | null;
  entity_type: string | null;
  entity_id: string | null;
  replay_attempts: number;
  first_seen_at: Date;
  last_attempt_at: Date | null;
  completed_at: Date | null;
  created_by_user_id: string | null;
  device_id: string | null;
  created_at: Date;
  duplicate_prevented_count?: number;
}

export interface StandardReplayResponse {
  success: boolean;
  replay_status: 'completed' | 'duplicate' | 'manual_review' | 'failed';
  entity_type?: string;
  entity_id?: string;
  idempotency_key: string;
  server_timestamp: string;
  diagnostics?: {
    replay_attempts: number;
    duplicate_detected?: boolean;
    gst_conflict?: boolean;
    duration_ms?: number;
  };
  /** Original handler payload when completed/duplicate */
  result?: Record<string, unknown>;
  error?: string;
}

export function hashReplayPayload(payload: unknown): string {
  const canonical = JSON.stringify(payload);
  return createHash('sha256').update(canonical).digest('hex');
}

/** Stale processing rows older than this may be reclaimed (crash recovery). */
export const PROCESSING_STALE_MS = 5 * 60 * 1000;

/** Permanent validation failures — do not auto-retry. */
export const POISON_QUEUE_ATTEMPTS = 8;
