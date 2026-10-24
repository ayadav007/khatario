'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { clsx } from 'clsx';
import { AlertCircle, ArrowLeft, CheckCircle2, Eye, Keyboard, PencilLine, Settings, Wand2 } from 'lucide-react';
import { Kbd } from './_components/Kbd';
import { BillToPanel, ShipToPanel } from './_components/CustomerPanels';
import { InvoiceDetailsPanel } from './_components/InvoiceDetailsPanel';
import { ItemsTable } from './_components/ItemsTable';
import { ItemPickerModal } from './_components/ItemPickerModal';
import { AddOnsPanel } from './_components/AddOnsPanel';
import { TotalsPanel, type Charge, type Payment, type Totals } from './_components/TotalsPanel';
import { ShortcutsDialog } from './_components/ShortcutsDialog';
import { InvoicePreview } from './_components/InvoicePreview';
import { ExportPanel } from './_components/ExportPanel';
import { useAuth } from '@/contexts/AuthContext';
import {
  addDays,
  CATALOG,
  calcLine,
  CUSTOMERS,
  DEFAULT_EXPORT,
  DEFAULT_RECURRING,
  fmtDate,
  fx,
  inr,
  isTypingTarget,
  OVERSEAS_STATE_CODE,
  RECURRING_FREQUENCIES,
  sellerFromBusiness,
  toLine,
  type CatalogItem,
  type Customer,
  type ExportConfig,
  type LineItem,
  type RecurringConfig,
} from './_lib/mock-data';

type Toast = { kind: 'ok' | 'err'; text: string } | null;

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const freshPayments = (): Payment[] => [{ id: 'p1', amount: '', mode: 'Cash' }];

