'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { clsx } from 'clsx';
import {
  ArrowLeft,
  Download,
  Eye,
  Keyboard,
  Loader2,
  Printer,
  Undo2,
} from 'lucide-react';
import type { Customer } from '@/types/database';
import { BillToPanel, ShipToPanel } from '@/components/invoices/composer/ComposerParties';
import { ItemsTable } from '@/components/invoices/composer/ComposerItemsTable';
import { ItemPickerModal } from '@/components/invoices/composer/ComposerItemPicker';
import { TotalsPanel } from '@/components/invoices/composer/ComposerTotals';
import { ShortcutsDialog } from '@/components/invoices/composer/ComposerExtras';
import {
  rowKey,
  type ComposerCharge,
  type ComposerRow,
  type ComposerTotals,
  type PickerItem,
} from '@/components/invoices/composer/types';
import { inr, isTypingTarget, Kbd, SectionLabel } from '@/components/invoices/composer/ui';
import { OrderDetailsPanel } from './OrderDetailsPanel';

export type DesktopSalesOrderComposerProps = {
  title: string;
  statusLabel: string | null;
  onBack: () => void;
  onUseClassicForm: () => void;
  readOnly: boolean;
  keyboardBlocked?: boolean;
  banners?: React.ReactNode;

  businessId: string;
  userId?: string;
  branchId?: string;

  customers: Customer[];
  customer: Customer | null;
  onSelectCustomer: (c: Customer) => void;
  onClearCustomer: () => void;
  onCreateCustomer: (query?: string) => void;
  billingAddress: string;
  setBillingAddress: (v: string) => void;
  shippingAddress: string;
  setShippingAddress: (v: string) => void;

  orderNumber: string;
  setOrderNumber: (v: string) => void;
  orderDate: string;
  setOrderDate: (v: string) => void;
  expectedDeliveryDate: string;
  setExpectedDeliveryDate: (v: string) => void;
  placeOfSupply: string;
  setPlaceOfSupply: (v: string) => void;
  states: readonly string[];
  sellerState: string;
  isIntraState: boolean;
  seriesLoading: boolean;

  rows: ComposerRow[];
  patchRow: (index: number, patch: Partial<ComposerRow>, skipDiscountRecalc?: boolean) => void;
  removeRow: (index: number) => void;
  onApplyPicked: (selections: Array<{ item: PickerItem; quantity: number }>) => void;
  onBarcode: (code: string) => void;
  onCreateItem: () => void;
  pricesIncludeGst: boolean;
  setPricesIncludeGst: (v: boolean) => void;

  notes: string;
  setNotes: (v: string) => void;
  terms: string;
  setTerms: (v: string) => void;

  totals: ComposerTotals;
  amountInWords: string;
  extraCharges: ComposerCharge[];
  setExtraCharges: (c: ComposerCharge[]) => void;
  enableRoundOff: boolean;
  setEnableRoundOff: (v: boolean) => void;

  saving: boolean;
  previewLoading: boolean;
  savedOrderId: string | null;
  onPreview: () => void;
  onSaveDraft: () => void;
  onConfirm: () => void;
  onPrint: () => void;
  onDownload: () => void;
};

