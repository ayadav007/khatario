'use client';

export const dynamic = 'force-dynamic';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Camera, CheckCircle2, ExternalLink, ImagePlus, Keyboard, Loader2, Package, ScanLine } from 'lucide-react';
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
import {
  emptyScanAddForm,
  fillFromFacts,
  scanAddItemPayload,
  validateScanAddForm,
  type ScanAddForm,
  type ScanAddFormErrors,
} from '@/lib/items/scan-add-form';

// Same stock units the New Item form offers. The pack size ("100 g") goes in Size on pack.
const UNITS = ['PCS', 'KG', 'BOX', 'LTR', 'MTR', 'NOS'];
const SESSION_KEY = 'khatario.scan-add.session';

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

interface SessionEntry {
  barcode: string;
  name: string;
  itemId: string;
  outcome: 'created' | 'existing';
  qty: number;
}

function readSession(): SessionEntry[] {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as SessionEntry[]) : [];
  } catch {
    return [];
  }
}

function writeSession(entries: SessionEntry[]) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(entries));
  } catch {
    // Storage blocked: the list just won't survive a reload.
  }
}

function newIdempotencyKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function ScanAddItemsPage() {
  const toast = useToastContext();
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
  // One key per product being added, reused when a failed save is retried.
  const saveKeyRef = useRef<string>(newIdempotencyKey());
  // Only the latest lookup may change the screen; an older reply for another barcode is dropped.
  const lookupSeqRef = useRef(0);

  useEffect(() => setSession(readSession()), []);

  const remember = useCallback((entry: SessionEntry) => {
    setSession((prev) => {
      const next = [entry, ...prev.filter((e) => e.itemId !== entry.itemId)];
      writeSession(next);
      return next;
    });
  }, []);

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
      setForm((f) => fillFromFacts(f, { name: r.name, brand: r.brand, quantity: r.size, mrp: r.mrp }));
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

  const save = async () => {
    const found = validateScanAddForm(form);
    setErrors(found);
    if (Object.values(found).some(Boolean)) return;
    setSaving(true);
    try {
      const res = await fetch('/api/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': saveKeyRef.current },
        body: JSON.stringify(scanAddItemPayload(form, lookupSource)),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not save the item');
      const item = data.item as { id: string; name: string };
      remember({
        barcode: form.barcode,
        name: item.name,
        itemId: item.id,
        outcome: 'created',
        qty: Number(form.opening_stock) || 0,
      });
      toast.success(`${item.name} added`);
      setStep({ kind: 'scan' });
    } catch (e) {
      // Keep everything typed; retrying sends the same key, so it cannot add the item twice.
      toast.error(e instanceof Error ? e.message : 'Could not save the item');
    } finally {
      setSaving(false);
    }
  };

  const created = session.filter((e) => e.outcome === 'created').length;

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
          This session: <strong>{created}</strong> added
          {session.length > created ? `, ${session.length - created} already in shop` : ''}
        </span>
        {session.length > 0 ? (
          <button
            type="button"
            className="text-text-secondary underline"
            onClick={() => {
              writeSession([]);
              setSession([]);
            }}
          >
            Clear list
          </button>
        ) : null}
      </div>

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
        <Card className="space-y-3 p-4">
          <div className="flex items-start gap-3">
            <Package className="mt-0.5 h-5 w-5 text-text-secondary" />
            <div>
              <p className="font-semibold">Already in your shop</p>
              <p>{step.match.item.name}</p>
              <p className="text-sm text-text-secondary">
                Barcode {step.barcode} · Stock {step.match.item.current_stock} {step.match.item.unit ?? ''}
                {step.match.variants.length > 0
                  ? ` · Sizes: ${step.match.variants.map((v) => v.variant_name).join(', ')}`
                  : ''}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => {
                remember({
                  barcode: step.barcode,
                  name: step.match.item.name,
                  itemId: step.match.item.id,
                  outcome: 'existing',
                  qty: 0,
                });
                setStep({ kind: 'scan' });
              }}
            >
              Skip, scan next
            </Button>
            <Link href={`/items/${step.match.item.id}`}>
              <Button variant="secondary">Open item</Button>
            </Link>
          </div>
        </Card>
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
              <li key={e.itemId} className="flex items-center justify-between gap-2 py-2">
                <Link href={`/items/${e.itemId}`} className="truncate hover:underline">
                  {e.name}
                </Link>
                <span className="flex shrink-0 items-center gap-1 text-text-secondary">
                  {e.outcome === 'created' ? (
                    <>
                      <CheckCircle2 className="h-4 w-4 text-success" />
                      Added{e.qty ? ` · ${e.qty}` : ''}
                    </>
                  ) : (
                    'Already in shop'
                  )}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {showCamera ? (
        <BarcodeScanner
          feature="items_scan_onboarding"
          onScan={(code) => void lookUp(code)}
          onClose={() => setShowCamera(false)}
        />
      ) : null}
    </div>
  );
}

export default withPageAuth('items', 'create', ScanAddItemsPage);
