'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Puck, type Data } from '@puckeditor/core';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
  History,
  Loader2,
  Monitor,
  RotateCcw,
  Smartphone,
  Tablet,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { marketingConfig } from '@/components/marketing/builder/config';
import { LandingProductProvider } from '@/components/marketing/landing/LandingProductContext';
import { LandingPlansProvider } from '@/components/marketing/landing/LandingPlansContext';
import { buildDefaultHomeDocument } from '@/lib/marketing-builder/default-home';
import { platformAdminFetchInit } from '@/lib/admin-client-headers';
import { useToastContext } from '@/contexts/ToastContext';
import type { MarketingComponent, MarketingDocument } from '@/lib/marketing-builder/sanitize';

const SLUG = 'home';
const API = `/api/admin/marketing/pages/${SLUG}`;
const PREVIEW_PATH = '/admin/site-builder/preview';
const AUTOSAVE_MS = 1200;
const KEEPALIVE_MAX_BYTES = 60_000;

type PageMeta = {
  draft: MarketingDocument | null;
  draft_updated_at: string | null;
  draft_updated_by: string | null;
  draft_updated_by_name: string | null;
  published: MarketingDocument | null;
  published_at: string | null;
  published_by_name: string | null;
  can_publish: boolean;
  admin_id: string;
};

type VersionRow = {
  id: string;
  created_at: string;
  published_by_name: string | null;
  block_count: number;
};

type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error' | 'conflict';

type Conflict = { by: string | null; at: string };

const VIEWPORTS = [
  { width: 390, label: 'Phone', icon: <Smartphone className="h-4 w-4" /> },
  { width: 768, label: 'Tablet', icon: <Tablet className="h-4 w-4" /> },
  { width: 1440, label: 'Desktop', icon: <Monitor className="h-4 w-4" /> },
];

function isComponentArray(value: unknown): value is MarketingComponent[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((v) => v && typeof v === 'object' && typeof (v as { type?: unknown }).type === 'string')
  );
}

/** Puck shows stored props only, so blocks saved without content get their defaults filled in. */
function fillBlockDefaults(items: MarketingComponent[]): MarketingComponent[] {
  return items.map((item) => {
    const defaults = (marketingConfig.components[item.type]?.defaultProps ?? {}) as Record<string, unknown>;
    const props: Record<string, unknown> = { ...defaults };
    for (const [key, value] of Object.entries(item.props ?? {})) {
      if (value === undefined) continue;
      props[key] = isComponentArray(value) ? fillBlockDefaults(value) : value;
    }
    return { ...item, props: props as MarketingComponent['props'] };
  });
}

function prepareDocument(doc: MarketingDocument): Data {
  const rootDefaults = (marketingConfig.root?.defaultProps ?? {}) as Record<string, unknown>;
  return {
    ...doc,
    root: { props: { ...rootDefaults, ...(doc.root?.props ?? {}) } },
    content: fillBlockDefaults(doc.content ?? []),
  } as Data;
}

function formatWhen(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body.error || fallback;
  } catch {
    return fallback;
  }
}

