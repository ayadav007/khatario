'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { clsx } from 'clsx';
import {
  ArrowLeft,
  Download,
  Eye,
  FilePlus2,
  Keyboard,
  Loader2,
  Printer,
  Send,
  Undo2,
} from 'lucide-react';
import type { Customer } from '@/types/database';
import { useToastContext } from '@/contexts/ToastContext';
import { useLayout } from '@/contexts/LayoutContext';
import { BillToPanel, isOverseasCustomer, ShipToPanel } from './ComposerParties';
import { DetailsPanel, MoreDetailsPanel } from './ComposerDetails';
import { ExportPanel } from './ComposerExport';
import { ItemsTable } from './ComposerItemsTable';
import { ItemPickerModal } from './ComposerItemPicker';
import { newPayment, TotalsPanel } from './ComposerTotals';
import { NotesAndAttachments, ShortcutsDialog } from './ComposerExtras';
import {
  rowKey,
  type ComposerAttachment,
  type ComposerCharge,
  type ComposerDocType,
  type ComposerExportState,
  type ComposerMoreDetails,
  type ComposerPayment,
  type ComposerRow,
  type ComposerTotals,
  type PickerItem,
} from './types';
import { inr, isTypingTarget, Kbd } from './ui';

export type DesktopInvoiceComposerProps = {
  title: string;
  documentType: ComposerDocType;
  statusLabel: string | null;
  onBack: () => void;
  onUseClassicForm: () => void;
  readOnly: boolean;
  isFinal: boolean;
  keyboardBlocked: boolean;
  banners: React.ReactNode;

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
  credit: { available: number | null; limit: number } | null;

  invoicePrefix: string | null;
  invoiceNumber: string | null;
  offlineNumber: string | null;
  seriesLoading: boolean;
  seriesError: string | null;
  invoiceDate: string;
  setInvoiceDate: (v: string) => void;
  isFutureDate: boolean;
  dueDate: string;
  setDueDate: (v: string) => void;
  placeOfSupply: string;
  setPlaceOfSupply: (v: string) => void;
  states: string[];
  sellerState: string;
  sellerStateCode: string;
  posStateCode: string;
  isIntraState: boolean;
  warehouses: Array<{ id: string; name: string; warehouse_code?: string; is_primary?: boolean }>;
  warehousesLoading: boolean;
  selectedWarehouseId: string;
  setSelectedWarehouseId: (v: string) => void;

  isExport: boolean;
  setIsExport: (v: boolean) => void;
  exportState: ComposerExportState;
  patchExport: (patch: Partial<ComposerExportState>) => void;
  moreDetails: ComposerMoreDetails;
  patchMoreDetails: (patch: Partial<ComposerMoreDetails>) => void;
  customFields: React.ReactNode | null;
  customFieldsRequired: boolean;

  rows: ComposerRow[];
  patchRow: (index: number, patch: Partial<ComposerRow>, skipDiscountRecalc?: boolean) => void;
  removeRow: (index: number) => void;
  onApplyPicked: (selections: Array<{ item: PickerItem; quantity: number }>) => void;
  onBarcode: (code: string) => void;
  onCreateItem: () => void;
  onScannerSuspendChange: (suspended: boolean) => void;
  pricesIncludeGst: boolean;
  setPricesIncludeGst: (v: boolean) => void;

  notes: string;
  setNotes: (v: string) => void;
  attachments: ComposerAttachment[];
  onUploadAttachments: (files: File[]) => void;
  onRemoveAttachment: (id: string) => void;
  uploadingAttachments: boolean;

  totals: ComposerTotals;
  amountInWords: string;
  extraCharges: ComposerCharge[];
  setExtraCharges: (c: ComposerCharge[]) => void;
  enableRoundOff: boolean;
  setEnableRoundOff: (v: boolean) => void;
  payments: ComposerPayment[];
  setPayments: (p: ComposerPayment[]) => void;
  onOpenPaymentDetails: () => void;
  totalPaid: number;
  balance: number;

  saving: boolean;
  previewLoading: boolean;
  savedInvoiceId: string | null;
  onPreview: () => void;
  onSaveDraft: () => void;
  onSaveFinal: () => void;
  onShare: () => void;
  onPrint: () => void;
  onDownload: () => void;
  onStartNew: () => void;
};

