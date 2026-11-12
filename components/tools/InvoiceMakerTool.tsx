'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { INDIAN_STATES } from '@/lib/gst-utils';
import { GST_RATE_SLABS } from '@/lib/gst/rates';
import { looksLikeGstin } from '@/lib/tools/gstin';
import {
  INVOICE_DRAFT_KEY,
  calculateInvoice,
  emptyInvoiceDraft,
  parseInvoiceDraft,
  type InvoiceDraft,
  type InvoiceLine,
  type InvoiceParty,
} from '@/lib/tools/invoice-maker';
import { InvoicePreview } from '@/components/tools/InvoicePreview';

const MAX_LINES = 200;
const fieldClass =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200';
const labelClass = 'block text-xs font-medium text-slate-600 mb-1';

function localToday(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className={labelClass}>{label}</span>
      {children}
    </label>
  );
}

function PartyFields({
  title,
  party,
  onChange,
  withPhone,
}: {
  title: string;
  party: InvoiceParty;
  onChange: (p: InvoiceParty) => void;
  withPhone?: boolean;
}) {
  const set = (patch: Partial<InvoiceParty>) => onChange({ ...party, ...patch });
  const [gstinTouched, setGstinTouched] = useState(false);
  const gstinBad = party.gstin !== '' && !looksLikeGstin(party.gstin) && (party.gstin.length >= 15 || gstinTouched);
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      <Field label="Name">
        <input className={fieldClass} value={party.name} onChange={(e) => set({ name: e.target.value })} />
      </Field>
      <Field label="Address">
        <textarea className={fieldClass} rows={2} value={party.address} onChange={(e) => set({ address: e.target.value })} />
      </Field>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="GSTIN (optional)">
          <input
            className={`${fieldClass} font-mono uppercase`}
            value={party.gstin}
            onBlur={() => setGstinTouched(true)}
            onChange={(e) => set({ gstin: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 15) })}
          />
          {gstinBad && <span className="mt-1 block text-xs text-amber-700">This GSTIN does not look right</span>}
        </Field>
        <Field label="State">
          <select className={fieldClass} value={party.state} onChange={(e) => set({ state: e.target.value })}>
            <option value="">Select state</option>
            {INDIAN_STATES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
            {party.state && !(INDIAN_STATES as readonly string[]).includes(party.state) && (
              <option value={party.state}>{party.state}</option>
            )}
          </select>
        </Field>
      </div>
      {withPhone && (
        <Field label="Phone (optional)">
          <input className={fieldClass} inputMode="tel" value={party.phone ?? ''} onChange={(e) => set({ phone: e.target.value })} />
        </Field>
      )}
    </section>
  );
}

