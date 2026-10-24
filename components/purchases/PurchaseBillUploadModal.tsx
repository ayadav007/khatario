'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { format } from 'date-fns';
import { Camera, CheckCircle2, Circle, Loader2, Upload, X } from 'lucide-react';
import { prepareInvoiceVisionImageClientOrPassthrough } from '@/lib/invoice-extract/latency/prepare-vision-image-client';
import { extractionJobReadyForImport } from '@/lib/purchases/extraction-job-purchase-link';

/** What the purchase form keeps about the bill it was filled from. */
export interface PurchaseBillSource {
  name: string;
  size: number | null;
  type: string;
  /** Object URL for "View bill"; null for bills re-opened from recent uploads. */
  url: string | null;
}

interface RecentJob {
  id: string;
  file_name: string;
  status: string;
  extraction_data: unknown;
  processing_time_ms: number | null;
  created_at: string;
}

interface PurchaseBillUploadModalProps {
  open: boolean;
  onClose: () => void;
  businessId: string;
  userId: string;
  onExtractionComplete: (result: any, source: PurchaseBillSource) => void | Promise<void>;
  onError: (message: string) => void;
}

const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/bmp', 'image/tiff'];
const MAX_BYTES = 10 * 1024 * 1024;
const STAGES = ['Supplier & bill number', 'Dates', 'Line items', 'Tax & totals check'] as const;

