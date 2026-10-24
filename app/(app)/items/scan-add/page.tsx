'use client';

export const dynamic = 'force-dynamic';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Camera, CheckCircle2, ExternalLink, ImagePlus, Keyboard, Loader2, ScanLine } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { BarcodeScanner } from '@/components/ui/BarcodeScanner';
import { useToastContext } from '@/contexts/ToastContext';
import { withPageAuth } from '@/lib/auth/withPageAuth';
import { GST_RATE_SLABS } from '@/lib/gst/rates';
import type { ShopBarcodeMatch } from '@/lib/items/scan-add-lookup';
import type { ProductLookupResult, ProductSuggestion } from '@/lib/product-lookup/types';
import type { LabelReading, LabelStep } from '@/lib/product-lookup/label-reader';
import { ScanAddExistingActions } from '@/components/items/ScanAddExistingActions';
import { ScanAddReview } from '@/components/items/ScanAddReview';
import type { ReviewItem } from '@/lib/items/scan-add-review';
import {
  addSessionEntry,
  reviewItemIds,
  summarizeSession,
  type ScanAddSessionEntry,
} from '@/lib/items/scan-add-session';
import { useCapabilityCheck } from '@/hooks/useCapability';
import { useAuth } from '@/contexts/AuthContext';
import {
  hasUnfinishedProduct,
  loadDraft,
  saveDraft,
  type DraftStore,
  type ScanAddCurrentDraft,
} from '@/lib/items/scan-add-draft';
import {
  emptyScanAddForm,
  fillBatch,
  fillFromFacts,
  scanAddItemPayload,
  validateScanAddForm,
  type ScanAddForm,
  type ScanAddFormErrors,
} from '@/lib/items/scan-add-form';

// Same stock units the New Item form offers. The pack size ("100 g") goes in Size on pack.
const UNITS = ['PCS', 'KG', 'BOX', 'LTR', 'MTR', 'NOS'];

/** localStorage, or null where the browser blocks it (the page then works without a draft). */
function draftStore(): DraftStore | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

type Step =
  | { kind: 'scan' }
  | { kind: 'checking'; barcode: string }
  | { kind: 'existing'; barcode: string; match: ShopBarcodeMatch }
  | { kind: 'looking'; barcode: string }
  | { kind: 'photo'; barcode: string; queue: LabelStep[] }
  | { kind: 'new'; barcode: string };

const PHOTO_STEPS: Record<LabelStep, { title: string; hint: string }> = {
  front: { title: 'Photo of the name', hint: 'The front of the pack, where the brand and product name are printed.' },
  details: { title: 'Photo of MRP, batch and expiry', hint: 'The panel where MRP, batch number and dates are printed together.' },
  size: { title: 'Photo of the pack size', hint: 'Where the net weight or volume is printed, e.g. 100 g or 500 ml.' },
};

type SessionEntry = ScanAddSessionEntry;

function newIdempotencyKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function ScanAddItemsPage() {
  const toast = useToastContext();
  const { business, user } = useAuth();
  const { hasCapability, snapshotLoaded } = useCapabilityCheck();
  const [step, setStep] = useState<Step>({ kind: 'scan' });
  const [showCamera, setShowCamera] = useState(false);
  const [manualCode, setManualCode] = useState('');
  const [session, setSession] = useState<SessionEntry[]>([]);
  const [form, setForm] = useState<ScanAddForm>(emptyScanAddForm(''));
  const [errors, setErrors] = useState<ScanAddFormErrors>({});
  const [saving, setSaving] = useState(false);
  const [lookup, setLookup] = useState<ProductLookupResult | null>(null);
  // The database whose suggestion filled the form, while the shopkeeper keeps it.
  const [lookupSource, setLookupSource] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);
  // Whether a label photo filled any of the current product's details.
  const usedPhotoRef = useRef(false);
  const [review, setReview] = useState<{
    open: boolean;
    loading: boolean;
    items: ReviewItem[];
    filter: 'all' | 'details' | 'failed';
    retrying: string | null;
  }>({ open: false, loading: false, items: [], filter: 'all', retrying: null });
  // One key per product being added, reused when a failed save is retried.
  const saveKeyRef = useRef<string>(newIdempotencyKey());
  // Only the latest lookup may change the screen; an older reply for another barcode is dropped.
  const lookupSeqRef = useRef(0);

  // The draft belongs to this business and user. Until it is loaded nothing is written, so an empty
  // screen never overwrites a saved draft; a business switch loads that business's own draft.
  const owner = business?.id && user?.id ? { businessId: business.id, userId: user.id } : null;
  const ownerKey = owner ? `${owner.businessId}:${owner.userId}` : null;
  const [loadedOwner, setLoadedOwner] = useState<string | null>(null);
  const [resume, setResume] = useState<ScanAddCurrentDraft | null>(null);

  const loadedOwnerRef = useRef<string | null>(null);
  useEffect(() => {
    if (!owner || !ownerKey || loadedOwnerRef.current === ownerKey) return;
    const store = draftStore();
    const draft = store ? loadDraft(store, owner.businessId, owner.userId) : null;
    const saved = draft?.entries ?? [];
    if (loadedOwnerRef.current !== null) {
      // A real business (or user) switch: nothing from the previous one stays on screen.
      lookupSeqRef.current++;
      setSession(saved);
      setStep({ kind: 'scan' });
      setReview({ open: false, loading: false, items: [], filter: 'all', retrying: null });
      setForm(emptyScanAddForm(''));
    } else {
      // First load: the shopkeeper may already have scanned before the session arrived. Keep that.
      setSession((prev) => [...saved, ...prev.filter((e) => !saved.some((s) => s.key === e.key))]);
    }
    setResume(draft && hasUnfinishedProduct(draft.current) ? draft.current : null);
    loadedOwnerRef.current = ownerKey;
    setLoadedOwner(ownerKey);
    // owner is derived from ownerKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerKey]);

  // Keep the draft in step with the screen: the session rows, plus the product being filled in.
  useEffect(() => {
    if (!owner || loadedOwner !== ownerKey) return;
    const store = draftStore();
    if (!store) return;
    const filling = step.kind === 'new' || step.kind === 'photo';
    const current: ScanAddCurrentDraft | null = filling
      ? { barcode: step.barcode, form, idempotencyKey: saveKeyRef.current, lookupSource, usedPhoto: usedPhotoRef.current }
      : resume;
    saveDraft(store, {
      businessId: owner.businessId,
      userId: owner.userId,
      entries: session,
      current: hasUnfinishedProduct(current) ? current : null,
    });
    // owner is derived from ownerKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, form, step, lookupSource, resume, loadedOwner, ownerKey]);

  const remember = useCallback((entry: Omit<SessionEntry, 'key'> & { key?: string }) => {
    setSession((prev) => addSessionEntry(prev, { ...entry, key: entry.key ?? newIdempotencyKey() }));
  }, []);

  const forget = useCallback((key: string) => {
    setSession((prev) => prev.filter((e) => e.key !== key));
  }, []);

  /** Back to the product that was being filled in, with its original retry key. */
  const resumeProduct = () => {
    if (!resume) return;
    lookupSeqRef.current++;
    saveKeyRef.current = resume.idempotencyKey;
    setForm({ ...emptyScanAddForm(resume.barcode), ...resume.form });
    setLookup(null);
    setLookupSource(resume.lookupSource);
    usedPhotoRef.current = resume.usedPhoto;
    setErrors({});
    setResume(null);
    setStep({ kind: 'new', barcode: resume.barcode });
  };

  const discardResume = () => {
    if (!window.confirm('Discard this unfinished product? What was typed for it will be lost.')) return;
    setResume(null);
  };

  /**
   * A product the shop does not have: ask the product databases, then the label photos.
   * Found in a database → only the MRP/batch/expiry photo, since those belong to the stock in hand.
   * Not found, or no barcode → name, details and size photos. Every photo can be skipped.
   */
  const startNew = useCallback(
    async (barcode: string, seq: number) => {
      saveKeyRef.current = newIdempotencyKey();
      setForm(emptyScanAddForm(barcode));
      setErrors({});
      setLookup(null);
      setLookupSource(null);
      usedPhotoRef.current = false;
      if (!barcode) {
        setStep({ kind: 'photo', barcode, queue: ['front', 'details', 'size'] });
        return;
      }
      setStep({ kind: 'looking', barcode });
      let result: ProductLookupResult | null = null;
      try {
        const res = await fetch(`/api/items/scan-add/lookup?code=${encodeURIComponent(barcode)}`);
        if (res.ok) result = (await res.json()) as ProductLookupResult;
      } catch {
        result = null;
      }
      if (seq !== lookupSeqRef.current) return;
      const best: ProductSuggestion | undefined = result?.suggestions[0];
      if (result && best) {
        const sizeInDoubt = result.conflicts.some((c) => c.field === 'quantity');
        setLookup(result);
        setLookupSource(best.provider);
        setForm((f) => fillFromFacts(f, best, { sizeInDoubt }));
        setStep({ kind: 'photo', barcode, queue: ['details'] });
      } else {
        if (result?.status === 'unavailable' || !result) {
          toast.error('Product databases did not answer. Add the details from the label.');
        }
        setStep({ kind: 'photo', barcode, queue: ['front', 'details', 'size'] });
      }
    },
    [toast]
  );

  const nextPhoto = useCallback((barcode: string, queue: LabelStep[]) => {
    const rest = queue.slice(1);
    setStep(rest.length ? { kind: 'photo', barcode, queue: rest } : { kind: 'new', barcode });
  }, []);

  const readPhoto = async (file: File, barcode: string, queue: LabelStep[]) => {
    setReading(true);
    try {
      const body = new FormData();
      body.append('image', file);
      body.append('step', queue[0]);
      const res = await fetch('/api/items/scan-add/read-label', { method: 'POST', body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not read this photo');
      const r = data.reading as LabelReading;
      usedPhotoRef.current = true;
      setForm((f) => fillBatch(fillFromFacts(f, { name: r.name, brand: r.brand, quantity: r.size, mrp: r.mrp }), r));
      // Once any photo has shown the pack size, the size photo is not asked for.
      nextPhoto(barcode, r.size ? queue.filter((q, i) => i === 0 || q !== 'size') : queue);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not read this photo');
    } finally {
      setReading(false);
    }
  };

  const lookUp = useCallback(
    async (raw: string) => {
      const barcode = raw.replace(/\s+/g, '');
      if (!barcode) return;
      const seq = ++lookupSeqRef.current;
      setShowCamera(false);
      setManualCode('');
      setStep({ kind: 'checking', barcode });
      try {
        const res = await fetch(`/api/items/scan-add/barcode?code=${encodeURIComponent(barcode)}`);
        const data = await res.json().catch(() => ({}));
        if (seq !== lookupSeqRef.current) return;
        if (!res.ok) throw new Error(data.error || 'Could not check the barcode');
        if (data.match) setStep({ kind: 'existing', barcode, match: data.match as ShopBarcodeMatch });
        else void startNew(barcode, seq);
      } catch (e) {
        if (seq !== lookupSeqRef.current) return;
        toast.error(e instanceof Error ? e.message : 'Could not check the barcode');
        // The shopkeeper can still add the item by hand.
        void startNew(barcode, seq);
      }
    },
    [startNew, toast]
  );

  const setField = (field: keyof ScanAddForm) => (e: { target: { value: string } }) => {
    setForm((f) => ({ ...f, [field]: e.target.value }));
    setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  /**
   * Sends one new item. A failure is kept in the session with the form and its retry key, so it can
   * be retried or fixed from the review; a later success with the same key replaces that row.
   */
  const sendItem = async (f: ScanAddForm, source: string | null, key: string, origin: ScanAddSessionEntry['source']) => {
    try {
      const res = await fetch('/api/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': key },
        body: JSON.stringify(scanAddItemPayload(f, source)),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not save the item');
      const item = data.item as { id: string; name: string };
      remember({ barcode: f.barcode, name: item.name, itemId: item.id, outcome: 'created', qty: Number(f.opening_stock) || 0, source: origin, idempotencyKey: key });
      return item;
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not save the item';
      remember({
        barcode: f.barcode,
        name: f.name.trim() || f.barcode || 'Unnamed product',
        itemId: null,
        outcome: 'failed',
        qty: Number(f.opening_stock) || 0,
        source: origin,
        payload: { form: f, lookupSource: source },
        idempotencyKey: key,
        error: message,
      });
      throw new Error(message);
    }
  };

  const save = async () => {
    const found = validateScanAddForm(form);
    setErrors(found);
    if (Object.values(found).some(Boolean)) return;
    setSaving(true);
    try {
      const origin = lookupSource ? 'database' : usedPhotoRef.current ? 'photo' : 'manual';
      const item = await sendItem(form, lookupSource, saveKeyRef.current, origin);
      toast.success(`${item.name} added`);
      setStep({ kind: 'scan' });
    } catch (e) {
      // Keep everything typed; retrying sends the same key, so it cannot add the item twice.
      toast.error(e instanceof Error ? e.message : 'Could not save the item');
    } finally {
      setSaving(false);
    }
  };

  const loadReview = useCallback(async (entries: SessionEntry[]) => {
    setReview((r) => ({ ...r, loading: true }));
    try {
      const res = await fetch('/api/items/scan-add/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_ids: reviewItemIds(entries) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not load the review');
      setReview((r) => ({ ...r, items: (data.items ?? []) as ReviewItem[], loading: false }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not load the review');
      setReview((r) => ({ ...r, loading: false }));
    }
  }, [toast]);

  const retryFailed = async (entry: SessionEntry) => {
    const payload = entry.payload as { form?: ScanAddForm; lookupSource?: string | null } | undefined;
    if (!payload?.form || !entry.idempotencyKey) return;
    setReview((r) => ({ ...r, retrying: entry.key }));
    try {
      const item = await sendItem(payload.form, payload.lookupSource ?? null, entry.idempotencyKey, entry.source);
      toast.success(`${item.name} added`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save the item');
    } finally {
      setReview((r) => ({ ...r, retrying: null }));
    }
  };

  const editFailed = (entry: SessionEntry) => {
    const payload = entry.payload as { form?: ScanAddForm; lookupSource?: string | null } | undefined;
    if (!payload?.form || !entry.idempotencyKey) return;
    saveKeyRef.current = entry.idempotencyKey;
    setForm({ ...emptyScanAddForm(payload.form.barcode), ...payload.form });
    setLookup(null);
    setLookupSource(null);
    setErrors({});
    usedPhotoRef.current = entry.source === 'photo';
    setReview((r) => ({ ...r, open: false }));
    setStep({ kind: 'new', barcode: payload.form.barcode });
  };

  const summary = summarizeSession(session, review.items);
  const created = session.filter((e) => e.outcome !== 'existing' && e.outcome !== 'failed').length;

  return (
    <div className="mx-auto max-w-2xl space-y-4 pb-24">
      <PageHeader
        title="Scan & Add Items"
        subtitle="Scan each product once, check its details, enter the stock you have."
        icon={ScanLine}
        actions={
          <Link href="/items">
            <Button variant="secondary" className="h-10 px-4">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Items
            </Button>
          </Link>
        }
      />

      <div className="flex items-center justify-between rounded-lg border border-border bg-surface px-4 py-3 text-sm">
        <span>
          This session: <strong>{created}</strong> saved
          {summary.existing ? `, ${summary.existing} already in shop` : ''}
          {summary.failed ? <span className="text-red-600">, {summary.failed} not saved</span> : null}
        </span>
        {session.length > 0 && !review.open ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setReview((r) => ({ ...r, open: true, filter: 'all' }));
              void loadReview(session);
            }}
          >
            Review and finish
          </Button>
        ) : null}
      </div>
      {session.some((e) => e.outcome === 'failed') || resume ? (
        <p className="-mt-2 text-xs text-text-secondary">
          Products marked not saved are kept on this device only until they are saved.
        </p>
      ) : null}

      {resume && !review.open && step.kind === 'scan' ? (
        <Card className="space-y-3 border-amber-300 p-4">
          <div>
            <p className="font-semibold">Unfinished product on this device</p>
            <p className="text-sm text-text-secondary">
              {resume.form.name.trim() || 'No name yet'}
              {resume.barcode ? ` · Barcode ${resume.barcode}` : ''}
              {resume.form.opening_stock.trim() ? ` · Stock ${resume.form.opening_stock}` : ''}. Not saved to your shop yet.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={resumeProduct}>Continue</Button>
            <Button variant="secondary" onClick={discardResume}>
              Discard
            </Button>
          </div>
        </Card>
      ) : null}

      {review.open ? (
        <ScanAddReview
          summary={summary}
          entries={session}
          items={review.items}
          loading={review.loading}
          filter={review.filter}
          retrying={review.retrying}
          onFilter={(filter) => setReview((r) => ({ ...r, filter }))}
          onRefresh={() => void loadReview(session)}
          onRetry={(e) => void retryFailed(e)}
          onEdit={editFailed}
          onDiscard={forget}
          onBack={() => setReview((r) => ({ ...r, open: false }))}
          onFinish={() => {
            if (summary.failed > 0 && !window.confirm(`${summary.failed} products were not saved. Finish anyway and drop them?`)) return;
            // An empty session and no product in progress removes the draft from this device.
            setSession([]);
            setResume(null);
            setReview({ open: false, loading: false, items: [], filter: 'all', retrying: null });
            setStep({ kind: 'scan' });
            toast.success('Session finished');
          }}
        />
      ) : (
        <>

      {step.kind === 'scan' ? (
        <Card className="space-y-4 p-4">
          <Button className="h-12 w-full" onClick={() => setShowCamera(true)}>
            <Camera className="mr-2 h-5 w-5" />
            Scan barcode
          </Button>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void lookUp(manualCode);
            }}
          >
            <Input
              aria-label="Barcode"
              placeholder="Or type the barcode"
              inputMode="numeric"
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value)}
              icon={<Keyboard className="h-4 w-4" />}
            />
            <Button type="submit" variant="secondary" disabled={!manualCode.trim()}>
              Check
            </Button>
          </form>
          <button
            type="button"
            className="w-full text-center text-sm text-text-secondary underline"
            onClick={() => void startNew('', ++lookupSeqRef.current)}
          >
            Product has no barcode
          </button>
        </Card>
      ) : null}

      {step.kind === 'checking' ? (
        <Card className="flex items-center gap-3 p-4">
          <Loader2 className="h-5 w-5 animate-spin" />
          Checking {step.barcode}…
        </Card>
      ) : null}

      {step.kind === 'looking' ? (
        <Card className="flex items-center gap-3 p-4">
          <Loader2 className="h-5 w-5 animate-spin" />
          Not in your shop yet. Looking up {step.barcode} in product databases…
        </Card>
      ) : null}

      {step.kind === 'photo' ? (
        <Card className="space-y-4 p-4">
          <div>
            <p className="font-semibold">{PHOTO_STEPS[step.queue[0]].title}</p>
            <p className="text-sm text-text-secondary">{PHOTO_STEPS[step.queue[0]].hint}</p>
            {lookup?.suggestions.length ? (
              <p className="mt-2 text-sm">
                Found <strong>{form.name}</strong> in a product database. You can check the details after this photo.
              </p>
            ) : null}
          </div>
          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void readPhoto(file, step.barcode, step.queue);
            }}
          />
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => photoInputRef.current?.click()} disabled={reading}>
              {reading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ImagePlus className="mr-2 h-4 w-4" />}
              {reading ? 'Reading the label…' : 'Take photo'}
            </Button>
            <Button variant="secondary" onClick={() => nextPhoto(step.barcode, step.queue)} disabled={reading}>
              Skip
            </Button>
            <Button variant="ghost" onClick={() => setStep({ kind: 'new', barcode: step.barcode })} disabled={reading}>
              Type details instead
            </Button>
          </div>
        </Card>
      ) : null}

      {step.kind === 'existing' ? (
        <ScanAddExistingActions
          key={`${step.barcode}-${lookupSeqRef.current}`}
          barcode={step.barcode}
          match={step.match}
          canAddStock={snapshotLoaded && hasCapability('purchase_inventory_adjustments', 'view')}
          onDone={(done) => {
            remember({ barcode: step.barcode, name: done.name, itemId: done.itemId, outcome: done.outcome, qty: done.qty });
            setStep({ kind: 'scan' });
          }}
        />
      ) : null}

      {step.kind === 'new' ? (
        <Card className="space-y-4 p-4">
          <div>
            <p className="font-semibold">New product</p>
            <p className="text-sm text-text-secondary">
              {step.barcode ? `Barcode ${step.barcode} is not in your shop yet.` : 'Adding a product without a barcode.'}
            </p>
          </div>
          {lookup?.suggestions.length ? (
            <div className="space-y-2 rounded-md border border-border p-3 text-sm">
              <p>
                {lookupSource
                  ? 'Filled from a product database. Check the name and pack size against the pack before saving.'
                  : 'Database details not used for this product.'}
              </p>
              {lookupSource
                ? lookup.conflicts.map((c) => (
                    <div key={c.field}>
                      <p className="text-text-secondary">
                        Databases disagree on the {c.field === 'quantity' ? 'pack size' : c.field}. Pick the one on the pack:
                      </p>
                      <div className="mt-1 flex flex-wrap gap-2">
                        {c.values.map((v) => (
                          <Button
                            key={v}
                            size="sm"
                            variant="secondary"
                            onClick={() =>
                              setForm((f) =>
                                c.field === 'quantity' ? { ...f, size: v } : c.field === 'brand' ? { ...f, brand: v } : { ...f, name: v }
                              )
                            }
                          >
                            {v}
                          </Button>
                        ))}
                      </div>
                    </div>
                  ))
                : null}
              <p className="flex flex-wrap gap-x-3 text-xs text-text-secondary">
                {lookup.suggestions.map((sg) => (
                  <a
                    key={sg.provider}
                    href={sg.source_url ?? '#'}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 underline"
                  >
                    {sg.attribution}
                    {sg.certainty !== null ? ` · match ${sg.certainty}/100` : ''}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                ))}
                {lookupSource ? (
                  <button
                    type="button"
                    className="underline"
                    onClick={() => {
                      setLookupSource(null);
                      setForm((f) => ({ ...emptyScanAddForm(f.barcode), purchase_price: f.purchase_price, opening_stock: f.opening_stock }));
                    }}
                  >
                    Wrong product? Clear it
                  </button>
                ) : null}
              </p>
            </div>
          ) : null}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input label="Product name *" value={form.name} onChange={setField('name')} error={errors.name} placeholder="Parle-G Biscuit" />
            <Input label="Brand" value={form.brand} onChange={setField('brand')} placeholder="Parle" />
            <Input label="Size on pack" value={form.size} onChange={setField('size')} placeholder="100 g" />
            <div>
              <label className="type-label mb-1.5 block">Unit</label>
              <select className="input" value={form.unit} onChange={setField('unit')}>
                {UNITS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </div>
            <Input label="Barcode" value={form.barcode} onChange={setField('barcode')} inputMode="numeric" />
            <Input label="MRP (₹)" type="number" min={0} step="0.01" value={form.mrp} onChange={setField('mrp')} error={errors.mrp} />
            <Input label="Selling price (₹)" type="number" min={0} step="0.01" value={form.selling_price} onChange={setField('selling_price')} error={errors.selling_price} />
            <Input label="Purchase price (₹)" type="number" min={0} step="0.01" value={form.purchase_price} onChange={setField('purchase_price')} error={errors.purchase_price} />
            <div>
              <label className="type-label mb-1.5 block">GST rate</label>
              <select className="input" value={form.tax_rate} onChange={setField('tax_rate')}>
                {GST_RATE_SLABS.map((r) => (
                  <option key={r} value={String(r)}>
                    {r}%
                  </option>
                ))}
              </select>
            </div>
            <Input label="HSN" value={form.hsn_sac} onChange={setField('hsn_sac')} error={errors.hsn_sac} inputMode="numeric" placeholder="Optional" />
            <Input label="Stock you have now" type="number" min={0} step="any" value={form.opening_stock} onChange={setField('opening_stock')} error={errors.opening_stock} placeholder="0" />
            <Input label="Batch no." value={form.batch_number} onChange={setField('batch_number')} placeholder="Optional" />
            <Input label="Mfg date" value={form.manufacturing_date} onChange={setField('manufacturing_date')} error={errors.manufacturing_date} placeholder="2026-09" />
            <Input label="Expiry date" value={form.expiry_date} onChange={setField('expiry_date')} error={errors.expiry_date} placeholder="2027-03" />
            {form.batch_number || form.manufacturing_date || form.expiry_date ? (
              <p className="text-xs text-text-secondary sm:col-span-2">
                The stock you have is saved in this batch, and sales use the oldest batch first.
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void save()} disabled={saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save and scan next
            </Button>
            <Button variant="secondary" onClick={() => setStep({ kind: 'scan' })} disabled={saving}>
              Cancel
            </Button>
          </div>
        </Card>
      ) : null}

      {session.length > 0 ? (
        <Card className="p-4">
          <p className="mb-2 font-semibold">Scanned in this session</p>
          <ul className="divide-y divide-border text-sm">
            {session.map((e) => (
              <li key={e.key} className="flex items-center justify-between gap-2 py-2">
                {e.itemId ? (
                  <Link href={`/items/${e.itemId}`} className="truncate hover:underline">
                    {e.name}
                  </Link>
                ) : (
                  <span className="truncate">{e.name}</span>
                )}
                <span className="flex shrink-0 items-center gap-1 text-text-secondary">
                  {e.outcome === 'existing' ? (
                    'Already in shop'
                  ) : e.outcome === 'failed' ? (
                    <span className="text-red-600">Not saved, see review</span>
                  ) : (
                    <>
                      <CheckCircle2 className="h-4 w-4 text-success" />
                      {e.outcome === 'stock' ? 'Stock added' : e.outcome === 'size' ? 'Size added' : 'Added'}
                      {e.qty ? ` · ${e.qty}` : ''}
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

        </>
      )}

      {showCamera ? (
        <BarcodeScanner
          // The route is plan-gated (items_scan_onboarding); see the feature prop.
          feature={null}
          onScan={(code) => void lookUp(code)}
          onClose={() => setShowCamera(false)}
        />
      ) : null}
    </div>
  );
}

export default withPageAuth('items', 'create', ScanAddItemsPage);