export function InvoiceMakerTool() {
  const [draft, setDraft] = useState<InvoiceDraft>(() => emptyInvoiceDraft(localToday()));
  const [ready, setReady] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftRef = useRef(draft);
  const dirty = useRef(false); // edits not yet written to storage
  const skipNextSave = useRef(false); // set by Clear so storage stays empty until the next edit
  draftRef.current = draft;

  const flush = () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    if (!dirty.current) return;
    dirty.current = false;
    try {
      localStorage.setItem(INVOICE_DRAFT_KEY, JSON.stringify(draftRef.current));
    } catch {
      /* storage full or blocked: the invoice still works */
    }
  };

  // Read the saved draft once, in this browser only.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(INVOICE_DRAFT_KEY);
      setDraft(parseInvoiceDraft(raw, localToday()));
    } catch {
      /* storage blocked: start with an empty draft */
    }
    skipNextSave.current = true; // the restored draft is already what storage holds
    setReady(true);
  }, []);

  // Save 500 ms after the person stops typing.
  useEffect(() => {
    if (!ready) return;
    if (skipNextSave.current) {
      skipNextSave.current = false;
      return;
    }
    dirty.current = true;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flush, 500);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, ready]);

  // Do not lose the last edits when the page is left or closed.
  useEffect(() => {
    const onHide = () => flush();
    window.addEventListener('pagehide', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totals = useMemo(() => calculateInvoice(draft), [draft]);

  const patch = (p: Partial<InvoiceDraft>) => setDraft((d) => ({ ...d, ...p }));
  const setLine = (i: number, p: Partial<InvoiceLine>) =>
    setDraft((d) => ({ ...d, lines: d.lines.map((l, n) => (n === i ? { ...l, ...p } : l)) }));
  const addLine = () =>
    setDraft((d) =>
      d.lines.length >= MAX_LINES
        ? d
        : { ...d, lines: [...d.lines, { description: '', hsn: '', quantity: '', rate: '', discountPercent: '', gstRate: 18 }] }
    );
  const removeLine = (i: number) =>
    setDraft((d) => (d.lines.length <= 1 ? d : { ...d, lines: d.lines.filter((_, n) => n !== i) }));

  const clearAll = () => {
    if (!window.confirm('Clear this invoice and start again?')) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    dirty.current = false;
    skipNextSave.current = true;
    setDraft(emptyInvoiceDraft(localToday()));
    try {
      localStorage.removeItem(INVOICE_DRAFT_KEY);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
      <style>{'@media print{@page{size:A4;margin:12mm}}'}</style>
      <div className="space-y-4">
        <PartyFields title="Your business" party={draft.seller} onChange={(seller) => patch({ seller })} withPhone />
        <PartyFields title="Customer" party={draft.buyer} onChange={(buyer) => patch({ buyer })} />

        <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
          <h3 className="text-sm font-semibold text-slate-900">Invoice</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="Invoice number">
              <input className={fieldClass} value={draft.number} onChange={(e) => patch({ number: e.target.value })} />
            </Field>
            <Field label="Date">
              <input type="date" className={fieldClass} value={draft.date} onChange={(e) => patch({ date: e.target.value })} />
            </Field>
            <Field label="Due date (optional)">
              <input type="date" className={fieldClass} value={draft.dueDate} onChange={(e) => patch({ dueDate: e.target.value })} />
            </Field>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
          <h3 className="text-sm font-semibold text-slate-900">Items</h3>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              role="switch"
              className="h-4 w-4 rounded border-slate-300 text-primary-600"
              checked={draft.pricesIncludeGst}
              onChange={(e) => patch({ pricesIncludeGst: e.target.checked })}
            />
            Prices include GST
          </label>
          {draft.lines.map((line, i) => (
            <div key={i} className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-600">Item {i + 1}</span>
                <button
                  type="button"
                  onClick={() => removeLine(i)}
                  disabled={draft.lines.length <= 1}
                  className="text-xs text-slate-600 hover:text-red-600 disabled:opacity-40 disabled:hover:text-slate-600"
                >
                  Remove
                </button>
              </div>
              <Field label="Description">
                <input className={fieldClass} value={line.description} onChange={(e) => setLine(i, { description: e.target.value })} />
              </Field>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                <Field label="HSN/SAC (optional)">
                  <input className={fieldClass} value={line.hsn} onChange={(e) => setLine(i, { hsn: e.target.value })} />
                </Field>
                <Field label="Quantity">
                  <input className={fieldClass} inputMode="decimal" value={line.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} />
                </Field>
                <Field label="Rate (₹)">
                  <input className={fieldClass} inputMode="decimal" value={line.rate} onChange={(e) => setLine(i, { rate: e.target.value })} />
                </Field>
                <Field label="Discount % (optional)">
                  <input className={fieldClass} inputMode="decimal" value={line.discountPercent} onChange={(e) => setLine(i, { discountPercent: e.target.value })} />
                </Field>
                <Field label="GST rate">
                  <select className={fieldClass} value={line.gstRate} onChange={(e) => setLine(i, { gstRate: Number(e.target.value) })}>
                    {GST_RATE_SLABS.map((r) => (
                      <option key={r} value={r}>{r}%</option>
                    ))}
                  </select>
                </Field>
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={addLine}
            disabled={draft.lines.length >= MAX_LINES}
            className="rounded-lg border border-primary-300 px-3 py-1.5 text-sm font-medium text-primary-700 hover:bg-primary-50 disabled:opacity-40"
          >
            Add item
          </button>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <Field label="Notes (optional)">
            <textarea className={fieldClass} rows={3} value={draft.notes} onChange={(e) => patch({ notes: e.target.value })} />
          </Field>
        </section>
      </div>

      <div className="space-y-4">
        <InvoicePreview draft={draft} totals={totals} />
        <div className="no-print space-y-2">
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => window.print()}
              className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700"
            >
              Download PDF
            </button>
            <button
              type="button"
              onClick={clearAll}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Clear
            </button>
          </div>
          <p className="text-xs text-slate-600">Choose &apos;Save as PDF&apos; in the print window.</p>
          <p className="text-xs text-slate-500">Your invoice stays in this browser. Nothing is sent anywhere.</p>
        </div>
      </div>
    </div>
  );
}