export function SiteBuilderEditor() {
  const toast = useToastContext();
  const [meta, setMeta] = useState<PageMeta | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [initialData, setInitialData] = useState<Data | null>(null);
  const [docKey, setDocKey] = useState(0);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [staleNotice, setStaleNotice] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [versions, setVersions] = useState<VersionRow[] | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  const latestRef = useRef<Data | null>(null);
  const baseRef = useRef<string | null>(null);
  const dirtyRef = useRef(false);
  const savingRef = useRef<Promise<boolean> | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const conflictRef = useRef(false);

  const loadDocument = useCallback(
    (doc: Data, savedAt: string | null) => {
      latestRef.current = doc;
      baseRef.current = savedAt;
      dirtyRef.current = false;
      conflictRef.current = false;
      setConflict(null);
      setInitialData(doc);
      setDocKey((k) => k + 1);
      setSaveState(savedAt ? 'saved' : 'idle');
    },
    [],
  );

  const fetchPage = useCallback(async () => {
    const res = await fetch(API, ({ ...platformAdminFetchInit,  cache: 'no-store' }));
    if (!res.ok) throw new Error(await readError(res, 'Could not load the page'));
    return (await res.json()) as PageMeta;
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchPage()
      .then((page) => {
        if (cancelled) return;
        setMeta(page);
        const source = page.draft ?? page.published ?? buildDefaultHomeDocument();
        loadDocument(prepareDocument(source), page.draft ? page.draft_updated_at : null);
        if (page.draft && page.draft_updated_by && page.draft_updated_by !== page.admin_id) {
          setStaleNotice(
            `${page.draft_updated_by_name || 'Another admin'} last edited this draft on ${formatWhen(page.draft_updated_at)}. Your changes will build on theirs.`,
          );
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Could not load the page');
      });
    return () => {
      cancelled = true;
    };
  }, [fetchPage, loadDocument]);

  const saveNow = useCallback(
    async (force = false): Promise<boolean> => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (savingRef.current) await savingRef.current;
      if (!latestRef.current || (!dirtyRef.current && !force)) return true;
      if (conflictRef.current && !force) return false;

      const data = latestRef.current;
      dirtyRef.current = false;
      setSaveState('saving');
      const run = (async () => {
        try {
          const res = await fetch(
            API,
            ({ ...platformAdminFetchInit, 
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ data, base_updated_at: baseRef.current, force }),
            }),
          );
          if (res.status === 409) {
            const body = (await res.json()) as { draft_updated_at: string; draft_updated_by_name: string | null };
            conflictRef.current = true;
            dirtyRef.current = true;
            setConflict({ by: body.draft_updated_by_name, at: body.draft_updated_at });
            setSaveState('conflict');
            return false;
          }
          if (!res.ok) {
            dirtyRef.current = true;
            setSaveState('error');
            toast.error(await readError(res, 'Could not save the draft'));
            return false;
          }
          const body = (await res.json()) as { draft_updated_at: string };
          baseRef.current = body.draft_updated_at;
          conflictRef.current = false;
          setConflict(null);
          setSaveState(dirtyRef.current ? 'dirty' : 'saved');
          return true;
        } catch {
          dirtyRef.current = true;
          setSaveState('error');
          return false;
        }
      })();
      savingRef.current = run;
      const ok = await run;
      savingRef.current = null;
      return ok;
    },
    [toast],
  );

  const handleChange = useCallback(
    (data: Data) => {
      latestRef.current = data;
      dirtyRef.current = true;
      if (conflictRef.current) return;
      setSaveState('dirty');
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        void saveNow();
      }, AUTOSAVE_MS);
    },
    [saveNow],
  );

  useEffect(() => {
    const onPageHide = () => {
      if (!dirtyRef.current || conflictRef.current || !latestRef.current) return;
      const body = JSON.stringify({ data: latestRef.current, base_updated_at: baseRef.current });
      if (body.length > KEEPALIVE_MAX_BYTES) return;
      void fetch(
        API,
        ({ ...platformAdminFetchInit, 
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body,
          keepalive: true,
        }),
      ).catch(() => undefined);
    };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('beforeunload', onBeforeUnload);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const loadTheirVersion = useCallback(async () => {
    try {
      const page = await fetchPage();
      setMeta(page);
      loadDocument(
        prepareDocument(page.draft ?? page.published ?? buildDefaultHomeDocument()),
        page.draft ? page.draft_updated_at : null,
      );
      toast.info('Loaded the latest saved draft');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not reload the page');
    }
  }, [fetchPage, loadDocument, toast]);

  const keepMine = useCallback(async () => {
    conflictRef.current = false;
    setConflict(null);
    const ok = await saveNow(true);
    if (ok) toast.success('Your version was saved');
  }, [saveNow, toast]);

  const publish = useCallback(async () => {
    if (!meta?.can_publish || !latestRef.current) return;
    if (!window.confirm('Publish this page? It goes live on khatario.com right away.')) return;
    setPublishing(true);
    try {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (savingRef.current) await savingRef.current;
      const res = await fetch(
        `${API}/publish`,
        ({ ...platformAdminFetchInit, 
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: latestRef.current }),
        }),
      );
      if (!res.ok) {
        toast.error(await readError(res, 'Could not publish'));
        return;
      }
      const body = (await res.json()) as { published_at?: string };
      dirtyRef.current = false;
      baseRef.current = null;
      conflictRef.current = false;
      setConflict(null);
      setSaveState('idle');
      setStaleNotice(null);
      setVersions(null);
      setMeta((m) =>
        m ? { ...m, draft: null, draft_updated_at: null, published_at: body.published_at ?? new Date().toISOString() } : m,
      );
      toast.success('Published. The live site is updated.');
    } finally {
      setPublishing(false);
    }
  }, [meta?.can_publish, toast]);

  const discardDraft = useCallback(async () => {
    if (!window.confirm('Discard all unpublished changes and go back to the live version?')) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    if (savingRef.current) await savingRef.current;
    const res = await fetch(API, ({ ...platformAdminFetchInit,  method: 'DELETE' }));
    if (!res.ok) {
      toast.error(await readError(res, 'Could not discard the draft'));
      return;
    }
    const source = meta?.published ?? buildDefaultHomeDocument();
    loadDocument(prepareDocument(source), null);
    setStaleNotice(null);
    toast.success('Draft discarded');
  }, [loadDocument, meta?.published, toast]);

  const resetToDefault = useCallback(async () => {
    if (!window.confirm('Replace the draft with the original Khatario home page? You can still discard before publishing.')) {
      return;
    }
    const doc = prepareDocument(buildDefaultHomeDocument());
    latestRef.current = doc;
    setInitialData(doc);
    setDocKey((k) => k + 1);
    dirtyRef.current = true;
    await saveNow();
  }, [saveNow]);

  const openVersions = useCallback(async () => {
    setVersionsOpen(true);
    setVersions(null);
    const res = await fetch(`${API}/versions`, ({ ...platformAdminFetchInit,  cache: 'no-store' }));
    if (!res.ok) {
      toast.error(await readError(res, 'Could not load version history'));
      setVersions([]);
      return;
    }
    const body = (await res.json()) as { versions?: VersionRow[] };
    setVersions(body.versions ?? []);
  }, [toast]);

  const restoreVersion = useCallback(
    async (id: string) => {
      if (!window.confirm('Load this version into the draft? Your current unpublished changes will be replaced.')) return;
      setRestoringId(id);
      try {
        if (timerRef.current) clearTimeout(timerRef.current);
        if (savingRef.current) await savingRef.current;
        const res = await fetch(`${API}/versions/${id}/restore`, ({ ...platformAdminFetchInit,  method: 'POST' }));
        if (!res.ok) {
          toast.error(await readError(res, 'Could not restore this version'));
          return;
        }
        const body = (await res.json()) as { data: MarketingDocument; draft_updated_at: string };
        loadDocument(prepareDocument(body.data), body.draft_updated_at);
        setVersionsOpen(false);
        toast.success('Version loaded into the draft. Publish to make it live.');
      } finally {
        setRestoringId(null);
      }
    },
    [loadDocument, toast],
  );

  if (loadError) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-gray-50 p-6 text-center">
        <AlertTriangle className="h-10 w-10 text-amber-500" />
        <p className="max-w-md text-gray-700">{loadError}</p>
        <Link href="/admin" className="text-sm font-medium text-primary-700 hover:underline">
          Back to admin
        </Link>
      </div>
    );
  }

  if (!meta || !initialData) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
      </div>
    );
  }

  const statusLabel: Record<SaveState, string> = {
    idle: meta.published_at ? `Live since ${formatWhen(meta.published_at)}` : 'Not published yet',
    dirty: 'Unsaved changes',
    saving: 'Saving…',
    saved: 'Draft saved',
    error: 'Save failed. Retrying on next change.',
    conflict: 'Save paused: conflict',
  };

  const headerActions = () => (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span
        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
          saveState === 'error' || saveState === 'conflict'
            ? 'bg-red-50 text-red-700'
            : saveState === 'saved'
              ? 'bg-emerald-50 text-emerald-700'
              : 'bg-gray-100 text-gray-600'
        }`}
        aria-live="polite"
        data-testid="site-builder-save-status"
      >
        {saveState === 'saving' ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
        {saveState === 'saved' ? <CheckCircle2 className="h-3 w-3" /> : null}
        {statusLabel[saveState]}
      </span>
      <a
        href={PREVIEW_PATH}
        target="_blank"
        rel="noreferrer"
        onClick={(e) => {
          e.preventDefault();
          const win = window.open('about:blank', '_blank');
          void saveNow().then(() => {
            if (win) win.location.href = PREVIEW_PATH;
          });
        }}
        className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 font-medium text-gray-700 hover:bg-gray-50"
      >
        <ExternalLink className="h-3.5 w-3.5" />
        Preview
      </a>
      <button
        type="button"
        onClick={() => void openVersions()}
        className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 font-medium text-gray-700 hover:bg-gray-50"
      >
        <History className="h-3.5 w-3.5" />
        History
      </button>
      <button
        type="button"
        onClick={() => void resetToDefault()}
        className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 font-medium text-gray-700 hover:bg-gray-50"
      >
        <RotateCcw className="h-3.5 w-3.5" />
        Reset
      </button>
      <button
        type="button"
        onClick={() => void discardDraft()}
        disabled={!baseRef.current && saveState !== 'dirty'}
        className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Trash2 className="h-3.5 w-3.5" />
        Discard
      </button>
      <span title={meta.can_publish ? undefined : 'Only super admins can publish'}>
        <button
          type="button"
          onClick={() => void publish()}
          disabled={!meta.can_publish || publishing}
          data-testid="site-builder-publish"
          className="inline-flex items-center gap-1 rounded-md bg-primary-600 px-3 py-1.5 font-semibold text-white hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {publishing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
          Publish
        </button>
      </span>
    </div>
  );

  return (
    <div className="flex h-screen flex-col">
      <div className="flex items-center gap-3 border-b border-gray-800 bg-gray-900 px-3 py-1.5 text-xs text-gray-300">
        <Link href="/admin" className="inline-flex items-center gap-1 font-medium text-white hover:text-primary-300">
          <ArrowLeft className="h-3.5 w-3.5" />
          Admin
        </Link>
        <span className="text-gray-500">/</span>
        <span>Site Builder: Home page</span>
        {!meta.can_publish ? (
          <span className="ml-auto text-amber-300">You can edit the draft. Only super admins can publish.</span>
        ) : null}
      </div>

      {conflict ? (
        <div className="flex flex-wrap items-center gap-3 border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            {conflict.by || 'Another admin'} saved this page on {formatWhen(conflict.at)} while you were editing. Autosave is
            paused.
          </span>
          <button
            type="button"
            onClick={() => void loadTheirVersion()}
            className="rounded-md border border-red-300 bg-white px-2.5 py-1 font-medium hover:bg-red-100"
          >
            Load their version
          </button>
          <button
            type="button"
            onClick={() => void keepMine()}
            className="rounded-md bg-red-600 px-2.5 py-1 font-medium text-white hover:bg-red-700"
          >
            Keep mine and overwrite
          </button>
        </div>
      ) : null}

      {staleNotice && !conflict ? (
        <div className="flex items-center gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span className="flex-1">{staleNotice}</span>
          <button type="button" onClick={() => setStaleNotice(null)} aria-label="Dismiss" className="rounded p-1 hover:bg-amber-100">
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : null}

      <div className="min-h-0 flex-1">
        <LandingProductProvider>
          <LandingPlansProvider>
            <Puck
              key={docKey}
              config={marketingConfig}
              data={initialData}
              onChange={handleChange}
              headerTitle="Home page"
              headerPath="/"
              viewports={VIEWPORTS}
              iframe={{ enabled: true, waitForStyles: true }}
              height="100%"
              overrides={{ headerActions }}
            />
          </LandingPlansProvider>
        </LandingProductProvider>
      </div>

      {versionsOpen ? (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
          <div className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
              <h2 className="text-base font-semibold text-gray-900">Published versions</h2>
              <button type="button" onClick={() => setVersionsOpen(false)} aria-label="Close" className="rounded p-1 hover:bg-gray-100">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="overflow-y-auto p-2">
              {versions === null ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-primary-600" />
                </div>
              ) : versions.length === 0 ? (
                <p className="px-3 py-8 text-center text-sm text-gray-500">Nothing has been published yet.</p>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {versions.map((v, i) => (
                    <li key={v.id} className="flex items-center gap-3 px-3 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-900">
                          {formatWhen(v.created_at)}
                          {i === 0 ? (
                            <span className="ml-2 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">Live</span>
                          ) : null}
                        </p>
                        <p className="text-xs text-gray-500">
                          {v.published_by_name || 'Unknown admin'} · {v.block_count} sections
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void restoreVersion(v.id)}
                        disabled={restoringId !== null}
                        className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                      >
                        {restoringId === v.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
                        Load into draft
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
