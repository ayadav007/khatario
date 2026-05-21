'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft,
  Camera,
  Clock,
  FileText,
  Image as ImageIcon,
  Loader2,
  Sparkles,
} from 'lucide-react';
import { format, isToday, isYesterday, parseISO } from 'date-fns';
import { clsx } from 'clsx';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/contexts/AuthContext';
import { postInvoiceExtract } from '@/lib/invoice-extract-client';
import { PURCHASE_PENDING_EXTRACT_STORAGE_KEY } from '@/lib/purchase-scan-constants';
import { useToastContext } from '@/contexts/ToastContext';
import { DocumentCropScreen } from '@/components/purchases/scan-flow/DocumentCropScreen';
import { ScanPreviewScreen } from '@/components/purchases/scan-flow/ScanPreviewScreen';
import { ScanLoadingScreen } from '@/components/purchases/scan-flow/ScanLoadingScreen';
import { ScanSuccessScreen } from '@/components/purchases/scan-flow/ScanSuccessScreen';

type JobRow = {
  id: string;
  file_name: string;
  file_type: string | null;
  status: string;
  extraction_data: unknown;
  processing_time_ms: number | null;
  created_at: string;
};

type Filter = 'all' | 'incomplete' | 'completed';

type ScanPhase =
  | { type: 'idle' }
  | { type: 'cropping'; rawFile: File }
  | { type: 'preview'; pages: File[] }
  | { type: 'processing'; pages: File[]; startedAt: number }
  | { type: 'success'; elapsedMs: number; itemCount: number; result: unknown };

function vendorLabel(job: JobRow): string {
  const d = job.extraction_data as Record<string, unknown> | null;
  const sup = d?.supplier as Record<string, unknown> | undefined;
  const name = sup?.name;
  if (typeof name === 'string' && name.trim()) return name.trim().slice(0, 72);
  return job.file_name.replace(/\.[^.]+$/i, '').slice(0, 48) || 'Bill';
}

function subtitleLine(job: JobRow): string {
  const d = job.extraction_data as Record<string, unknown> | null;
  const inv = d?.invoice as Record<string, unknown> | undefined;
  const num = inv?.bill_number ?? inv?.invoice_number;
  const date = inv?.bill_date ?? inv?.date;
  const parts: string[] = [];
  if (typeof num === 'string' && num.trim()) parts.push(`#${num.trim()}`);
  if (typeof date === 'string' && date.trim()) {
    try {
      parts.push(format(parseISO(date.slice(0, 10)), 'd MMM yyyy'));
    } catch {
      parts.push(date);
    }
  }
  return parts.join(' · ') || job.file_name;
}

function itemCount(job: JobRow): number {
  const d = job.extraction_data as Record<string, unknown> | null;
  const items = d?.items;
  return Array.isArray(items) ? items.length : 0;
}

function groupLabel(dateStr: string): string {
  try {
    const d = parseISO(dateStr.slice(0, 10));
    if (isToday(d)) return 'Today';
    if (isYesterday(d)) return 'Yesterday';
    return format(d, 'd MMM yyyy');
  } catch {
    return 'Earlier';
  }
}