function parseExtraction(raw: unknown): any {
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

function formatBillDate(raw: unknown): string {
  const s = String(raw || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return format(new Date(`${s}T00:00:00`), 'dd MMM yyyy');
}

/** Real values per stage once the extractor has answered — never shown before that. */
function stageDetails(data: any): string[] {
  const supplier = String(data?.supplier?.name || '').trim();
  const billNo = String(data?.invoice?.bill_number || '').trim();
  const items = Array.isArray(data?.items) ? data.items.length : 0;
  const total = Number(data?.totals?.grand_total);
  return [
    [supplier || 'Supplier not found', billNo ? `#${billNo}` : 'no bill number'].join(', '),
    data?.invoice?.bill_date ? formatBillDate(data.invoice.bill_date) : 'No date found',
    `${items} found`,
    Number.isFinite(total) && total > 0 ? `₹${total.toFixed(2)}` : 'No total on bill',
  ];
}

export function PurchaseBillUploadModal({
  open,
  onClose,
  businessId,
  userId,
  onExtractionComplete,
  onError,
}: PurchaseBillUploadModalProps) {
  const [phase, setPhase] = useState<'pick' | 'reading'>('pick');
  const [isDragging, setIsDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [doneDetails, setDoneDetails] = useState<string[] | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [recent, setRecent] = useState<RecentJob[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  /** Preview URL handed to the form (for "View bill") must outlive this modal. */
  const handedOffUrlRef = useRef<string | null>(null);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setPhase('pick');
    setFile(null);
    setPreviewUrl((prev) => {
      if (prev && prev !== handedOffUrlRef.current) URL.revokeObjectURL(prev);
      return null;
    });
    setProgress(0);
    setElapsedMs(0);
    setDoneDetails(null);
    setIsDragging(false);
  }, []);

  const close = useCallback(() => {
    reset();
    setErrorText(null);
    onClose();
  }, [onClose, reset]);

  useEffect(() => {
    if (!open || !businessId || !userId) return;
    let cancelled = false;
    void fetch(
      `/api/invoices/extract/jobs?business_id=${encodeURIComponent(businessId)}&user_id=${encodeURIComponent(userId)}&limit=12`,
      { credentials: 'include' }
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        const jobs = (Array.isArray(data.jobs) ? data.jobs : []) as RecentJob[];
        setRecent(jobs.filter((j) => extractionJobReadyForImport(j.status) && j.extraction_data != null).slice(0, 4));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open, businessId, userId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  useEffect(() => {
    if (phase !== 'reading' || doneDetails) return;
    const started = Date.now();
    const t = window.setInterval(() => {
      const ms = Date.now() - started;
      setElapsedMs(ms);
      setProgress(Math.min(90, Math.round((ms / 15000) * 90)));
    }, 250);
    return () => window.clearInterval(t);
  }, [phase, doneDetails]);

  const startExtraction = useCallback(
    async (picked: File) => {
      if (!ALLOWED_TYPES.includes(picked.type)) {
        setErrorText('That file type is not supported. Use a PDF, JPG or PNG.');
        return;
      }
      if (picked.size > MAX_BYTES) {
        setErrorText('That file is over 10 MB. Try a smaller photo or PDF.');
        return;
      }
      setErrorText(null);
      setFile(picked);
      const url = URL.createObjectURL(picked);
      setPreviewUrl(url);
      setPhase('reading');

      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const upload = picked.type === 'application/pdf' ? picked : await prepareInvoiceVisionImageClientOrPassthrough(picked);
        const body = new FormData();
        body.append('file', upload);
        body.append('business_id', businessId);
        const res = await fetch('/api/invoices/extract', {
          method: 'POST',
          credentials: 'include',
          body,
          signal: controller.signal,
        });
        const result = await res.json().catch(() => null);
        if (!res.ok || !result?.success) {
          throw new Error(
            (result && typeof result.error === 'string' && result.error) || 'We could not read that bill. Try a clearer photo.'
          );
        }
        setProgress(100);
        setDoneDetails(stageDetails(result.data));
        // Let the ticks register before the form fills underneath.
        await new Promise((r) => setTimeout(r, 700));
        if (controller.signal.aborted) return;
        handedOffUrlRef.current = url;
        await Promise.resolve(
          onExtractionComplete(result, { name: picked.name, size: picked.size, type: picked.type, url })
        );
        abortRef.current = null;
        setPreviewUrl(null);
        reset();
        onClose();
      } catch (e: any) {
        if (controller.signal.aborted) return;
        const msg = e?.message || 'We could not read that bill.';
        reset();
        setErrorText(msg);
        onError(msg);
      }
    },
    [businessId, onClose, onError, onExtractionComplete, reset]
  );

  useEffect(() => {
    if (!open || phase !== 'pick') return;
    const onPaste = (e: ClipboardEvent) => {
      const f = Array.from(e.clipboardData?.files || [])[0];
      if (f) {
        e.preventDefault();
        void startExtraction(f);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [open, phase, startExtraction]);

  const openRecent = async (job: RecentJob) => {
    const data = parseExtraction(job.extraction_data);
    if (!data) {
      setErrorText('That upload could not be opened. Upload the bill again.');
      return;
    }
    await Promise.resolve(
      onExtractionComplete(
        { success: true, job_id: job.id, data, processing_time_ms: job.processing_time_ms },
        { name: job.file_name, size: null, type: '', url: null }
      )
    );
    close();
  };

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) void startExtraction(f);
  };

  if (!open) return null;

  const activeStage = doneDetails ? STAGES.length : Math.min(STAGES.length - 1, Math.floor(elapsedMs / 3000));
  const isImage = Boolean(file && file.type.startsWith('image/'));

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onMouseDown={(e) => e.target === e.currentTarget && phase === 'pick' && close()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="purchase-bill-upload-title"
        className="w-full max-w-[600px] rounded-2xl bg-surface p-6 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="purchase-bill-upload-title" className="text-lg font-semibold text-text-primary">
              {phase === 'pick' ? 'Upload supplier bill' : 'Reading your bill…'}
            </h2>
            <p className="mt-0.5 text-sm text-text-secondary">
              {phase === 'pick'
                ? "We'll read it and fill the supplier, dates and items for you to check."
                : 'Usually takes 10–30 seconds.'}
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            className="rounded-lg p-1.5 text-text-muted hover:bg-black/5 hover:text-text-primary"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {phase === 'pick' ? (
          <>
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                setIsDragging(false);
              }}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragging(false);
                const f = e.dataTransfer.files?.[0];
                if (f) void startExtraction(f);
              }}
              className={`mt-5 flex flex-col items-center rounded-xl border-2 border-dashed px-6 py-12 text-center transition-colors ${
                isDragging ? 'border-primary-400 bg-primary-50' : 'border-border bg-[#f6f7f5] dark:bg-white/5'
              }`}
            >
              <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-primary-50 text-primary-500 dark:bg-primary-900/40 dark:text-primary-200">
                <Upload className="h-6 w-6" />
              </div>
              <p className="mt-4 text-base font-semibold text-text-primary">Drop the bill here</p>
              <p className="mt-2 text-sm text-text-muted">or</p>
              <div className="mt-3 flex flex-wrap justify-center gap-2.5">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="rounded-lg bg-primary-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary-600"
                >
                  Choose file
                </button>
                <button
                  type="button"
                  onClick={() => cameraInputRef.current?.click()}
                  className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-5 py-2.5 text-sm font-semibold text-text-primary hover:bg-black/5"
                >
                  <Camera className="h-4 w-4" /> Take photo
                </button>
              </div>
              <p className="mt-4 text-xs text-text-muted">PDF, JPG or PNG · up to 10 MB · paste with Ctrl+V</p>
              <input ref={fileInputRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.gif,.bmp,.tiff" className="hidden" onChange={onInputChange} />
              <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onInputChange} />
            </div>

            {errorText && (
              <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
                {errorText}
              </p>
            )}

            {recent.length > 0 && (
              <div className="mt-6">
                <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Recent uploads</p>
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {recent.map((job) => {
                    const d = parseExtraction(job.extraction_data);
                    const supplier = String(d?.supplier?.name || '').trim() || 'Supplier not read';
                    return (
                      <button
                        key={job.id}
                        type="button"
                        onClick={() => void openRecent(job)}
                        className="rounded-lg border border-border px-3 py-2 text-left hover:border-primary-300 hover:bg-primary-50/50"
                      >
                        <span className="block truncate text-sm font-medium text-text-primary">{job.file_name}</span>
                        <span className="block truncate text-xs text-text-muted">
                          {supplier} · {format(new Date(job.created_at), 'dd MMM')}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="mt-5 flex flex-col gap-5 sm:flex-row">
              <div className="relative h-[330px] w-full shrink-0 overflow-hidden rounded-xl border border-border bg-[#f1eee6] sm:w-[200px] dark:bg-white/5">
                {isImage && previewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={previewUrl} alt="" className="h-full w-full object-cover object-top opacity-80" />
                ) : (
                  <div className="space-y-2 p-4" aria-hidden>
                    <div className="h-2 w-3/5 rounded bg-black/15" />
                    <div className="h-2 w-2/5 rounded bg-black/10" />
                    <div className="my-4 h-px bg-black/10" />
                    {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
                      <div key={i} className={`h-2 rounded ${i < 4 ? 'bg-primary-200' : 'bg-black/10'}`} />
                    ))}
                    <div className="my-4 h-px bg-black/10" />
                    <div className="ml-auto h-2 w-2/5 rounded bg-black/15" />
                  </div>
                )}
                {!doneDetails && (
                  <div className="purchase-bill-scanline pointer-events-none absolute inset-x-0 h-10" aria-hidden>
                    <div className="h-full bg-gradient-to-b from-transparent to-primary-500/20" />
                    <div className="h-0.5 bg-primary-500" />
                  </div>
                )}
              </div>

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-text-primary">{file?.name}</p>
                <p className="mt-0.5 text-xs text-text-muted">{file ? `${formatBytes(file.size)} · uploaded` : ''}</p>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[#efece3] dark:bg-white/10">
                  <div className="h-full rounded-full bg-primary-500 transition-all duration-300" style={{ width: `${progress}%` }} />
                </div>
                <ul className="mt-4 space-y-3">
                  {STAGES.map((label, i) => {
                    const done = Boolean(doneDetails);
                    const active = !done && i === activeStage;
                    return (
                      <li key={label} className="flex items-center gap-2.5 text-sm">
                        {done ? (
                          <CheckCircle2 className="h-5 w-5 shrink-0 text-primary-500" />
                        ) : active ? (
                          <Loader2 className="h-5 w-5 shrink-0 animate-spin text-primary-500" />
                        ) : (
                          <Circle className="h-5 w-5 shrink-0 text-text-muted/50" />
                        )}
                        <span className={active ? 'font-semibold text-text-primary' : done ? 'text-text-primary' : 'text-text-secondary'}>
                          {label}
                        </span>
                        {done && doneDetails && <span className="truncate text-text-muted">— {doneDetails[i]}</span>}
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
            <div className="mt-5 flex items-center justify-between gap-4 border-t border-border pt-4">
              <p className="text-xs text-text-secondary">Fields fill in automatically when done.</p>
              <button
                type="button"
                onClick={close}
                disabled={Boolean(doneDetails)}
                className="rounded-lg border border-border bg-surface px-5 py-2.5 text-sm font-semibold text-text-primary hover:bg-black/5 disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
      <style>{`
        .purchase-bill-scanline { top: 0; animation: purchase-bill-scan 2.4s ease-in-out infinite alternate; }
        @keyframes purchase-bill-scan { from { transform: translateY(0); } to { transform: translateY(290px); } }
        @media (prefers-reduced-motion: reduce) { .purchase-bill-scanline { animation: none; top: 45%; } }
      `}</style>
    </div>
  );
}
