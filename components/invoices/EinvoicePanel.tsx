'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { QRCodeSVG } from 'qrcode.react';
import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Textarea';
import { SlideOverPanel } from '@/components/ui/SlideOverPanel';
import { useToastContext } from '@/contexts/ToastContext';
import { useOptionalFeatureUpgradeModal } from '@/contexts/FeatureUpgradeModalContext';
import { usePlanFeature } from '@/hooks/usePlanFeature';
import { CONNECT_URL, EwayTransportFields } from '@/components/eway-bills/GenerateEwayBillDialog';
import { useDocumentEwayBills } from '@/components/eway-bills/useDocumentEwayBills';
import type { EinvoiceView } from '@/lib/gst/einvoice';
import type { EinvoiceProblem } from '@/lib/gsp/mastersindia/einvoice-payload';
import type { EwayForm, EwayFormErrors } from '@/lib/gst/eway-generate-form';
import {
  CANCEL_REASONS,
  CANCEL_WARNING,
  einvoiceErrorDisplay,
  einvoiceEwbRequest,
  einvoiceGoodsFacts,
  einvoicePanelState,
  problemFixHref,
  type EinvoiceLine,
  type ErrorDisplay,
  type PanelAction,
} from '@/lib/gst/einvoice-panel';

type Props = {
  invoiceId: string;
  documentType: string;
  /** The invoice's lines, to tell goods from services for the e-way bill option. */
  items: EinvoiceLine[];
  /** An e-way bill number typed on the invoice by hand: the goods already have one. */
  ewayBillNumber?: string | null;
  /** Called after the e-invoice changed (generated, cancelled), so the page reloads the print preview. */
  onChanged?: () => void;
  /** Changes when another copy of this panel changed the e-invoice: reload the state (messages stay). */
  refreshToken?: number;
  /** Told what the panel shows: null while it shows nothing, else the e-invoice status. Must be stable (a state setter). */
  onShownStatus?: (status: EinvoiceView['status'] | null) => void;
};

const EMPTY_EWB: EwayForm = {
  distance: '',
  mode: 'road',
  vehicle: '',
  transporterGstin: '',
  transporterName: '',
  docNumber: '',
  docDate: '',
  isOdc: false,
  shipToGstin: '',
  shipToPlace: '',
  shipToPincode: '',
  shipToStateCode: '',
};

const BADGE_CLASS: Record<'red' | 'green' | 'grey', string> = {
  red: 'bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-300',
  green: 'bg-green-100 text-green-800 dark:bg-green-950/50 dark:text-green-300',
  grey: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
};

