'use client';

export const dynamic = 'force-dynamic';

import React, { useEffect, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Loader2, AlertTriangle, AlertCircle, Info, RefreshCw, Trash2, CheckCircle2, FlaskConical, Shuffle } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { buildApiUrl } from '@/lib/api-helpers';
import { format } from 'date-fns';

interface Check {
  id: string;
  title: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info' | 'success';
  description: string;
  finding: unknown;
  impact?: string;
  recommendation?: string;
}

interface DiagnosticResponse {
  business_id: string;
  branch_id: string | null;
  is_consolidated: boolean;
  period: { from_date: string; to_date: string };
  generated_at: string;
  checks: Check[];
  summary: {
    critical_count: number;
    high_count: number;
    medium_count: number;
    low_count: number;
    success_count?: number;
  };
}

interface PurgeDryRun {
  business_id: string;
  invoices_to_delete: Array<{
    id: string;
    number: string;
    date: string;
    status: string;
    grand_total: number;
  }>;
  counts: {
    invoices: number;
    invoice_items: number;
    payments: number;
    ledger_entry_lines: number;
  };
  confirm_token: string | null;
  delete_url: string | null;
  note: string;
}

interface PurgeResult {
  deleted: boolean;
  reason?: string;
  counts?: {
    ledger_entry_lines: number;
    payments: number;
    invoices: number;
  };
  deleted_invoice_numbers?: string[];
}

interface SeedDryRun {
  business_id: string;
  will_post: boolean;
  missing_prerequisites: string[];
  branch: { id: string; name: string } | null;
  entries_to_post: Array<{
    debit: { code: string; name: string; amount: number };
    credit: { code: string; name: string; amount: number };
    narration: string;
    bucket_after_phase1: string;
  }>;
  total_amount_each_side: number;
  existing_seed_entries: { line_count: number; total_debit: number; note: string };
  confirm_token: string;
}

interface SeedPostResult {
  seeded?: boolean;
  deleted?: boolean;
  error?: string;
  missing?: string[];
  lines_removed?: number;
  next_step?: string;
  entries?: Array<{ debit_line_id: string; credit_line_id: string; code: string; amount: number }>;
}

interface MigrateGstDryRun {
  business_id: string;
  totals_from_invoices: { cgst: number; sgst: number; igst: number; cess: number; tax: number };
  already_in_split_accounts: { cgst: number; sgst: number; igst: number; cess: number };
  gap_to_migrate: { cgst: number; sgst: number; igst: number; cess: number; total: number };
  invoice_count_in_scope: number;
  sample_invoices: Array<{ id: string; number: string; date: string; cgst: number; sgst: number; igst: number; grand_total: number }>;
  accounts: {
    sales: { id: string; account_code: string; account_name: string } | null;
    output_cgst: { id: string; account_code: string; account_name: string } | null;
    output_sgst: { id: string; account_code: string; account_name: string } | null;
    output_igst: { id: string; account_code: string; account_name: string } | null;
    output_cess: { id: string; account_code: string; account_name: string } | null;
  };
  ready_to_migrate: boolean;
  confirm_token: string | null;
  post_url: string | null;
  notes: string[];
}

interface MigrateGstResult {
  migrated?: boolean;
  voucher_id?: string;
  reference?: string;
  gap_moved?: { cgst: number; sgst: number; igst: number; cess: number; total: number };
  lines?: Array<{ account_code: string; debit: number; credit: number }>;
  error?: string;
}