export function DesktopInvoiceComposer(p: DesktopInvoiceComposerProps) {
  const toast = useToastContext();
  const [searchingCustomer, setSearchingCustomer] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState('');
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [barcodeFocused, setBarcodeFocused] = useState(false);

  const customerInputRef = useRef<HTMLInputElement>(null);
  const addBarRef = useRef<HTMLButtonElement>(null);
  const barcodeRef = useRef<HTMLInputElement>(null);
  const receivedRef = useRef<HTMLInputElement>(null);

  const isEstimate = p.documentType === 'proforma_invoice';
  const nonTaxable = p.documentType === 'bill_of_supply';
  const rate = typeof p.exportState.exchangeRate === 'number' ? p.exportState.exchangeRate : 0;
  const foreign = p.isExport && p.exportState.invoiceCurrency !== 'INR' && rate > 0
    ? { currency: p.exportState.invoiceCurrency, rate }
    : null;
  const filledRows = p.rows.filter((r) => r.itemId || r.name);
  const totalQty = filledRows.reduce((s, r) => s + (Number(r.quantity) || 0), 0);
  const docNo = p.offlineNumber || (p.invoicePrefix && p.invoiceNumber ? `${p.invoicePrefix}-${p.invoiceNumber}` : null);

  const { onScannerSuspendChange } = p;
  useEffect(() => {
    onScannerSuspendChange(pickerOpen || barcodeFocused);
  }, [pickerOpen, barcodeFocused, onScannerSuspendChange]);
  useEffect(() => () => onScannerSuspendChange(false), [onScannerSuspendChange]);

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

  const toggleExport = useCallback(
    (enabled: boolean, quiet = false) => {
      if (p.readOnly || enabled === p.isExport) return;
      p.setIsExport(enabled);
      if (!quiet) {
        toast.info(
          enabled
            ? nonTaxable
              ? 'Export document'
              : `Export invoice: ${p.exportState.exportType === 'wop' ? 'IGST 0% under LUT' : 'IGST charged'}`
            : 'Domestic invoice'
        );
      }
    },
    [p, toast, nonTaxable]
  );

  const selectCustomer = (c: Customer) => {
    p.onSelectCustomer(c);
    if (!p.readOnly) {
      const overseas = isOverseasCustomer(c);
      if (overseas && !p.isExport) {
        toggleExport(true, true);
        toast.info(`${c.country} customer: switched to Export`);
      } else if (!overseas && p.isExport) {
        toggleExport(false, true);
        toast.info('Indian customer: switched back to Domestic');
      }
    }
    requestAnimationFrame(() => addBarRef.current?.focus());
  };

  const applyPicked = (selections: Array<{ item: PickerItem; quantity: number }>) => {
    p.onApplyPicked(selections);
    setPickerOpen(false);
    requestAnimationFrame(() => addBarRef.current?.focus());
  };

  const markFullyPaid = () => {
    if (p.readOnly || isEstimate || p.totals.grandTotal <= 0) return;
    const fully = Math.abs(p.balance) < 0.005 && p.totalPaid > 0;
    p.setPayments(fully ? [] : [newPayment(p.totals.grandTotal, p.payments[0]?.mode || 'cash')]);
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
      else p.onSaveFinal();
      return;
    }
    if (mod && lower === 'p') {
      e.preventDefault();
      if (p.savedInvoiceId && p.isFinal) p.onPrint();
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
    } else if (key === 'F8' && !isEstimate) {
      e.preventDefault();
      receivedRef.current?.focus();
      receivedRef.current?.select();
    } else if (key === 'F9') {
      e.preventDefault();
      markFullyPaid();
    } else if (e.altKey && lower === 'e') {
      e.preventDefault();
      toggleExport(!p.isExport);
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

  const anchorRef = useRef<HTMLDivElement>(null);
  const { sidebarCollapsed } = useLayout();
  const [footerBox, setFooterBox] = useState({ left: 0, width: 0 });

  useLayoutEffect(() => {
    const el = anchorRef.current;
    if (!el) return;
    let frame = 0;
    const update = () => {
      const rect = el.getBoundingClientRect();
      setFooterBox((prev) =>
        prev.left === rect.left && prev.width === rect.width ? prev : { left: rect.left, width: rect.width }
      );
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    if (el.parentElement) observer.observe(el.parentElement);
    window.addEventListener('resize', update);
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    window.addEventListener('scroll', onScroll, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', onScroll, true);
      cancelAnimationFrame(frame);
    };
  }, [sidebarCollapsed]);

  const taxLabel = nonTaxable
    ? 'Tax'
    : p.isExport
      ? p.exportState.exportType === 'wop'
        ? 'IGST 0% · LUT'
        : 'IGST'
      : p.isIntraState
        ? 'CGST + SGST'
        : 'IGST';

  return (
    <div ref={anchorRef} className="space-y-3 pb-24">
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
            {[docNo, p.statusLabel, p.isExport ? 'Export' : null].filter(Boolean).join(' · ') || ' '}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={p.onUseClassicForm}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold text-text-secondary transition hover:bg-slate-100 hover:text-text-primary dark:hover:bg-slate-800"
            title="Switch back to the previous invoice form on this device"
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
              credit={p.credit}
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
            <DetailsPanel
              documentType={p.documentType}
              numberLabel={isEstimate ? 'Estimate no.' : nonTaxable ? 'Bill no.' : 'Invoice no.'}
              invoicePrefix={p.invoicePrefix}
              invoiceNumber={p.invoiceNumber}
              offlineNumber={p.offlineNumber}
              seriesLoading={p.seriesLoading}
              seriesError={p.seriesError}
              invoiceDate={p.invoiceDate}
              setInvoiceDate={p.setInvoiceDate}
              isFutureDate={p.isFutureDate}
              dueDate={p.dueDate}
              setDueDate={p.setDueDate}
              placeOfSupply={p.placeOfSupply}
              setPlaceOfSupply={p.setPlaceOfSupply}
              states={p.states}
              sellerState={p.sellerState}
              sellerStateCode={p.sellerStateCode}
              posStateCode={p.posStateCode}
              isIntraState={p.isIntraState}
              isExport={p.isExport}
              exportType={p.exportState.exportType}
              onToggleExport={(v) => toggleExport(v)}
              warehouses={p.warehouses}
              warehousesLoading={p.warehousesLoading}
              selectedWarehouseId={p.selectedWarehouseId}
              setSelectedWarehouseId={p.setSelectedWarehouseId}
              readOnly={p.readOnly}
            />
          </div>
        </div>

        {p.isExport && (
          <ExportPanel
            value={p.exportState}
            onChange={p.patchExport}
            totalInr={p.totals.grandTotal}
            readOnly={p.readOnly}
            documentType={p.documentType}
          />
        )}

        <MoreDetailsPanel
          value={p.moreDetails}
          onChange={p.patchMoreDetails}
          readOnly={p.readOnly}
          customFields={p.customFields}
          defaultOpen={p.customFieldsRequired}
        />

        <ItemsTable
          rows={p.rows}
          patchRow={p.patchRow}
          removeRow={p.removeRow}
          onOpenPicker={openPicker}
          onBarcode={p.onBarcode}
          onBarcodeFocusChange={setBarcodeFocused}
          addBarRef={addBarRef}
          barcodeRef={barcodeRef}
          documentType={p.documentType}
          isExport={p.isExport}
          exportType={p.exportState.exportType}
          isIntraState={p.isIntraState}
          pricesIncludeGst={p.pricesIncludeGst}
          readOnly={p.readOnly}
        />

        <div className="grid lg:grid-cols-[minmax(0,1fr)_420px]">
          <div className="border-b border-border lg:border-b-0 lg:border-r">
            <NotesAndAttachments
              notes={p.notes}
              setNotes={p.setNotes}
              attachments={p.attachments}
              onUpload={p.onUploadAttachments}
              onRemoveAttachment={p.onRemoveAttachment}
              uploading={p.uploadingAttachments}
              readOnly={p.readOnly}
            />
          </div>
          <TotalsPanel
            totals={p.totals}
            documentType={p.documentType}
            isIntraState={p.isIntraState}
            isExport={p.isExport}
            exportType={p.exportState.exportType}
            foreign={foreign}
            amountInWords={p.amountInWords}
            charges={p.extraCharges}
            setCharges={p.setExtraCharges}
            enableRoundOff={p.enableRoundOff}
            setEnableRoundOff={p.setEnableRoundOff}
            payments={p.payments}
            setPayments={p.setPayments}
            onOpenPaymentDetails={p.onOpenPaymentDetails}
            totalPaid={p.totalPaid}
            balance={p.balance}
            receivedRef={receivedRef}
            readOnly={p.readOnly}
            isEstimate={isEstimate}
          />
        </div>
      </div>

      <footer
        className="fixed bottom-3 z-30 rounded-2xl border border-border bg-surface px-4 py-2 shadow-lg shadow-slate-900/5"
        style={{ left: footerBox.left, width: footerBox.width, visibility: footerBox.width > 0 ? 'visible' : 'hidden' }}
      >
        <div className="flex items-center gap-4">
          <div className="hidden min-w-0 items-center gap-5 text-xs text-text-secondary md:flex">
            <FooterStat label="Items" value={`${filledRows.length} · ${Math.round(totalQty * 1000) / 1000} qty`} />
            <FooterStat label="Taxable" value={inr(p.totals.taxableAmount)} />
            {!nonTaxable && <FooterStat label={taxLabel} value={inr(p.totals.totalTax)} />}
            {foreign && <FooterStat label={`In ${foreign.currency}`} value={`≈ ${(p.totals.grandTotal / foreign.rate).toFixed(2)}`} />}
            {p.customer && <FooterStat label="Customer" value={p.customer.name} />}
          </div>

          <div className="ml-auto flex items-center gap-2.5">
            <div className="mr-1 text-right">
              <p className="text-[11px] font-medium text-text-secondary">
                {isEstimate || p.totals.grandTotal <= 0 ? (
                  'Total'
                ) : p.balance > 0.004 ? (
                  <span className="text-amber-600">Balance {inr(p.balance)}</span>
                ) : (
                  <span className="text-emerald-600">Paid in full</span>
                )}
              </p>
              <p className="text-xl font-extrabold leading-tight tabular-nums text-text-primary">{inr(p.totals.grandTotal)}</p>
            </div>

            {p.savedInvoiceId && (
              <>
                <FooterButton icon={Printer} label="Print" onClick={p.onPrint} />
                <FooterButton icon={Download} label="PDF" onClick={p.onDownload} />
                {p.isFinal && <FooterButton icon={Send} label="Share" onClick={p.onShare} />}
              </>
            )}

            {p.readOnly ? (
              <button
                type="button"
                onClick={p.onStartNew}
                className="inline-flex h-11 items-center gap-2 rounded-xl bg-primary-600 px-5 text-sm font-bold text-white shadow-lg shadow-primary-600/30 transition hover:bg-primary-700"
              >
                <FilePlus2 className="h-4 w-4" /> New {isEstimate ? 'estimate' : 'invoice'}
              </button>
            ) : (
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
                  {isEstimate ? 'Generate' : 'Generate draft'}
                  <Kbd className="hidden border-primary-200 text-primary-700 xl:inline-flex">Ctrl⇧S</Kbd>
                </button>
                <button
                  type="button"
                  onClick={p.onSaveFinal}
                  disabled={p.saving}
                  className="inline-flex h-11 items-center gap-2 rounded-xl bg-primary-600 px-5 text-sm font-bold text-white shadow-lg shadow-primary-600/30 transition hover:bg-primary-700 disabled:cursor-wait disabled:opacity-70"
                >
                  {p.saving && <Loader2 className="h-4 w-4 animate-spin" />}
                  {isEstimate ? 'Generate & send' : 'Generate invoice'}
                  <Kbd className="hidden border-white/30 bg-white/15 text-white xl:inline-flex">Ctrl S</Kbd>
                </button>
              </>
            )}
          </div>
        </div>
      </footer>

      <ItemPickerModal
        open={pickerOpen}
        initialQuery={pickerQuery}
        businessId={p.businessId}
        userId={p.userId}
        warehouseId={p.selectedWarehouseId || undefined}
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