export function ScanRecordBillsScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { business, user } = useAuth();
  const toast = useToastContext();
  const returnTo = (searchParams.get('returnTo') || '/purchases/new').trim() || '/purchases/new';

  const [loading, setLoading] = useState(true);
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [stats, setStats] = useState({
    billsScanned: 0,
    completedJobs: 0,
    minutesSavedApprox: 0,
  });
  const [filter, setFilter] = useState<Filter>('all');
  const [pdfBusy, setPdfBusy] = useState(false);
  const [scanPhase, setScanPhase] = useState<ScanPhase>({ type: 'idle' });
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const loadJobs = useCallback(async () => {
    if (!business?.id || !user?.id) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/invoices/extract/jobs?business_id=${encodeURIComponent(business.id)}&user_id=${encodeURIComponent(user.id)}&limit=80`,
        { credentials: 'include' }
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to load scans');
      }
      setJobs(data.jobs || []);
      if (data.stats) setStats(data.stats);
    } catch (e) {
      console.error(e);
      toast.error(e instanceof Error ? e.message : 'Could not load scans');
    } finally {
      setLoading(false);
    }
  }, [business?.id, user?.id, toast]);

  useEffect(() => {
    void loadJobs();
  }, [loadJobs]);

  const filteredJobs = useMemo(() => {
    return jobs.filter((j) => {
      if (filter === 'all') return true;
      if (filter === 'completed') return j.status === 'completed';
      return j.status !== 'completed';
    });
  }, [jobs, filter]);

  const grouped = useMemo(() => {
    const map = new Map<string, JobRow[]>();
    for (const j of filteredJobs) {
      const key = groupLabel(j.created_at);
      const arr = map.get(key) || [];
      arr.push(j);
      map.set(key, arr);
    }
    return Array.from(map.entries());
  }, [filteredJobs]);

  const galleryJobs = useMemo(
    () => jobs.filter((j) => j.file_type?.startsWith('image/')).slice(0, 12),
    [jobs]
  );

  const onExtractSuccess = useCallback(
    async (result: unknown) => {
      try {
        sessionStorage.setItem(PURCHASE_PENDING_EXTRACT_STORAGE_KEY, JSON.stringify(result));
      } catch {
        toast.error('Could not save extraction — try again');
        return;
      }
      await loadJobs();
      router.push(returnTo);
    },
    [loadJobs, returnTo, router, toast]
  );

  const handlePdfPick = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/pdf';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file || !business?.id) return;
      setPdfBusy(true);
      try {
        const result = await postInvoiceExtract(file, business.id);
        await onExtractSuccess(result);
        toast.success('Bill extracted — opening purchase form');
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Extraction failed');
      } finally {
        setPdfBusy(false);
      }
    };
    input.click();
  };

  const ALLOWED_IMAGE_TYPES = new Set([
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/gif',
    'image/bmp',
    'image/tiff',
    'image/webp',
  ]);

  const openDeviceCamera = () => {
    cameraInputRef.current?.click();
  };

  const handleCameraFileChange: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !business?.id) return;

    if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
      toast.error('Please use a JPG, PNG, or other image format');
      return;
    }
    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
      toast.error('Image too large. Maximum size is 10MB');
      return;
    }
    // Enter crop flow instead of directly uploading
    setScanPhase({ type: 'cropping', rawFile: file });
  };

  // Crop confirmed → go to preview
  const handleCropDone = (croppedFile: File) => {
    setScanPhase({ type: 'preview', pages: [croppedFile] });
  };

  // Add extra page in preview
  const handleAddPage = (file: File) => {
    setScanPhase(prev =>
      prev.type === 'preview'
        ? { ...prev, pages: [...prev.pages, file] }
        : prev,
    );
  };

  // Remove page in preview
  const handleRemovePage = (index: number) => {
    setScanPhase(prev => {
      if (prev.type !== 'preview') return prev;
      const pages = prev.pages.filter((_, i) => i !== index);
      return pages.length === 0 ? { type: 'idle' } : { ...prev, pages };
    });
  };

  // Proceed from preview → start extraction
  const handleProceed = useCallback(async () => {
    if (scanPhase.type !== 'preview' || !business?.id) return;
    const pages = scanPhase.pages;
    const startedAt = Date.now();
    setScanPhase({ type: 'processing', pages, startedAt });

    // For now, send the first page (multi-page merge can come later)
    const file = pages[0];
    try {
      const result = await postInvoiceExtract(file, business.id);
      const elapsedMs = Date.now() - startedAt;
      const itemCount =
        (result as any)?.gst_extraction?.items?.length ??
        (result as any)?.data?.items?.length ?? 3;
      setScanPhase({ type: 'success', elapsedMs, itemCount, result });
    } catch (err) {
      setScanPhase({ type: 'idle' });
      toast.error(err instanceof Error ? err.message : 'Extraction failed');
    }
  }, [scanPhase, business?.id, toast]);

  // Dismiss success → navigate
  const handleSuccessDismiss = useCallback(async () => {
    if (scanPhase.type !== 'success') return;
    const { result } = scanPhase;
    setScanPhase({ type: 'idle' });
    try {
      await onExtractSuccess(result);
    } catch {
      toast.error('Could not open purchase form — try again');
    }
  }, [scanPhase, onExtractSuccess, toast]);

  const scrollToGallery = () => {
    document.getElementById('scan-gallery-section')?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div className="relative min-h-[70vh] pb-[10rem] max-lg:pb-[calc(10rem+env(safe-area-inset-bottom,0px))] lg:pb-8">

      {/* ── Scan flow overlays ───────────────────────────────────── */}
      {scanPhase.type === 'cropping' && (
        <DocumentCropScreen
          imageFile={scanPhase.rawFile}
          onCrop={handleCropDone}
          onRetake={() => { setScanPhase({ type: 'idle' }); openDeviceCamera(); }}
        />
      )}
      {scanPhase.type === 'preview' && (
        <ScanPreviewScreen
          pages={scanPhase.pages}
          onAddPage={handleAddPage}
          onRemovePage={handleRemovePage}
          onProceed={handleProceed}
          onBack={() => setScanPhase({ type: 'idle' })}
        />
      )}
      {scanPhase.type === 'processing' && (
        <ScanLoadingScreen startedAt={scanPhase.startedAt} />
      )}
      {scanPhase.type === 'success' && (
        <ScanSuccessScreen
          elapsedMs={scanPhase.elapsedMs}
          itemCount={scanPhase.itemCount}
          onDismiss={handleSuccessDismiss}
        />
      )}

      {/* Hidden capture input: opens system camera on mobile */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        aria-hidden
        tabIndex={-1}
        onChange={handleCameraFileChange}
      />

      <div className="mb-4 flex items-center lg:hidden">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="-ml-2 h-10 px-2"
          onClick={() => router.push(returnTo)}
          aria-label="Back"
        >
          <ArrowLeft className="h-5 w-5 text-text-primary" />
        </Button>
      </div>

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-slate-50 px-3 py-2.5 dark:bg-slate-900/40">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-secondary sm:text-sm">
          <span className="inline-flex items-center gap-1.5 font-medium text-text-primary">
            <FileText className="h-4 w-4 shrink-0 text-text-muted" aria-hidden />
            <span>{stats.billsScanned} bills scanned</span>
          </span>
          <span className="hidden h-4 w-px bg-border sm:block" aria-hidden />
          <span className="inline-flex items-center gap-1.5 font-medium text-text-primary">
            <Clock className="h-4 w-4 shrink-0 text-text-muted" aria-hidden />
            <span>~{stats.minutesSavedApprox} min saved</span>
          </span>
        </div>
        <Sparkles className="h-5 w-5 shrink-0 text-amber-500" aria-hidden />
      </div>

      <section id="scan-gallery-section" className="mb-8">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-text-primary">
            <span className="inline-flex items-center gap-1.5">
              <Sparkles className="h-4 w-4 text-text-muted" aria-hidden />
              Invoices from gallery
            </span>
          </h2>
          <button
            type="button"
            className="link-primary text-xs font-semibold sm:text-sm"
            onClick={scrollToGallery}
          >
            Browse gallery &gt;
          </button>
        </div>
        {galleryJobs.length === 0 ? (
          <p className="text-xs text-text-secondary">No gallery images yet — use camera or upload below.</p>
        ) : (
          <div className="flex gap-2 overflow-x-auto pb-2 pt-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {galleryJobs.map((j) => (
              <button
                key={j.id}
                type="button"
                onClick={() => router.push(`${returnTo.split('?')[0]}?extractionJob=${encodeURIComponent(j.id)}`)}
                className="flex w-20 shrink-0 flex-col items-center gap-1 text-left"
              >
                <div className="flex h-14 w-full items-center justify-center rounded-lg border border-border bg-white shadow-sm dark:bg-slate-900">
                  <ImageIcon className="h-6 w-6 text-text-muted" aria-hidden />
                </div>
                <span className="w-full truncate text-center text-[10px] text-text-secondary">
                  {vendorLabel(j).slice(0, 10)}
                  …
                </span>
              </button>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-text-primary">Recent scans</h2>
        <div className="mb-4 flex flex-wrap gap-2">
          {(['all', 'incomplete', 'completed'] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={clsx(
                'rounded-full border px-3 py-1 text-xs font-medium capitalize transition-colors',
                filter === f
                  ? 'border-primary-500 text-primary-700 dark:text-primary-200'
                  : 'border-border bg-white text-text-secondary hover:bg-slate-50 dark:bg-slate-900 dark:hover:bg-slate-800'
              )}
            >
              {f === 'incomplete' ? 'Incomplete' : f}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-primary-500" />
          </div>
        ) : filteredJobs.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border py-12 text-center text-sm text-text-secondary">
            No scans match this filter.
          </div>
        ) : (
          <div className="space-y-6">
            {grouped.map(([label, group]) => (
              <div key={label}>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
                  {label}
                </div>
                <ul className="space-y-2">
                  {group.map((job) => {
                    const done = job.status === 'completed';
                    const items = itemCount(job);
                    return (
                      <li key={job.id}>
                        <button
                          type="button"
                          onClick={() =>
                            router.push(
                              `${returnTo.split('?')[0]}?extractionJob=${encodeURIComponent(job.id)}`
                            )
                          }
                          className="w-full rounded-xl border border-border bg-white p-3 text-left shadow-sm transition-colors hover:bg-slate-50/80 dark:bg-surface-dark dark:hover:bg-slate-800/80"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="font-semibold text-text-primary">{vendorLabel(job)}</div>
                              <div className="mt-0.5 text-xs text-text-secondary">{subtitleLine(job)}</div>
                              <div className="mt-2 text-[11px] text-text-muted">
                                {items > 0 ? `${items} item${items === 1 ? '' : 's'}` : '—'}
                              </div>
                            </div>
                            <span
                              className={clsx(
                                'shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase',
                                done
                                  ? 'border-green-200 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950/40 dark:text-green-200'
                                  : 'border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200'
                              )}
                            >
                              {done ? 'Completed' : 'Incomplete'}
                            </span>
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Fixed above bottom nav (nav is h-16 z-30) — was bottom-0 z-30 so nav drew on top and hid taps */}
      <div className="pointer-events-none fixed bottom-16 left-0 right-0 z-50 flex gap-3 border-t border-border bg-background/95 px-4 py-3 shadow-[0_-8px_24px_rgba(15,23,42,0.08)] backdrop-blur-sm lg:static lg:z-0 lg:border-0 lg:bg-transparent lg:px-0 lg:py-6 lg:shadow-none lg:backdrop-blur-none">
        <div className="pointer-events-auto flex min-w-0 flex-1 gap-3">
          <Button
            type="button"
            variant="secondary"
            className="min-h-12 flex-1 gap-2 border border-border bg-slate-800 text-white hover:bg-slate-900 dark:bg-slate-800"
            disabled={pdfBusy || scanPhase.type !== 'idle'}
            onClick={handlePdfPick}
          >
            {pdfBusy ? <Loader2 className="h-5 w-5 animate-spin" /> : <FileText className="h-5 w-5" />}
            Upload PDF
          </Button>
          <Button
            type="button"
            variant="primary"
            className="min-h-12 flex-1 gap-2 shadow-md"
            disabled={pdfBusy || scanPhase.type !== 'idle'}
            onClick={openDeviceCamera}
          >
            <Camera className="h-5 w-5" />
            Open camera
          </Button>
        </div>
      </div>
    </div>
  );
}