const SEVERITY_STYLES: Record<Check['severity'], { badge: string; border: string; icon: React.ReactNode; label: string }> = {
  critical: {
    badge: 'bg-red-100 text-red-800',
    border: 'border-red-300',
    icon: <AlertCircle className="w-4 h-4 text-red-600" />,
    label: 'Critical',
  },
  high: {
    badge: 'bg-orange-100 text-orange-800',
    border: 'border-orange-300',
    icon: <AlertTriangle className="w-4 h-4 text-orange-600" />,
    label: 'High',
  },
  medium: {
    badge: 'bg-amber-100 text-amber-800',
    border: 'border-amber-300',
    icon: <AlertTriangle className="w-4 h-4 text-amber-600" />,
    label: 'Medium',
  },
  low: {
    badge: 'bg-yellow-100 text-yellow-800',
    border: 'border-yellow-300',
    icon: <Info className="w-4 h-4 text-yellow-600" />,
    label: 'Low',
  },
  info: {
    badge: 'bg-slate-100 text-slate-700',
    border: 'border-slate-200',
    icon: <Info className="w-4 h-4 text-slate-500" />,
    label: 'Info',
  },
  success: {
    badge: 'bg-green-100 text-green-800',
    border: 'border-green-400',
    icon: <CheckCircle2 className="w-4 h-4 text-green-600" />,
    label: 'Fixed',
  },
};

function defaultFromDate() {
  const now = new Date();
  const currentYear = now.getFullYear();
  const fyStart = new Date(currentYear, 3, 1);
  return now < fyStart
    ? format(new Date(currentYear - 1, 3, 1), 'yyyy-MM-dd')
    : format(fyStart, 'yyyy-MM-dd');
}