export function DesktopSalesOrderComposer(p: DesktopSalesOrderComposerProps) {
  const [searchingCustomer, setSearchingCustomer] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState('');
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [barcodeFocused, setBarcodeFocused] = useState(false);
  const [showNotes, setShowNotes] = useState(!!p.notes.trim() || !!p.terms.trim());

  const customerInputRef = useRef<HTMLInputElement>(null);
  const addBarRef = useRef<HTMLButtonElement>(null);
  const barcodeRef = useRef<HTMLInputElement>(null);
  const receivedRef = useRef<HTMLInputElement>(null);

  const filledRows = p.rows.filter((r) => r.itemId || r.name);
  const totalQty = filledRows.reduce((s, r) => s + (Number(r.quantity) || 0), 0);

  useEffect(() => {
    if (p.notes.trim() || p.terms.trim()) setShowNotes(true);
  }, [p.notes, p.terms]);

  const inBill = useMemo(() => {
    const map: Record<string, number> = {};
    for (const r of filledRows) {
      if (!r.itemId) continue;
      const k = rowKey(String(r.itemId), r.variantId ? String(r.variantId) : null);
      map[k] = (map[k] ?? 0) + (Number(r.quantity) || 0);
    }
    return map;
  }, [filledRows]);

  const focusCustomer = useCallback(() => {
    if (p.readOnly) return;
    setSearchingCustomer(true);
    requestAnimationFrame(() => customerInputRef.current?.focus());
  }, [p.readOnly]);

  const openPicker = useCallback(
    (query = '') => {
      if (p.readOnly) return;
      setPickerQuery(query);
      setPickerOpen(true);
    },
    [p.readOnly]
  );

  const selectCustomer = (c: Customer) => {
    p.onSelectCustomer(c);
    requestAnimationFrame(() => addBarRef.current?.focus());
  };

  const applyPicked = (selections: Array<{ item: PickerItem; quantity: number }>) => {
    p.onApplyPicked(selections);
    setPickerOpen(false);
    requestAnimationFrame(() => addBarRef.current?.focus());
  };

  const keyHandler = useRef<(e: KeyboardEvent) => void>(() => {});
  keyHandler.current = (e: KeyboardEvent) => {
    if (pickerOpen || shortcutsOpen || p.keyboardBlocked) return;
    const key = e.key;
    const lower = key.toLowerCase();
    const mod = e.ctrlKey || e.metaKey;
    if (mod && lower === 's') {
      e.preventDefault();
      if (p.readOnly || p.saving) return;
      if (e.shiftKey) p.onSaveDraft();
      else p.onConfirm();
      return;
    }
    if (mod && lower === 'p') {
      e.preventDefault();
      if (p.savedOrderId) p.onPrint();
      else if (!p.previewLoading) p.onPreview();
      return;
    }
    if (p.readOnly) {
      if (key === '?' && !isTypingTarget(e.target)) {
        e.preventDefault();
        setShortcutsOpen(true);
      }
      return;
    }
    if (key === 'F2') {
      e.preventDefault();
      focusCustomer();
    } else if (key === 'F3') {
      e.preventDefault();
      openPicker('');
    } else if (key === 'F4') {
      e.preventDefault();
      barcodeRef.current?.focus();
    } else if (key === '?' && !isTypingTarget(e.target)) {
      e.preventDefault();
      setShortcutsOpen(true);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keyHandler.current(e);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const didAutofocus = useRef(false);
  useEffect(() => {
    if (didAutofocus.current || p.readOnly) return;
    didAutofocus.current = true;
    if (!p.customer && filledRows.length === 0) {
      requestAnimationFrame(() => customerInputRef.current?.focus());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const taxLabel = p.isIntraState ? 'CGST + SGST' : 'IGST';

  return (
    <div className="space-y-3 pb-2" data-testid="sales-order-composer">
      <header className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={p.onBack}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-sm font-medium text-text-secondary transition hover:bg-slate-50 dark:hover:bg-slate-800"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <div className="min-w-0">
          <h1 className="truncate text-lg font-bold text-text-primary">{p.title}</h1>
          <p className="text-[11px] text-text-secondary">
            {[p.orderNumber || null, p.statusLabel].filter(Boolean).join(' · ') || ' '}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={p.onUseClassicForm}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold text-text-secondary transition hover:bg-slate-100 hover:text-text-primary dark:hover:bg-slate-800"
            title="Switch back to the previous sales order form on this device"
          >
            <Undo2 className="h-4 w-4" /> Classic form
          </button>
          <button
            type="button"
            onClick={() => setShortcutsOpen(true)}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 text-xs font-semibold text-text-secondary transition hover:bg-slate-50 dark:hover:bg-slate-800"
            aria-label="Keyboard shortcuts"
          >
            <Keyboard className="h-4 w-4" />
            <Kbd>?</Kbd>
          </button>
        </div>
      </header>

      {p.banners}

      <div className="rounded-2xl border border-border bg-surface shadow-sm">
        <div className="grid border-b border-border md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.15fr)]">
          <div className="border-b border-border md:border-r xl:border-b-0">
            <BillToPanel
              customers={p.customers}
              customer={p.customer}
              searching={searchingCustomer}
              setSearching={setSearchingCustomer}
              onSelect={selectCustomer}
              onClear={() => {
                setSearchingCustomer(false);
                p.onClearCustomer();
              }}
              onCreateCustomer={p.onCreateCustomer}
              inputRef={customerInputRef}
              billingAddress={p.billingAddress}
              setBillingAddress={p.setBillingAddress}
              readOnly={p.readOnly}
              credit={null}
            />
          </div>
          <div className="border-b border-border xl:border-b-0 xl:border-r">
            <ShipToPanel
              customer={p.customer}
              billingAddress={p.billingAddress}
              shippingAddress={p.shippingAddress}
              setShippingAddress={p.setShippingAddress}
              readOnly={p.readOnly}
            />
          </div>
          <div className="md:col-span-2 xl:col-span-1">
            <OrderDetailsPanel
              orderNumber={p.orderNumber}
              setOrderNumber={p.setOrderNumber}
              orderDate={p.orderDate}
              setOrderDate={p.setOrderDate}
              expectedDeliveryDate={p.expectedDeliveryDate}
              setExpectedDeliveryDate={p.setExpectedDeliveryDate}
              placeOfSupply={p.placeOfSupply}
              setPlaceOfSupply={p.setPlaceOfSupply}
              states={p.states}
              sellerState={p.sellerState}
              isIntraState={p.isIntraState}
              seriesLoading={p.seriesLoading}
              readOnly={p.readOnly}
            />
          </div>
        </div>

        <ItemsTable
          rows={p.rows}
          patchRow={p.patchRow}
          removeRow={p.removeRow}
          onOpenPicker={openPicker}
          onBarcode={p.onBarcode}
          onBarcodeFocusChange={setBarcodeFocused}
          addBarRef={addBarRef}
          barcodeRef={barcodeRef}
          documentType="tax_invoice"
          isExport={false}
          exportType="wp"
          isIntraState={p.isIntraState}
          pricesIncludeGst={p.pricesIncludeGst}
          setPricesIncludeGst={p.setPricesIncludeGst}
          readOnly={p.readOnly}
        />

        <div className="grid lg:grid-cols-[minmax(0,1fr)_420px]">
          <div className="border-b border-border p-4 lg:border-b-0 lg:border-r">
            <SectionLabel>Notes &amp; terms</SectionLabel>
            {showNotes || p.readOnly ? (
              <div className="mt-2 space-y-3">
                <textarea
                  value={p.notes}
                  onChange={(e) => p.setNotes(e.target.value)}
                  disabled={p.readOnly}
                  rows={3}
                  placeholder="Notes printed on the sales order"
                  className="w-full resize-none rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none transition placeholder:text-text-muted focus:border-primary-500 focus:ring-4 focus:ring-primary-100 disabled:bg-slate-50"
                />
                <textarea
                  value={p.terms}
                  onChange={(e) => p.setTerms(e.target.value)}
                  disabled={p.readOnly}
                  rows={2}
                  placeholder="Terms and conditions"
                  className="w-full resize-none rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none transition placeholder:text-text-muted focus:border-primary-500 focus:ring-4 focus:ring-primary-100 disabled:bg-slate-50"
                />
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowNotes(true)}
                className="mt-2 flex w-full items-center gap-2 rounded-lg border border-dashed border-border px-3 py-3 text-left text-sm text-text-secondary transition hover:border-primary-300 hover:bg-primary-50/40 hover:text-primary-700"
              >
                Add notes or terms
              </button>
            )}
          </div>
          <TotalsPanel
            totals={p.totals}
            documentType="tax_invoice"
            isIntraState={p.isIntraState}
            isExport={false}
            exportType="wp"
            foreign={null}
            amountInWords={p.amountInWords}
            charges={p.extraCharges}
            setCharges={p.setExtraCharges}
            enableRoundOff={p.enableRoundOff}
            setEnableRoundOff={p.setEnableRoundOff}
            payments={[]}
            setPayments={() => undefined}
            onOpenPaymentDetails={() => undefined}
            totalPaid={0}
            balance={p.totals.grandTotal}
            receivedRef={receivedRef}
            readOnly={p.readOnly}
            isEstimate
          />
        </div>
      </div>

      <footer className="sticky bottom-2 z-20 rounded-2xl border border-border bg-surface/95 px-4 py-2.5 shadow-lg shadow-slate-900/5 backdrop-blur">
        <div className="flex items-center gap-4">
          <div className="hidden min-w-0 items-center gap-5 text-xs text-text-secondary md:flex">
            <FooterStat label="Items" value={`${filledRows.length} · ${Math.round(totalQty * 1000) / 1000} qty`} />
            <FooterStat label="Taxable" value={inr(p.totals.taxableAmount)} />
            <FooterStat label={taxLabel} value={inr(p.totals.totalTax)} />
            {p.customer && <FooterStat label="Customer" value={p.customer.name} />}
          </div>

          <div className="ml-auto flex items-center gap-2.5">
            <div className="mr-1 text-right">
              <p className="text-[11px] font-medium text-text-secondary">Total</p>
              <p className="text-xl font-extrabold leading-tight tabular-nums text-text-primary">
                {inr(p.totals.grandTotal)}
              </p>
            </div>

            {p.savedOrderId && (
              <>
                <FooterButton icon={Printer} label="Print" onClick={p.onPrint} />
                <FooterButton icon={Download} label="PDF" onClick={p.onDownload} />
              </>
            )}

            {!p.readOnly && (
              <>
                <FooterButton
                  icon={p.previewLoading ? Loader2 : Eye}
                  label="Preview"
                  onClick={p.onPreview}
                  disabled={p.previewLoading}
                  spin={p.previewLoading}
                />
                <button
                  type="button"
                  onClick={p.onSaveDraft}
                  disabled={p.saving}
                  className="inline-flex h-11 items-center gap-2 rounded-xl border border-primary-200 bg-primary-50 px-4 text-sm font-bold text-primary-700 transition hover:bg-primary-100 disabled:cursor-wait disabled:opacity-70 dark:border-primary-800 dark:bg-primary-900/30 dark:text-primary-200"
                >
                  Save draft
                  <Kbd className="hidden border-primary-200 text-primary-700 xl:inline-flex">Ctrl⇧S</Kbd>
                </button>
                <button
                  type="button"
                  onClick={p.onConfirm}
                  disabled={p.saving}
                  className="inline-flex h-11 items-center gap-2 rounded-xl bg-primary-600 px-5 text-sm font-bold text-white shadow-lg shadow-primary-600/30 transition hover:bg-primary-700 disabled:cursor-wait disabled:opacity-70"
                  data-testid="sales-order-confirm"
                >
                  {p.saving && <Loader2 className="h-4 w-4 animate-spin" />}
                  Confirm order
                  <Kbd className="hidden border-white/30 bg-white/15 text-white xl:inline-flex">Ctrl S</Kbd>
                </button>
              </>
            )}
          </div>
        </div>
        {!p.readOnly && (
          <p className="mt-1 text-right text-[10px] text-text-muted">
            Confirming marks the order ready to invoice. Drafts can be edited later.
          </p>
        )}
      </footer>

      <ItemPickerModal
        open={pickerOpen}
        initialQuery={pickerQuery}
        businessId={p.businessId}
        userId={p.userId}
        branchId={p.branchId}
        inBill={inBill}
        onClose={() => {
          setPickerOpen(false);
          requestAnimationFrame(() => addBarRef.current?.focus());
        }}
        onApply={applyPicked}
        onCreateItem={() => {
          setPickerOpen(false);
          p.onCreateItem();
        }}
      />

      <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </div>
  );
}

function FooterStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 max-w-[12rem]">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">{label}</p>
      <p className="truncate text-sm font-semibold tabular-nums text-text-primary">{value}</p>
    </div>
  );
}

function FooterButton({
  icon: Icon,
  label,
  onClick,
  disabled,
  spin,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  spin?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        'inline-flex h-11 items-center gap-1.5 rounded-xl border border-border bg-surface px-3 text-sm font-semibold text-text-secondary transition hover:bg-slate-50 disabled:opacity-60 dark:hover:bg-slate-800'
      )}
    >
      <Icon className={clsx('h-4 w-4', spin && 'animate-spin')} />
      {label}
    </button>
  );
}