async function readJson(res: Response): Promise<Record<string, unknown> | null> {
  try {
    const data = await res.json();
    return data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function ProblemList({ problems }: { problems: Array<{ message: string; href: string | null }> }) {
  if (!problems.length) return null;
  return (
    <ul className="space-y-1 text-xs text-text-secondary">
      {problems.map((p, i) => (
        <li key={`${i}-${p.message}`} className="flex items-start justify-between gap-2">
          <span>{p.message}</span>
          {p.href ? (
            <Link href={p.href} className="shrink-0 font-medium text-primary-700 underline">
              Fix
            </Link>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function ErrorBox({ error, documentType }: { error: ErrorDisplay; documentType: string }) {
  const problems = error.problems.map((p: EinvoiceProblem) => ({ message: p.message, href: problemFixHref(p, documentType) }));
  return (
    <div role="alert" className="space-y-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
      <p>{error.message}</p>
      <ProblemList problems={problems} />
      {error.connect ? (
        <Link href={CONNECT_URL} className="inline-block">
          <span className="inline-flex items-center rounded-md bg-primary-600 px-3 py-1.5 text-sm font-medium text-white">
            Connect Masters India
          </span>
        </Link>
      ) : null}
    </div>
  );
}

/** The e-invoice (IRN) of a sales invoice: what to fix, Generate, the IRN and QR, Cancel within 24 hours. */
export function EinvoicePanel({ invoiceId, documentType, items, ewayBillNumber, onChanged, refreshToken = 0, onShownStatus }: Props) {
  const toast = useToastContext();
  const upgrade = useOptionalFeatureUpgradeModal();
  const ewayAllowed = usePlanFeature('eway_bill');
  const docBills = useDocumentEwayBills('invoice', invoiceId, ewayAllowed);

  const [view, setView] = useState<EinvoiceView | null>(null);
  const [hidden, setHidden] = useState(false);
  const [loadError, setLoadError] = useState<ErrorDisplay | null>(null);
  const [busy, setBusy] = useState<Exclude<PanelAction, 'load'> | null>(null);
  const [actionError, setActionError] = useState<ErrorDisplay | null>(null);
  const [ewayWarning, setEwayWarning] = useState<string | null>(null);
  const [wantEwb, setWantEwb] = useState<boolean | null>(null);
  const [ewbForm, setEwbForm] = useState<EwayForm>(EMPTY_EWB);
  const [ewbErrors, setEwbErrors] = useState<EwayFormErrors>({});
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelRemarks, setCancelRemarks] = useState('');
  const [cancelFormError, setCancelFormError] = useState('');

  const url = `/api/invoices/${encodeURIComponent(invoiceId)}/einvoice`;

  const load = useCallback(async () => {
    try {
      const res = await fetch(url, { credentials: 'include' });
      const data = await readJson(res);
      if (res.ok && data?.einvoice) {
        setView(data.einvoice as EinvoiceView);
        setLoadError(null);
        setHidden(false);
        return;
      }
      // Not in the plan, or not an invoice this business can see: nothing to show.
      const code = typeof data?.code === 'string' ? data.code : '';
      if (code === 'FEATURE_NOT_IN_PLAN' || code === 'FEATURE_NOT_AVAILABLE' || code === 'NOT_FOUND') {
        setHidden(true);
        return;
      }
      setLoadError(einvoiceErrorDisplay({ status: res.status, body: data, action: 'load' }));
    } catch {
      setLoadError(einvoiceErrorDisplay({ status: 0, body: null, action: 'load' }));
    }
  }, [url]);

  useEffect(() => {
    void load();
  }, [load, refreshToken]);

  const refreshBills = docBills.refresh;
  useEffect(() => {
    if (refreshToken) void refreshBills();
  }, [refreshToken, refreshBills]);

  const goods = einvoiceGoodsFacts(items);
  const state = einvoicePanelState(view, {
    documentType,
    ewayAllowed,
    ewayBillsKnown: docBills.ready,
    hasActiveEwayBill: !!docBills.onRecord || !!(ewayBillNumber && ewayBillNumber.trim()),
    goodsLineCount: goods.count,
    goodsValue: goods.value,
  });

  const shownStatus = hidden || !view || !state.visible ? null : state.status;
  useEffect(() => {
    onShownStatus?.(shownStatus);
  }, [shownStatus, onShownStatus]);

  const fail = (status: number, body: Record<string, unknown> | null, action: Exclude<PanelAction, 'load'>) => {
    const d = einvoiceErrorDisplay({ status, body, action });
    setActionError(d);
    if (d.upgrade === 'limit') upgrade?.openUpgrade({ variant: 'limit', limitType: 'einvoices' });
    if (d.refresh) void load();
  };

  const succeed = (next: EinvoiceView, message: string) => {
    setView(next);
    setActionError(null);
    toast.success(message);
    void docBills.refresh();
    onChanged?.();
  };

  const setEwbField = <K extends keyof EwayForm>(key: K, value: EwayForm[K]) => setEwbForm((f) => ({ ...f, [key]: value }));

  async function generate() {
    if (busy || !state.visible || !state.showGenerate || state.generateDisabled) return;
    setActionError(null);
    setEwayWarning(null);
    const withEwb = state.showEwbOption && (wantEwb ?? state.ewbPreTicked);
    let body = '{}';
    if (withEwb) {
      const r = einvoiceEwbRequest(ewbForm);
      if (!r.ok) {
        setEwbErrors(r.errors);
        return;
      }
      body = JSON.stringify(r.body);
    }
    setEwbErrors({});
    setBusy('generate');
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body });
      const data = await readJson(res);
      if (res.ok && data?.einvoice) {
        const next = data.einvoice as EinvoiceView;
        setEwayWarning(next.eway_warning ?? null);
        succeed(next, 'E-invoice generated');
        return;
      }
      fail(res.status, data, 'generate');
    } catch {
      fail(0, null, 'generate');
    } finally {
      setBusy(null);
    }
  }

  async function cancel() {
    if (busy) return;
    setCancelFormError('');
    const reason = CANCEL_REASONS.find((r) => r.value === cancelReason)?.value;
    if (!reason) {
      setCancelFormError('Choose why the e-invoice is being cancelled');
      return;
    }
    if (!cancelRemarks.trim()) {
      setCancelFormError('Enter the reason for cancelling');
      return;
    }
    setActionError(null);
    setBusy('cancel');
    try {
      const res = await fetch(url, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ reason, remarks: cancelRemarks.trim() }),
      });
      const data = await readJson(res);
      if (res.ok && data?.einvoice) {
        setCancelOpen(false);
        setCancelReason('');
        setCancelRemarks('');
        setEwayWarning(null);
        succeed(data.einvoice as EinvoiceView, 'E-invoice cancelled');
        return;
      }
      fail(res.status, data, 'cancel');
    } catch {
      fail(0, null, 'cancel');
    } finally {
      setBusy(null);
    }
  }

  async function recheck() {
    if (busy) return;
    setActionError(null);
    setBusy('recheck');
    try {
      // An empty body asks the portal whether this e-invoice was cancelled there.
      const res = await fetch(url, { method: 'DELETE', credentials: 'include' });
      const data = await readJson(res);
      if (res.ok && data?.einvoice) {
        succeed(data.einvoice as EinvoiceView, 'The portal shows this e-invoice as cancelled');
        return;
      }
      fail(res.status, data, 'recheck');
    } catch {
      fail(0, null, 'recheck');
    } finally {
      setBusy(null);
    }
  }

  // Nothing while loading, and nothing when the first load fails: an invoice that may never need an
  // e-invoice must not show an e-invoice error. A failed reload shows inside the panel already on screen.
  if (hidden || !view || !state.visible) return null;

  const ewbChecked = state.showEwbOption && (wantEwb ?? state.ewbPreTicked);
  const dialogOpen = cancelOpen && state.showCancel;

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-wide text-text-muted">E-invoice</p>
      <span className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${BADGE_CLASS[state.badge.tone]}`}>{state.badge.text}</span>

      {state.status === 'none' ? (
        <>
          {state.pendingNote ? <p className="text-xs text-text-secondary">{state.pendingNote}</p> : null}
          {state.problems.length ? (
            <div className="space-y-1">
              <p className="text-xs font-medium text-text-primary">Fix these before generating the e-invoice:</p>
              <ProblemList problems={state.problems} />
            </div>
          ) : null}
          {state.lastError && !actionError ? <p className="text-xs text-red-700">Last attempt: {state.lastError}</p> : null}
          {state.showEwbOption ? (
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={ewbChecked} onChange={(e) => setWantEwb(e.target.checked)} disabled={busy !== null} />
              Also create the e-way bill
            </label>
          ) : null}
          {ewbChecked ? (
            <div className="space-y-3 rounded-lg border border-gray-200 p-3">
              <EwayTransportFields form={ewbForm} errors={ewbErrors} onChange={setEwbField} />
            </div>
          ) : null}
        </>
      ) : null}

      {state.status === 'active' ? (
        <div className="flex flex-wrap items-start gap-3">
          {state.qrValue ? (
            <div className="rounded border border-border bg-white p-1">
              <QRCodeSVG value={state.qrValue} size={132} marginSize={1} />
            </div>
          ) : null}
          <div className="min-w-0 flex-1 space-y-1 text-xs text-text-secondary">
            <p className="break-all">
              <span className="font-medium text-text-primary">IRN:</span> {state.irn}
            </p>
            {state.ackNo ? (
              <p>
                <span className="font-medium text-text-primary">Ack No:</span> {state.ackNo}
              </p>
            ) : null}
            {state.ackDate ? (
              <p>
                <span className="font-medium text-text-primary">Ack Date:</span> {state.ackDate}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      {state.status === 'cancelled' && state.cancelledNote ? <p className="text-xs text-text-secondary">{state.cancelledNote}</p> : null}

      {ewayWarning && state.status === 'active' ? <p className="text-xs text-amber-700">{ewayWarning}</p> : null}

      {loadError ? <ErrorBox error={loadError} documentType={documentType} /> : null}
      {actionError && !dialogOpen ? <ErrorBox error={actionError} documentType={documentType} /> : null}

      {state.showGenerate ? (
        <Button
          type="button"
          variant="primary"
          className="w-full"
          onClick={() => void generate()}
          disabled={state.generateDisabled || busy !== null}
          isLoading={busy === 'generate'}
        >
          {busy === 'generate' ? 'Generating…' : 'Generate e-invoice'}
        </Button>
      ) : null}

      {state.showCancel ? (
        <Button
          type="button"
          variant="secondary"
          className="w-full text-red-600"
          onClick={() => {
            setActionError(null);
            setCancelFormError('');
            setCancelOpen(true);
          }}
          disabled={busy !== null}
        >
          Cancel e-invoice
        </Button>
      ) : null}

      {state.showRecheck ? (
        <button
          type="button"
          className="text-xs text-primary-700 underline disabled:opacity-50"
          onClick={() => void recheck()}
          disabled={busy !== null}
        >
          {busy === 'recheck' ? 'Checking…' : 'Check status on the portal'}
        </button>
      ) : null}

      {dialogOpen ? (
        <SlideOverPanel open onClose={() => (busy === 'cancel' ? undefined : setCancelOpen(false))} title="Cancel e-invoice" widthClass="max-w-md">
          <div className="space-y-3 p-4">
            <p className="text-sm text-gray-700">{CANCEL_WARNING}</p>
            {actionError ? <ErrorBox error={actionError} documentType={documentType} /> : null}
            <label className="block text-sm text-gray-700">
              Reason
              <select
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                disabled={busy === 'cancel'}
              >
                <option value="">Choose a reason</option>
                {CANCEL_REASONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>
            <Textarea
              label="Remarks"
              value={cancelRemarks}
              maxLength={100}
              rows={3}
              onChange={(e) => setCancelRemarks(e.target.value)}
              disabled={busy === 'cancel'}
              helperText="Required. Up to 100 characters."
            />
            {cancelFormError ? <p className="text-sm text-red-600">{cancelFormError}</p> : null}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setCancelOpen(false)} disabled={busy === 'cancel'}>
                Close
              </Button>
              <Button onClick={() => void cancel()} isLoading={busy === 'cancel'} disabled={busy !== null}>
                Cancel e-invoice
              </Button>
            </div>
          </div>
        </SlideOverPanel>
      ) : null}
    </div>
  );
}