export default function ProfitLossValidationPage() {
  const { business, user } = useAuth();
  const [data, setData] = useState<DiagnosticResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fromDate, setFromDate] = useState(defaultFromDate);
  const [toDate, setToDate] = useState(format(new Date(), 'yyyy-MM-dd'));

  const [purgeDry, setPurgeDry] = useState<PurgeDryRun | null>(null);
  const [purgeBusy, setPurgeBusy] = useState(false);
  const [purgeError, setPurgeError] = useState<string | null>(null);
  const [purgeResult, setPurgeResult] = useState<PurgeResult | null>(null);

  const [seedDry, setSeedDry] = useState<SeedDryRun | null>(null);
  const [seedBusy, setSeedBusy] = useState(false);
  const [seedError, setSeedError] = useState<string | null>(null);
  const [seedResult, setSeedResult] = useState<SeedPostResult | null>(null);

  const [migrateGstDry, setMigrateGstDry] = useState<MigrateGstDryRun | null>(null);
  const [migrateGstBusy, setMigrateGstBusy] = useState(false);
  const [migrateGstError, setMigrateGstError] = useState<string | null>(null);
  const [migrateGstResult, setMigrateGstResult] = useState<MigrateGstResult | null>(null);

  const runDiagnostic = React.useCallback(async () => {
    if (!business?.id || !user?.id) return;
    setLoading(true);
    setError(null);
    try {
      const url = buildApiUrl('/api/admin/diagnostics/pl-validation', {
        business_id: business.id,
        user_id: user.id,
        from_date: fromDate,
        to_date: toDate,
      });
      const res = await fetch(url);
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Request failed' }));
        setError(body.error || `HTTP ${res.status}`);
        setData(null);
        return;
      }
      setData((await res.json()) as DiagnosticResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to run diagnostic');
    } finally {
      setLoading(false);
    }
  }, [business?.id, user?.id, fromDate, toDate]);

  useEffect(() => {
    runDiagnostic();
  }, [runDiagnostic]);

  const previewPurge = React.useCallback(async () => {
    if (!business?.id || !user?.id) return;
    setPurgeBusy(true);
    setPurgeError(null);
    setPurgeResult(null);
    try {
      const url = buildApiUrl('/api/admin/diagnostics/purge-invoices', {
        business_id: business.id,
        user_id: user.id,
      });
      const res = await fetch(url, { credentials: 'include' });
      const body = await res.json();
      if (!res.ok) {
        setPurgeError(body.error || `HTTP ${res.status}`);
        setPurgeDry(null);
      } else {
        setPurgeDry(body as PurgeDryRun);
      }
    } catch (e) {
      setPurgeError(e instanceof Error ? e.message : 'Preview failed');
    } finally {
      setPurgeBusy(false);
    }
  }, [business?.id, user?.id]);

  const confirmPurge = React.useCallback(async () => {
    if (!business?.id || !user?.id || !purgeDry?.confirm_token) return;
    if (
      !window.confirm(
        `This will permanently delete ${purgeDry.counts.invoices} invoice(s), ` +
          `${purgeDry.counts.invoice_items} item line(s), ${purgeDry.counts.payments} payment(s), ` +
          `and ${purgeDry.counts.ledger_entry_lines} ledger line(s). Continue?`,
      )
    ) {
      return;
    }
    setPurgeBusy(true);
    setPurgeError(null);
    try {
      const url = buildApiUrl('/api/admin/diagnostics/purge-invoices', {
        business_id: business.id,
        user_id: user.id,
        confirm: purgeDry.confirm_token,
      });
      const res = await fetch(url, { method: 'DELETE', credentials: 'include' });
      const body = await res.json();
      if (!res.ok) {
        setPurgeError(body.error || `HTTP ${res.status}`);
      } else {
        setPurgeResult(body as PurgeResult);
        setPurgeDry(null);
        // Re-run audit so the user sees the empty state
        await runDiagnostic();
      }
    } catch (e) {
      setPurgeError(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setPurgeBusy(false);
    }
  }, [business?.id, user?.id, purgeDry, runDiagnostic]);

  const previewSeed = React.useCallback(async () => {
    if (!business?.id || !user?.id) return;
    setSeedBusy(true);
    setSeedError(null);
    setSeedResult(null);
    try {
      const url = buildApiUrl('/api/admin/diagnostics/seed-pl-demo', {
        business_id: business.id,
        user_id: user.id,
      });
      const res = await fetch(url, { credentials: 'include' });
      const body = await res.json();
      if (!res.ok) {
        setSeedError(body.error || `HTTP ${res.status}`);
        setSeedDry(null);
      } else {
        setSeedDry(body as SeedDryRun);
      }
    } catch (e) {
      setSeedError(e instanceof Error ? e.message : 'Preview failed');
    } finally {
      setSeedBusy(false);
    }
  }, [business?.id, user?.id]);

  const confirmSeed = React.useCallback(async () => {
    if (!business?.id || !user?.id || !seedDry?.confirm_token) return;
    setSeedBusy(true);
    setSeedError(null);
    try {
      const url = buildApiUrl('/api/admin/diagnostics/seed-pl-demo', {
        business_id: business.id,
        user_id: user.id,
        confirm: seedDry.confirm_token,
      });
      const res = await fetch(url, { method: 'POST', credentials: 'include' });
      const body = await res.json();
      if (!res.ok) {
        setSeedError(body.error || `HTTP ${res.status}`);
      } else {
        setSeedResult(body as SeedPostResult);
        setSeedDry(null);
      }
    } catch (e) {
      setSeedError(e instanceof Error ? e.message : 'Seed failed');
    } finally {
      setSeedBusy(false);
    }
  }, [business?.id, user?.id, seedDry]);

  const resetAndReseed = React.useCallback(async () => {
    if (!business?.id || !user?.id) return;
    if (
      !window.confirm(
        'This will (1) delete every existing [PHASE1_SEED] ledger line, then ' +
          '(2) post one fresh batch of 4 demo entries (₹500 + ₹200 + ₹100 + ₹150). ' +
          'Continue?',
      )
    ) {
      return;
    }
    setSeedBusy(true);
    setSeedError(null);
    setSeedResult(null);
    setSeedDry(null);
    try {
      const baseUrl = buildApiUrl('/api/admin/diagnostics/seed-pl-demo', {
        business_id: business.id,
        user_id: user.id,
      });

      // Step 1: Clear any existing seed entries
      const delRes = await fetch(baseUrl, { method: 'DELETE', credentials: 'include' });
      const delBody = await delRes.json();
      if (!delRes.ok) {
        setSeedError(`Clear step failed: ${delBody.error || `HTTP ${delRes.status}`}`);
        return;
      }

      // Step 2: GET to fetch a confirm token + verify prerequisites
      const getRes = await fetch(baseUrl, { credentials: 'include' });
      const getBody = await getRes.json() as SeedDryRun;
      if (!getRes.ok) {
        setSeedError(
          `Preview step failed: ${(getBody as unknown as { error?: string }).error || `HTTP ${getRes.status}`}`,
        );
        return;
      }
      if (!getBody.will_post) {
        setSeedError(
          `Cannot post: missing prerequisites — ${getBody.missing_prerequisites.join(', ')}`,
        );
        return;
      }

      // Step 3: POST with confirm token
      const postUrl = buildApiUrl('/api/admin/diagnostics/seed-pl-demo', {
        business_id: business.id,
        user_id: user.id,
        confirm: getBody.confirm_token,
      });
      const postRes = await fetch(postUrl, { method: 'POST', credentials: 'include' });
      const postBody = await postRes.json() as SeedPostResult;
      if (!postRes.ok) {
        setSeedError(`Post step failed: ${postBody.error || `HTTP ${postRes.status}`}`);
        return;
      }

      setSeedResult({
        ...postBody,
        next_step:
          `Cleared ${delBody.lines_removed ?? 0} stale line(s), posted ${postBody.entries?.length ?? 0} fresh entries. ` +
          (postBody.next_step ?? ''),
      });
    } catch (e) {
      setSeedError(e instanceof Error ? e.message : 'Reset & re-seed failed');
    } finally {
      setSeedBusy(false);
    }
  }, [business?.id, user?.id]);

  const previewMigrateGst = React.useCallback(async () => {
    if (!business?.id || !user?.id) return;
    setMigrateGstBusy(true);
    setMigrateGstError(null);
    setMigrateGstResult(null);
    try {
      const url = buildApiUrl('/api/admin/diagnostics/migrate-legacy-gst', {
        business_id: business.id,
        user_id: user.id,
      });
      const res = await fetch(url, { credentials: 'include' });
      const body = await res.json();
      if (!res.ok) {
        setMigrateGstError(body.error || `HTTP ${res.status}`);
        setMigrateGstDry(null);
      } else {
        setMigrateGstDry(body as MigrateGstDryRun);
      }
    } catch (e) {
      setMigrateGstError(e instanceof Error ? e.message : 'Preview failed');
    } finally {
      setMigrateGstBusy(false);
    }
  }, [business?.id, user?.id]);

  const confirmMigrateGst = React.useCallback(async () => {
    if (!business?.id || !user?.id || !migrateGstDry?.confirm_token) return;
    if (
      !window.confirm(
        `This will post a journal voucher: Dr Sales (4101) ₹${migrateGstDry.gap_to_migrate.total.toFixed(2)} → ` +
          `Cr Output CGST ₹${migrateGstDry.gap_to_migrate.cgst.toFixed(2)} + ` +
          `Cr Output SGST ₹${migrateGstDry.gap_to_migrate.sgst.toFixed(2)} + ` +
          `Cr Output IGST ₹${migrateGstDry.gap_to_migrate.igst.toFixed(2)}. ` +
          `Reversible by deleting the JV. Continue?`,
      )
    ) {
      return;
    }
    setMigrateGstBusy(true);
    setMigrateGstError(null);
    try {
      const url = buildApiUrl('/api/admin/diagnostics/migrate-legacy-gst', {
        business_id: business.id,
        user_id: user.id,
        confirm: migrateGstDry.confirm_token,
      });
      const res = await fetch(url, { method: 'POST', credentials: 'include' });
      const body = await res.json();
      if (!res.ok) {
        setMigrateGstError(body.error || `HTTP ${res.status}`);
      } else {
        setMigrateGstResult(body as MigrateGstResult);
        setMigrateGstDry(null);
        await runDiagnostic();
      }
    } catch (e) {
      setMigrateGstError(e instanceof Error ? e.message : 'Migration failed');
    } finally {
      setMigrateGstBusy(false);
    }
  }, [business?.id, user?.id, migrateGstDry, runDiagnostic]);

  const clearSeed = React.useCallback(async () => {
    if (!business?.id || !user?.id) return;
    if (!window.confirm('Remove all Phase-1 demo seed entries from the ledger?')) return;
    setSeedBusy(true);
    setSeedError(null);
    try {
      const url = buildApiUrl('/api/admin/diagnostics/seed-pl-demo', {
        business_id: business.id,
        user_id: user.id,
      });
      const res = await fetch(url, { method: 'DELETE', credentials: 'include' });
      const body = await res.json();
      if (!res.ok) {
        setSeedError(body.error || `HTTP ${res.status}`);
      } else {
        setSeedResult(body as SeedPostResult);
        setSeedDry(null);
      }
    } catch (e) {
      setSeedError(e instanceof Error ? e.message : 'Cleanup failed');
    } finally {
      setSeedBusy(false);
    }
  }, [business?.id, user?.id]);

  return (
    <div className="space-y-3 md:space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">P&amp;L Validation (Admin)</h1>
        <p className="text-sm text-text-secondary mt-1">
          Read-only audit of how the Profit &amp; Loss numbers were built. Findings are based on the same period and
          branch scope as your P&amp;L screen.
        </p>
      </div>

      <Card>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
          <Input type="date" label="From Date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          <Input type="date" label="To Date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          <Button onClick={runDiagnostic} disabled={loading}>
            {loading ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4 mr-2" />
            )}
            Re-run audit
          </Button>
        </div>
      </Card>

      {error && (
        <Card>
          <div className="text-red-600 text-sm">{error}</div>
        </Card>
      )}

      <Card>
        <div className="border-l-4 border-red-300 pl-4">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h3 className="font-semibold text-red-700 flex items-center gap-2">
                <Trash2 className="w-4 h-4" /> Danger zone — reset test invoices
              </h3>
              <p className="text-xs text-text-secondary mt-1">
                Permanently deletes every non-proforma invoice (and its items, payments, and any
                stale ledger lines) for this business. Used to start the Phase-1 audit-fix work
                from a clean dataset. Cannot be undone.
              </p>
            </div>
            <div className="flex gap-2">
              <Button onClick={previewPurge} disabled={purgeBusy} variant="outline">
                {purgeBusy && !purgeDry ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4 mr-2" />
                )}
                Preview
              </Button>
              {purgeDry && purgeDry.counts.invoices > 0 && (
                <Button
                  onClick={confirmPurge}
                  disabled={purgeBusy}
                  className="bg-red-600 hover:bg-red-700 text-white"
                >
                  {purgeBusy ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Trash2 className="w-4 h-4 mr-2" />
                  )}
                  Confirm delete
                </Button>
              )}
            </div>
          </div>

          {purgeError && (
            <div className="mt-3 text-sm text-red-600">{purgeError}</div>
          )}

          {purgeDry && (
            <div className="mt-3 text-sm">
              <div className="text-text-primary font-medium">
                Will delete: {purgeDry.counts.invoices} invoice(s),{' '}
                {purgeDry.counts.invoice_items} item line(s),{' '}
                {purgeDry.counts.payments} payment(s),{' '}
                {purgeDry.counts.ledger_entry_lines} ledger line(s).
              </div>
              {purgeDry.invoices_to_delete.length > 0 && (
                <details className="mt-2">
                  <summary className="text-xs text-text-secondary cursor-pointer">
                    Show invoice list
                  </summary>
                  <pre className="mt-2 text-xs bg-slate-50 dark:bg-slate-900 p-3 rounded overflow-auto">
                    {JSON.stringify(purgeDry.invoices_to_delete, null, 2)}
                  </pre>
                </details>
              )}
              {purgeDry.counts.invoices === 0 && (
                <div className="mt-1 text-text-secondary text-xs">
                  Nothing to delete — no non-proforma invoices found.
                </div>
              )}
            </div>
          )}

          {purgeResult?.deleted && (
            <div className="mt-3 text-sm text-green-700">
              Deleted: {purgeResult.counts?.invoices ?? 0} invoice(s),{' '}
              {purgeResult.counts?.payments ?? 0} payment(s),{' '}
              {purgeResult.counts?.ledger_entry_lines ?? 0} ledger line(s).
            </div>
          )}
        </div>
      </Card>

      <Card>
        <div className="border-l-4 border-green-400 pl-4">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h3 className="font-semibold text-green-700 flex items-center gap-2">
                <FlaskConical className="w-4 h-4" /> Seed P&amp;L test entries — visualise Phase-1 fix
              </h3>
              <p className="text-xs text-text-secondary mt-1">
                Posts 4 small balanced journal vouchers (Dr Expense / Cr Cash) to demonstrate the
                expense-bucketing fix on the live P&amp;L report:
                <strong> 5201 ₹500</strong> (Indirect),
                <strong> 5205 ₹200</strong> (Other),
                <strong> 5207 ₹100</strong> (Other-Provision),
                <strong> 5210 ₹150</strong> (Tax). All entries are tagged
                <code className="mx-1 px-1 rounded bg-slate-100 dark:bg-slate-800">[PHASE1_SEED]</code>
                so cleanup is precise.
              </p>
            </div>
            <div className="flex gap-2 flex-wrap">
              <Button onClick={previewSeed} disabled={seedBusy} variant="outline">
                {seedBusy && !seedDry ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4 mr-2" />
                )}
                Preview
              </Button>
              {seedDry && seedDry.will_post && (
                <Button
                  onClick={confirmSeed}
                  disabled={seedBusy}
                  className="bg-green-600 hover:bg-green-700 text-white"
                >
                  {seedBusy ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <FlaskConical className="w-4 h-4 mr-2" />
                  )}
                  Post seed entries
                </Button>
              )}
              <Button
                onClick={resetAndReseed}
                disabled={seedBusy}
                className="bg-primary-600 hover:bg-primary-700 text-white"
              >
                {seedBusy ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4 mr-2" />
                )}
                Reset &amp; re-seed (1-click)
              </Button>
              <Button
                onClick={clearSeed}
                disabled={seedBusy}
                variant="outline"
                className="text-red-600 hover:bg-red-50"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Clear seed entries
              </Button>
            </div>
          </div>

          {seedError && (
            <div className="mt-3 text-sm text-red-600">{seedError}</div>
          )}

          {seedDry && (
            <div className="mt-3 text-sm space-y-1">
              {seedDry.will_post ? (
                <div className="text-text-primary font-medium">
                  Will post {seedDry.entries_to_post.length} balanced entries totalling ₹
                  {seedDry.total_amount_each_side.toFixed(2)} on each side, against branch
                  &quot;{seedDry.branch?.name}&quot;.
                </div>
              ) : (
                <div className="text-red-600 font-medium">
                  Cannot seed — missing prerequisites:{' '}
                  {seedDry.missing_prerequisites.join(', ')}
                </div>
              )}
              {seedDry.existing_seed_entries.line_count > 0 && (
                <div className="text-amber-700 text-xs">
                  Note: {seedDry.existing_seed_entries.line_count} existing seed line(s) already
                  in ledger (₹{seedDry.existing_seed_entries.total_debit.toFixed(2)} debit total).
                  Use &quot;Clear seed entries&quot; first if you want a clean run.
                </div>
              )}
              <details className="mt-2">
                <summary className="text-xs text-text-secondary cursor-pointer">
                  Show entries
                </summary>
                <pre className="mt-2 text-xs bg-slate-50 dark:bg-slate-900 p-3 rounded overflow-auto">
                  {JSON.stringify(seedDry.entries_to_post, null, 2)}
                </pre>
              </details>
            </div>
          )}

          {seedResult?.seeded && (
            <div className="mt-3 text-sm text-green-700">
              Seeded {seedResult.entries?.length ?? 0} balanced journal voucher(s).{' '}
              {seedResult.next_step && (
                <span className="block mt-1 text-xs text-text-secondary">
                  {seedResult.next_step}
                </span>
              )}
            </div>
          )}

          {seedResult?.deleted && (
            <div className="mt-3 text-sm text-green-700">
              Removed {seedResult.lines_removed ?? 0} seed ledger line(s).
            </div>
          )}
        </div>
      </Card>

      <Card>
        <div className="border-l-4 border-purple-400 pl-4">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h3 className="font-semibold text-purple-700 flex items-center gap-2">
                <Shuffle className="w-4 h-4" /> Phase-3 — migrate legacy GST out of Sales (4101)
              </h3>
              <p className="text-xs text-text-secondary mt-1">
                Pre-Phase-3 invoices credited the FULL grand_total (taxable + GST) to Sales (4101).
                After Phase-3 the new Output CGST/SGST/IGST accounts (2150 / 2151 / 2152) exist and
                new invoices post correctly, but historical Sales is still inflated by their GST.
                This button posts ONE balanced JV per business that drains the gap from Sales into
                the split accounts. Idempotent — calling it twice does nothing the second time.
                Reversible by deleting the JV from the journal voucher list.
              </p>
            </div>
            <div className="flex gap-2 flex-wrap">
              <Button onClick={previewMigrateGst} disabled={migrateGstBusy} variant="outline">
                {migrateGstBusy && !migrateGstDry ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4 mr-2" />
                )}
                Preview
              </Button>
              {migrateGstDry?.ready_to_migrate && (
                <Button
                  onClick={confirmMigrateGst}
                  disabled={migrateGstBusy}
                  className="bg-purple-600 hover:bg-purple-700 text-white"
                >
                  {migrateGstBusy ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Shuffle className="w-4 h-4 mr-2" />
                  )}
                  Post reclassification JV
                </Button>
              )}
            </div>
          </div>

          {migrateGstError && (
            <div className="mt-3 text-sm text-red-600">{migrateGstError}</div>
          )}

          {migrateGstDry && (
            <div className="mt-3 text-sm space-y-2">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="rounded border border-slate-200 dark:border-slate-700 p-3">
                  <div className="text-xs text-text-secondary uppercase">Source: invoices</div>
                  <div className="text-sm">
                    CGST: <strong>₹{migrateGstDry.totals_from_invoices.cgst.toFixed(2)}</strong>
                  </div>
                  <div className="text-sm">
                    SGST: <strong>₹{migrateGstDry.totals_from_invoices.sgst.toFixed(2)}</strong>
                  </div>
                  <div className="text-sm">
                    IGST: <strong>₹{migrateGstDry.totals_from_invoices.igst.toFixed(2)}</strong>
                  </div>
                  <div className="text-xs text-text-secondary mt-1">
                    {migrateGstDry.invoice_count_in_scope} final invoice(s) total
                  </div>
                </div>
                <div className="rounded border border-slate-200 dark:border-slate-700 p-3">
                  <div className="text-xs text-text-secondary uppercase">Already in 2150-2153</div>
                  <div className="text-sm">
                    CGST: <strong>₹{migrateGstDry.already_in_split_accounts.cgst.toFixed(2)}</strong>
                  </div>
                  <div className="text-sm">
                    SGST: <strong>₹{migrateGstDry.already_in_split_accounts.sgst.toFixed(2)}</strong>
                  </div>
                  <div className="text-sm">
                    IGST: <strong>₹{migrateGstDry.already_in_split_accounts.igst.toFixed(2)}</strong>
                  </div>
                </div>
                <div className={`rounded border p-3 ${migrateGstDry.gap_to_migrate.total > 0 ? 'border-purple-300 bg-purple-50 dark:bg-purple-950/20' : 'border-green-300 bg-green-50 dark:bg-green-950/20'}`}>
                  <div className="text-xs text-text-secondary uppercase">Gap to migrate</div>
                  <div className="text-sm">
                    CGST: <strong>₹{migrateGstDry.gap_to_migrate.cgst.toFixed(2)}</strong>
                  </div>
                  <div className="text-sm">
                    SGST: <strong>₹{migrateGstDry.gap_to_migrate.sgst.toFixed(2)}</strong>
                  </div>
                  <div className="text-sm">
                    IGST: <strong>₹{migrateGstDry.gap_to_migrate.igst.toFixed(2)}</strong>
                  </div>
                  <div className="text-sm font-semibold mt-1">
                    Total: ₹{migrateGstDry.gap_to_migrate.total.toFixed(2)}
                  </div>
                </div>
              </div>
              {migrateGstDry.notes.length > 0 && (
                <ul className="text-xs text-amber-700 list-disc list-inside">
                  {migrateGstDry.notes.map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
              )}
              {migrateGstDry.sample_invoices.length > 0 && (
                <details>
                  <summary className="text-xs text-text-secondary cursor-pointer">
                    Show 10 most-recent taxed invoices in scope
                  </summary>
                  <pre className="mt-2 text-xs bg-slate-50 dark:bg-slate-900 p-3 rounded overflow-auto">
                    {JSON.stringify(migrateGstDry.sample_invoices, null, 2)}
                  </pre>
                </details>
              )}
            </div>
          )}

          {migrateGstResult?.migrated && (
            <div className="mt-3 text-sm text-green-700">
              Migrated ₹{migrateGstResult.gap_moved?.total.toFixed(2)} from Sales (4101) into Output GST
              split accounts. JV reference:{' '}
              <code className="px-1 rounded bg-slate-100 dark:bg-slate-800">
                {migrateGstResult.reference}
              </code>
              .
            </div>
          )}
        </div>
      </Card>

      {data && (
        <>
          <Card>
            <div className="flex flex-wrap gap-3 text-sm">
              <span className="px-3 py-1 rounded-full bg-red-100 text-red-800">
                Critical: {data.summary.critical_count}
              </span>
              <span className="px-3 py-1 rounded-full bg-orange-100 text-orange-800">
                High: {data.summary.high_count}
              </span>
              <span className="px-3 py-1 rounded-full bg-amber-100 text-amber-800">
                Medium: {data.summary.medium_count}
              </span>
              <span className="px-3 py-1 rounded-full bg-green-100 text-green-800">
                Fixed: {data.summary.success_count ?? data.checks.filter(c => c.severity === 'success').length}
              </span>
              <span className="px-3 py-1 rounded-full bg-slate-100 text-slate-700">
                Period {data.period.from_date} → {data.period.to_date}
              </span>
              <span className="px-3 py-1 rounded-full bg-slate-100 text-slate-700">
                {data.is_consolidated ? 'Consolidated (all branches)' : `Branch: ${data.branch_id}`}
              </span>
            </div>
          </Card>

          <div className="space-y-3">
            {data.checks.map((check) => {
              const style = SEVERITY_STYLES[check.severity];
              return (
                <Card key={check.id}>
                  <div className={`border-l-4 ${style.border} pl-4`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          {style.icon}
                          <h3 className="font-semibold text-text-primary">{check.title}</h3>
                        </div>
                        <p className="text-sm text-text-secondary mt-1">{check.description}</p>
                      </div>
                      <span className={`px-2 py-0.5 rounded text-xs uppercase ${style.badge}`}>{style.label}</span>
                    </div>

                    {check.impact && (
                      <div className="mt-3 text-sm">
                        <span className="font-medium text-text-primary">Impact: </span>
                        <span className="text-text-secondary">{check.impact}</span>
                      </div>
                    )}

                    <details className="mt-3">
                      <summary className="text-xs text-text-secondary cursor-pointer">Show numbers</summary>
                      <pre className="mt-2 text-xs bg-slate-50 dark:bg-slate-900 p-3 rounded overflow-auto">
                        {JSON.stringify(check.finding, null, 2)}
                      </pre>
                    </details>

                    {check.recommendation && (
                      <div className="mt-3 text-xs text-text-secondary">
                        <span className="font-medium">Recommendation: </span>
                        {check.recommendation}
                      </div>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