export default function InvoiceCreateMockPage() {
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [searchingCustomer, setSearchingCustomer] = useState(false);
  const [shipAddressId, setShipAddressId] = useState<string | null>(null);
  const [invoiceNo, setInvoiceNo] = useState('0482');
  const [invoiceDate, setInvoiceDate] = useState(todayIso);
  const [termsDays, setTermsDays] = useState(0);
  const [recurring, setRecurring] = useState<RecurringConfig>(DEFAULT_RECURRING);
  const [exportCfg, setExportCfg] = useState<ExportConfig>(DEFAULT_EXPORT);
  const [lines, setLines] = useState<LineItem[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState('');
  const [charges, setCharges] = useState<Charge[]>([]);
  const [discount, setDiscount] = useState<{ value: number; type: 'pct' | 'amt' } | null>(null);
  const [autoRound, setAutoRound] = useState(true);
  const [payments, setPayments] = useState<Payment[]>(freshPayments);
  const [fullyPaid, setFullyPaid] = useState(false);
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [toast, setToast] = useState<Toast>(null);

  const customerInputRef = useRef<HTMLInputElement>(null);
  const addBarRef = useRef<HTMLButtonElement>(null);
  const barcodeRef = useRef<HTMLInputElement>(null);
  const receivedRef = useRef<HTMLInputElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>();

  const { business } = useAuth();
  const seller = useMemo(() => sellerFromBusiness(business), [business]);

  const shipAddress = customer
    ? customer.shipping.find((a) => a.id === shipAddressId) ?? customer.billing
    : null;
  const isExport = exportCfg.enabled;
  const zeroRated = isExport && exportCfg.type === 'lut';
  const posStateCode = isExport ? OVERSEAS_STATE_CODE : shipAddress?.stateCode ?? seller.stateCode;
  const posState = isExport ? 'Other country' : shipAddress?.state ?? seller.state;
  const isInterState = posStateCode !== seller.stateCode;
  const exportInfo = isExport
    ? { type: exportCfg.type, currency: exportCfg.currency, rate: exportCfg.rate }
    : null;
  const foreignCurrency = isExport && exportCfg.currency !== 'INR' && exportCfg.rate > 0;
  const prefix = isExport ? 'EXP/26-27/' : 'INV/26-27/';

  const totals: Totals = useMemo(() => {
    let gross = 0;
    let itemDiscount = 0;
    let taxable = 0;
    let tax = 0;
    let qty = 0;
    for (const l of lines) {
      const c = calcLine(l, zeroRated);
      gross += c.gross;
      itemDiscount += c.discount;
      taxable += c.taxable;
      tax += c.tax;
      qty += l.qty;
    }
    const chargesTotal = charges.reduce((s, c) => s + (c.amount || 0), 0);
    const base = taxable + tax + chargesTotal;
    const extraDiscount = discount
      ? discount.type === 'pct'
        ? (base * Math.min(100, discount.value)) / 100
        : Math.min(discount.value, base)
      : 0;
    const pre = base - extraDiscount;
    const total = autoRound ? Math.round(pre) : pre;
    return {
      gross,
      itemDiscount,
      taxable,
      tax,
      qty,
      charges: chargesTotal,
      extraDiscount,
      roundOff: total - pre,
      total: Math.max(0, total),
    };
  }, [lines, charges, discount, autoRound, zeroRated]);

  const received = fullyPaid
    ? totals.total
    : payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const balance = totals.total - received;

  const inBill = useMemo(() => {
    const map: Record<string, number> = {};
    for (const l of lines) map[l.itemId] = (map[l.itemId] ?? 0) + l.qty;
    return map;
  }, [lines]);

  const showToast = useCallback((kind: 'ok' | 'err', text: string) => {
    setToast({ kind, text });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }, []);

  const focusCustomer = useCallback(() => {
    setMode('edit');
    setSearchingCustomer(true);
    requestAnimationFrame(() => customerInputRef.current?.focus());
  }, []);

  const openPicker = useCallback((query = '') => {
    setMode('edit');
    setPickerQuery(query);
    setPickerOpen(true);
  }, []);

  const toggleExport = useCallback(
    (enabled: boolean) => {
      setExportCfg((prev) => ({ ...prev, enabled }));
      setMode('edit');
      showToast('ok', enabled ? 'Export invoice: IGST 0% under LUT' : 'Domestic invoice');
    },
    [showToast]
  );

  const selectCustomer = (c: Customer) => {
    setCustomer(c);
    setShipAddressId(c.billing.id);
    setTermsDays(c.gstin || c.country ? 15 : 0);
    const overseas = c.billing.stateCode === OVERSEAS_STATE_CODE;
    if (overseas && !isExport) {
      setExportCfg((prev) => ({ ...prev, enabled: true }));
      showToast('ok', `${c.country ?? 'Overseas'} customer: switched to Export invoice`);
    } else if (!overseas && isExport) {
      setExportCfg((prev) => ({ ...prev, enabled: false }));
      showToast('ok', 'Indian customer: switched back to Domestic invoice');
    }
    requestAnimationFrame(() => addBarRef.current?.focus());
  };

  const addToBill = (selection: { item: CatalogItem; qty: number }[]) => {
    setLines((prev) => {
      const next = [...prev];
      for (const { item, qty } of selection) {
        const idx = next.findIndex((l) => l.itemId === item.id);
        if (idx >= 0) next[idx] = { ...next[idx]!, qty: next[idx]!.qty + qty };
        else next.push(toLine(item, qty));
      }
      return next;
    });
    setPickerOpen(false);
    showToast('ok', `Added ${selection.length} ${selection.length === 1 ? 'item' : 'items'} to the bill`);
    requestAnimationFrame(() => addBarRef.current?.focus());
  };

  const onBarcode = (code: string) => {
    const item = CATALOG.find((c) => c.code.toLowerCase() === code.toLowerCase());
    if (!item) {
      showToast('err', `No item with code “${code}”`);
      return;
    }
    addToBill([{ item, qty: 1 }]);
    requestAnimationFrame(() => barcodeRef.current?.focus());
  };

  const reset = () => {
    setCustomer(null);
    setSearchingCustomer(false);
    setShipAddressId(null);
    setInvoiceNo((n) => String(Number(n) + 1).padStart(4, '0'));
    setTermsDays(0);
    setRecurring(DEFAULT_RECURRING);
    setExportCfg(DEFAULT_EXPORT);
    setLines([]);
    setCharges([]);
    setDiscount(null);
    setPayments(freshPayments());
    setFullyPaid(false);
    setMode('edit');
    requestAnimationFrame(() => customerInputRef.current?.focus());
  };

  const save = (andNew: boolean) => {
    if (!lines.length) {
      showToast('err', 'Add at least one item before saving');
      setMode('edit');
      requestAnimationFrame(() => addBarRef.current?.focus());
      return;
    }
    const unpriced = lines.find((l) => l.rate <= 0 || l.qty <= 0);
    if (unpriced) {
      showToast('err', `Set quantity and price for “${unpriced.name}”`);
      return;
    }
    if (!customer && balance > 0.004) {
      showToast('err', 'A credit sale needs a customer. Press F2 to pick one, or F9 to mark it fully paid.');
      return;
    }
    showToast('ok', `${prefix}${invoiceNo} saved (mock, nothing was stored)`);
    if (andNew) reset();
  };

  const fillSample = () => {
    const c = CUSTOMERS[0]!;
    setCustomer(c);
    setSearchingCustomer(false);
    setShipAddressId(c.shipping[1]?.id ?? c.billing.id);
    setTermsDays(15);
    const pick = (id: string) => CATALOG.find((x) => x.id === id)!;
    setLines([
      { ...toLine(pick('i1'), 24), discount: 5 },
      toLine(pick('i3'), 6),
      toLine(pick('i6'), 4),
      toLine(pick('i11'), 3),
      toLine(pick('i12'), 2),
    ]);
    setPayments([{ id: 'p1', amount: '20000', mode: 'UPI' }]);
    setFullyPaid(false);
    setExportCfg(DEFAULT_EXPORT);
  };

  const keyHandler = useRef<(e: KeyboardEvent) => void>(() => {});
  keyHandler.current = (e: KeyboardEvent) => {
    if (pickerOpen || shortcutsOpen) return;
    const key = e.key;
    const lower = key.toLowerCase();
    if (key === 'F2') {
      e.preventDefault();
      focusCustomer();
    } else if (key === 'F3') {
      e.preventDefault();
      openPicker('');
    } else if (key === 'F4') {
      e.preventDefault();
      setMode('edit');
      requestAnimationFrame(() => barcodeRef.current?.focus());
    } else if (key === 'F8') {
      e.preventDefault();
      setMode('edit');
      requestAnimationFrame(() => {
        receivedRef.current?.focus();
        receivedRef.current?.select();
      });
    } else if (key === 'F9') {
      e.preventDefault();
      setFullyPaid((v) => !v);
    } else if (e.altKey && lower === 'e') {
      e.preventDefault();
      toggleExport(!isExport);
    } else if ((e.ctrlKey || e.metaKey) && lower === 's') {
      e.preventDefault();
      save(e.shiftKey);
    } else if ((e.ctrlKey || e.metaKey) && lower === 'p') {
      e.preventDefault();
      setMode((m) => (m === 'edit' ? 'preview' : 'edit'));
    } else if (key === '?' && !isTypingTarget(e.target)) {
      e.preventDefault();
      setShortcutsOpen(true);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keyHandler.current(e);
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => customerInputRef.current?.focus());
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      clearTimeout(toastTimer.current);
    };
  }, []);

  const dueDate = fmtDate(addDays(invoiceDate, termsDays));
  const totalLabel = foreignCurrency ? fx(totals.total / exportCfg.rate, exportCfg.currency) : inr(totals.total);

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-slate-100">
      {/* Top bar */}
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-3 sm:px-4">
        <Link
          href="/invoices"
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
        >
          <ArrowLeft className="h-4 w-4" /> Exit
        </Link>
        <div className="min-w-0">
          <h1 className="truncate text-base font-bold text-slate-900">
            {isExport ? 'Create Export Invoice' : 'Create Sales Invoice'}
          </h1>
          <p className="hidden text-[11px] text-slate-500 sm:block">
            {prefix}
            {invoiceNo} · Draft
            {recurring.enabled &&
              ` · Recurring ${RECURRING_FREQUENCIES.find((f) => f.id === recurring.frequency)?.adverb ?? ''}${
                recurring.quantityMode === 'review' ? ' (review quantities)' : ' (auto-send)'
              }`}
          </p>
        </div>

        <div className="mx-auto flex rounded-lg bg-slate-100 p-1">
          {(
            [
              { id: 'edit', label: 'Edit', icon: PencilLine },
              { id: 'preview', label: 'Preview', icon: Eye },
            ] as const
          ).map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setMode(m.id)}
              className={clsx(
                'inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm font-semibold transition',
                mode === m.id ? 'bg-white text-primary-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              )}
            >
              <m.icon className="h-4 w-4" />
              <span className="hidden sm:inline">{m.label}</span>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={fillSample}
            className="hidden h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 md:inline-flex"
            title="Demo only"
          >
            <Wand2 className="h-4 w-4" /> Sample data
          </button>
          <button
            type="button"
            onClick={() => setShortcutsOpen(true)}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
          >
            <Keyboard className="h-4 w-4" />
            <Kbd className="hidden sm:inline-flex">?</Kbd>
          </button>
          <button
            type="button"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600 transition hover:bg-slate-50"
            aria-label="Invoice settings"
          >
            <Settings className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* Workspace */}
      <main className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto max-w-[1440px] p-3 sm:p-4">
          {mode === 'edit' ? (
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="grid border-b border-slate-200 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.15fr)]">
                <div className="border-b border-slate-200 md:border-r xl:border-b-0">
                  <BillToPanel
                    customers={CUSTOMERS}
                    customer={customer}
                    searching={searchingCustomer}
                    setSearching={setSearchingCustomer}
                    onSelect={selectCustomer}
                    inputRef={customerInputRef}
                    onNewCustomer={() => showToast('ok', 'New customer form would open here')}
                  />
                </div>
                <div className="border-b border-slate-200 xl:border-b-0 xl:border-r">
                  <ShipToPanel customer={customer} shipAddressId={shipAddressId} onChange={setShipAddressId} />
                </div>
                <div className="md:col-span-2 xl:col-span-1">
                  <InvoiceDetailsPanel
                    invoiceNo={invoiceNo}
                    setInvoiceNo={setInvoiceNo}
                    invoiceDate={invoiceDate}
                    setInvoiceDate={setInvoiceDate}
                    termsDays={termsDays}
                    setTermsDays={setTermsDays}
                    placeOfSupply={`${posStateCode} - ${posState}`}
                    sellerState={`${seller.stateCode} - ${seller.state}`}
                    sellerFromProfile={seller.fromProfile}
                    isInterState={isInterState}
                    exportEnabled={isExport}
                    exportType={exportCfg.type}
                    onToggleExport={toggleExport}
                    recurring={recurring}
                    setRecurring={setRecurring}
                  />
                </div>
              </div>

              {isExport && <ExportPanel value={exportCfg} onChange={setExportCfg} totalInr={totals.total} />}

              <ItemsTable
                lines={lines}
                onUpdate={(id, patch) => setLines((prev) => prev.map((l) => (l.lineId === id ? { ...l, ...patch } : l)))}
                onRemove={(id) => setLines((prev) => prev.filter((l) => l.lineId !== id))}
                onOpenPicker={openPicker}
                onBarcode={onBarcode}
                addBarRef={addBarRef}
                barcodeRef={barcodeRef}
                isInterState={isInterState}
                zeroRated={zeroRated}
              />

              <div className="grid lg:grid-cols-[minmax(0,1fr)_420px]">
                <div className="border-b border-slate-200 lg:border-b-0 lg:border-r">
                  <AddOnsPanel seller={seller} />
                </div>
                <TotalsPanel
                  totals={totals}
                  isInterState={isInterState}
                  exportInfo={exportInfo}
                  charges={charges}
                  setCharges={setCharges}
                  discount={discount}
                  setDiscount={setDiscount}
                  autoRound={autoRound}
                  setAutoRound={setAutoRound}
                  payments={payments}
                  setPayments={setPayments}
                  fullyPaid={fullyPaid}
                  setFullyPaid={setFullyPaid}
                  received={received}
                  balance={balance}
                  receivedRef={receivedRef}
                />
              </div>
            </div>
          ) : (
            <InvoicePreview
              seller={seller}
              invoiceNo={invoiceNo}
              invoiceDate={fmtDate(addDays(invoiceDate, 0))}
              dueDate={dueDate}
              customer={customer}
              shipAddress={shipAddress}
              lines={lines}
              totals={totals}
              isInterState={isInterState}
              exportCfg={exportCfg}
              zeroRated={zeroRated}
              prefix={prefix}
            />
          )}
        </div>
      </main>

      {/* Sticky footer: the eye ends on total → save */}
      <footer className="shrink-0 border-t border-slate-200 bg-white/95 px-3 py-2.5 backdrop-blur sm:px-4">
        <div className="mx-auto flex max-w-[1440px] items-center gap-4">
          <div className="hidden min-w-0 items-center gap-5 text-xs text-slate-500 md:flex">
            <FooterStat label="Items" value={`${lines.length} · ${totals.qty} qty`} />
            <FooterStat label="Taxable" value={inr(totals.taxable)} />
            <FooterStat
              label={isExport ? (zeroRated ? 'IGST 0% · LUT' : 'IGST') : isInterState ? 'IGST' : 'GST'}
              value={inr(totals.tax)}
            />
            {foreignCurrency && <FooterStat label="In rupees" value={inr(totals.total)} />}
            {customer && <FooterStat label="Customer" value={customer.name} />}
          </div>

          <div className="ml-auto flex items-center gap-3">
            <div className="text-right">
              <p className="text-[11px] font-medium text-slate-500">
                {balance > 0.004 && totals.total > 0 ? (
                  <span className="text-amber-600">Balance {inr(balance)}</span>
                ) : totals.total > 0 ? (
                  <span className="text-emerald-600">Paid in full</span>
                ) : (
                  'Total'
                )}
              </p>
              <p className="text-xl font-extrabold leading-tight tabular-nums text-slate-900">{totalLabel}</p>
            </div>
            <button
              type="button"
              onClick={() => save(true)}
              className="hidden h-11 items-center gap-2 rounded-xl border border-primary-200 bg-primary-50 px-4 text-sm font-bold text-primary-700 transition hover:bg-primary-100 sm:inline-flex"
            >
              Save & New
              <Kbd className="hidden border-primary-200 text-primary-700 lg:inline-flex">Ctrl⇧S</Kbd>
            </button>
            <button
              type="button"
              onClick={() => save(false)}
              className="inline-flex h-11 items-center gap-2 rounded-xl bg-primary-600 px-5 text-sm font-bold text-white shadow-lg shadow-primary-600/30 transition hover:bg-primary-700"
            >
              Save
              <Kbd className="hidden border-white/30 bg-white/15 text-white lg:inline-flex">Ctrl S</Kbd>
            </button>
          </div>
        </div>
      </footer>

      <ItemPickerModal
        open={pickerOpen}
        initialQuery={pickerQuery}
        catalog={CATALOG}
        inBill={inBill}
        onClose={() => {
          setPickerOpen(false);
          requestAnimationFrame(() => addBarRef.current?.focus());
        }}
        onAdd={addToBill}
        onCreateItem={() => showToast('ok', 'New item form would open here')}
      />

      <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />

      {toast && (
        <div
          role="status"
          className={clsx(
            'fixed bottom-20 left-1/2 z-[100] flex max-w-[90vw] -translate-x-1/2 items-center gap-2 rounded-full px-4 py-2.5 text-sm font-medium text-white shadow-2xl',
            toast.kind === 'ok' ? 'bg-slate-900' : 'bg-rose-600'
          )}
        >
          {toast.kind === 'ok' ? (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
          ) : (
            <AlertCircle className="h-4 w-4 shrink-0" />
          )}
          {toast.text}
        </div>
      )}
    </div>
  );
}

function FooterStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</p>
      <p className="truncate text-sm font-semibold tabular-nums text-slate-800">{value}</p>
    </div>
  );
}
