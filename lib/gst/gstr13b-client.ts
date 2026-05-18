/**
 * Client-safe GST reconciliation helpers (no db, WhatsApp, or dynamic server imports).
 * Use this from `'use client'` pages instead of `gstr13b-alerts` / `gstr13b-notifications`.
 */

import type {
  Gstr13bReconciliationMode,
  ReconciliationException,
} from '@/components/gst/gstr13b-reconciliation-types';

export type { Gstr13bReconciliationMode };

export type GstReconciliationAlertSeverity = 'low' | 'medium' | 'high';

export type GstReconciliationAlertRow = {
  id: string;
  business_id: string;
  branch_id: string | null;
  gst_period: string;
  mode: Gstr13bReconciliationMode;
  status: 'open' | 'resolved';
  severity: GstReconciliationAlertSeverity | null;
  summary: string | null;
  details: Record<string, unknown>;
  created_at: string;
  resolved_at: string | null;
};

export type GstReconciliationOpenSeverityCounts = {
  high: number;
  medium: number;
  low: number;
  total: number;
};

export type GstAlertRecipient = { type: 'email' | 'whatsapp'; value: string };

export type ReconciliationUiInsights = {
  largest_mismatch_head: string | null;
  largest_mismatch_amount: number;
  affected_voucher_count: number;
  top_exceptions: ReconciliationException[];
  insight_line: string;
  quiet_mismatch: boolean;
  context: {
    mode_key: Gstr13bReconciliationMode;
    mode_label: string;
    as_of: string;
    source_line: string;
  };
};

const MODE_LABEL: Record<Gstr13bReconciliationMode, string> = {
  live_vs_live: 'Live vs Live',
  filed_vs_live: 'Filed vs Live',
  filed_vs_filed: 'Filed vs Filed',
};

export function reconciliationModeLabel(mode: Gstr13bReconciliationMode): string {
  return MODE_LABEL[mode];
}
