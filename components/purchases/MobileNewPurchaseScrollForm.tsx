'use client';

/**
 * Single-scroll mobile layout for New Purchase (flat sections + minimal underline fields).
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { ItemAutocomplete } from '@/components/ui/ItemAutocomplete';
import { Supplier, Account } from '@/types/database';
import { INDIAN_STATES, getStateCode } from '@/lib/gst-utils';
import { PurchaseDocumentTotals } from '@/lib/purchase-gst-calculator';
import { round2, roundExclusiveUnitPrice, roundRetailQty } from '@/lib/numeric-precision';
import { NumericBlurField } from '@/components/ui/NumericBlurField';
import { ChevronDown } from 'lucide-react';
import { clsx } from 'clsx';

export interface PurchaseFormState {
  status?: string;
  supplier_id: string;
  bill_number: string;
  bill_date: string;
  place_of_supply_state_code: string;
  is_reverse_charge: boolean;
  document_type: string;
  port_code: string;
  itc_eligible: boolean;
  notes: string;
  paid_amount: number;
  round_off: number;
  supplier_gstin: string;
  supplier_state_code: string;
  price_mode: 'exclusive' | 'inclusive';
}

export interface PurchaseMobileLine {
  id: string;
  item_id: string;
  item_name: string;
  item_type?: 'goods' | 'service';
  hsn_sac: string;
  quantity: number;
  unit: string;
  unit_price: number;
  discount_percent: number;
  discount_amount?: number;
  discount_on_tax_inclusive?: boolean;
  tax_rate: number;
  tax_mode?: 'exclusive' | 'inclusive';
  invoice_inclusive_line_total?: number;
  manual_cgst?: number;
  manual_sgst?: number;
  manual_igst?: number;
  discount_account_id?: string;
  batch_number?: string;
  manufacturing_date?: string;
  expiry_date?: string;
  serial_numbers?: string;
  track_batch?: boolean;
  track_serial?: boolean;
  /** Bill scan / OCR line — show replace-with-catalogue affordance. */
  fromBillExtract?: boolean;
}

export interface TotalsView {
  subtotal: number;
  taxTotal: number;
  cgstTotal: number;
  sgstTotal: number;
  igstTotal: number;
  grandTotal: number;
  intraState: boolean;
  slabSummary: {
    gst_rate: number;
    taxable_value: number;
    cgst: number;
    sgst: number;
    igst: number;
    total_tax: number;
  }[];
}

const FL = React.forwardRef<
  HTMLInputElement,
  Omit<React.InputHTMLAttributes<HTMLInputElement>, 'className'> & { label: string; dense?: boolean }
>(({ label, id, dense, ...rest }, ref) => (
  <div className={dense ? 'min-w-0 space-y-0.5' : 'space-y-1'}>
    <label
      htmlFor={id}
      className={
        dense
          ? 'block text-[10px] font-semibold uppercase tracking-wide text-text-secondary'
          : 'text-[11px] font-semibold uppercase tracking-wide text-text-secondary'
      }
    >
      {label}
    </label>
    <input
      ref={ref}
      id={id}
      className={
        dense
          ? 'focus-primary w-full border-0 border-b border-border bg-transparent pb-1.5 text-[14px] font-medium text-text-primary shadow-none outline-none placeholder:text-text-muted ring-0 focus-visible:border-border'
          : 'focus-primary w-full border-0 border-b border-border bg-transparent pb-2 text-[15px] font-medium text-text-primary shadow-none outline-none placeholder:text-text-muted ring-0 focus-visible:border-border'
      }
      {...rest}
    />
  </div>
));
FL.displayName = 'UnderlineField';

/** Line inclusive total: commit as raw text on blur so users can clear/replace without a stuck leading 0. */
function InvoiceInclusiveLineMobileInput(props: {
  itemId: string;
  anchored: number | undefined;
  fallbackTotal: number | null;
  setLineItemInvoiceTotal: (id: string, raw: string) => void;
}) {
  const seed =
    props.anchored != null
      ? round2(props.anchored)
      : props.fallbackTotal != null
        ? round2(props.fallbackTotal)
        : null;
  const [focused, setFocused] = useState(false);
  const [text, setText] = useState('');

  useEffect(() => {
    if (!focused) setText(seed != null ? String(seed) : '');
  }, [seed, focused]);

  return (
    <input
      type="text"
      inputMode="decimal"
      autoComplete="off"
      title="Match invoice; rate updates from GST and discount."
      className="max-w-[10rem] border-0 border-b border-border bg-transparent pb-1 text-right text-sm font-semibold tabular-nums text-text-primary outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
      value={text}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        props.setLineItemInvoiceTotal(props.itemId, text);
      }}
      onChange={(e) => setText(e.target.value)}
    />
  );
}

const SLABEL = 'text-[11px] font-semibold uppercase tracking-wide text-text-secondary';
/** Tighter Bill details block on mobile */
const SLABEL_DENSE = 'text-[10px] font-semibold uppercase tracking-wide text-text-secondary';
const SEL = `${SLABEL} block mb-1`;
const SEL_CLASS =
  'focus-primary w-full border-0 border-b border-border bg-transparent pb-2 text-[15px] font-medium text-text-primary shadow-none outline-none ring-0';
const SEL_CLASS_DENSE =
  'focus-primary w-full min-w-0 border-0 border-b border-border bg-transparent pb-1.5 text-[14px] font-medium text-text-primary shadow-none outline-none ring-0';

/** Flat section title (no white panel — title + rule only). */
function MobileSectionHeading({
  children,
  className = '',
  compact = false,
}: {
  children: React.ReactNode;
  className?: string;
  /** Less vertical padding under the rule (mobile Bill details). */
  compact?: boolean;
}) {
  return (
    <div className={`border-b border-border ${compact ? 'pb-1.5' : 'pb-2'} ${className}`.trim()}>
      <h2
        className={
          compact
            ? 'text-[11px] font-bold uppercase tracking-wider text-text-primary'
            : 'text-xs font-bold uppercase tracking-wider text-text-primary'
        }
      >
        {children}
      </h2>
    </div>
  );
}

export interface MobileNewPurchaseScrollFormProps {
  businessStateCode?: string | null;
  formData: PurchaseFormState;
  setFormData: React.Dispatch<React.SetStateAction<PurchaseFormState>>;
  supplierSearch: string;
  setSupplierSearch: (v: string) => void;
  supplierNeedsCatalogLink: boolean;
  showSupplierDropdown: boolean;
  setShowSupplierDropdown: (v: boolean) => void;
  filteredSuppliers: Supplier[];
  pickSupplier: (s: Supplier) => void;
  openAddSupplierModal: () => void;
  invoiceFillTracePanel: React.ReactNode;
  selectedWarehouseId: string;
  setSelectedWarehouseId: (id: string) => void;
  warehousesLoading: boolean;
  warehouses: Array<{ id: string; name: string; warehouse_code?: string }>;
  warehousesEnabled: boolean;
  effectivePurchaseBranchId: string | null;
  accounts: Account[];
  purchaseItems: PurchaseMobileLine[];
  setPurchaseItems: React.Dispatch<React.SetStateAction<PurchaseMobileLine[]>>;
  /** Navigate to mobile item picker (+ Goods / + Service). */
  onOpenItemPicker: (kind: 'goods' | 'service') => void;
  removeItem: (id: string) => void;
  updateItem: (id: string, field: keyof PurchaseMobileLine, value: unknown) => void;
  expandedItems: Set<string>;
  setExpandedItems: React.Dispatch<React.SetStateAction<Set<string>>>;
  applyInvoiceAnchorDeriveUnitPrice: (item: PurchaseMobileLine) => PurchaseMobileLine;
  setLineItemInvoiceTotal: (id: string, raw: string) => void;
  purchaseGstDoc: PurchaseDocumentTotals | null;
  totals: TotalsView;
  loading: boolean;
  isOnline: boolean;
  onSubmitDraft: () => void;
  onSubmitFinal: () => void;
}

export function MobileNewPurchaseScrollForm(props: MobileNewPurchaseScrollFormProps) {
  const itemWrapRefs = useRef<Record<string, HTMLDivElement | null>>({});
  /** Start open so ITC / reverse charge defaults stay visible; user can collapse. */
  const [billMoreOptionsOpen, setBillMoreOptionsOpen] = useState(true);
  const [itemsSectionOpen, setItemsSectionOpen] = useState(true);
  /** Null = compact line summary; set to line id to show full editor card. */
  const [editingLineId, setEditingLineId] = useState<string | null>(null);

  const itemAutocompleteClass = useMemo(
    () =>
      '!text-[16px] font-semibold leading-snug rounded-none border-0 border-b border-border pb-1 min-h-[36px]',
    [],
  );

  const balanceDue = props.totals.grandTotal - (Number(props.formData.paid_amount) || 0);

  const fillPanel = props.invoiceFillTracePanel ? (
    <div className="space-y-3 border-b border-border pb-5">{props.invoiceFillTracePanel}</div>
  ) : null;

  return (
    <div className="space-y-8 bg-background pb-36 md:hidden">
      {fillPanel}

      <section className="space-y-3 pb-5">
        <MobileSectionHeading compact>Bill details</MobileSectionHeading>

        <div className="space-y-3">
          <div>
            <div className="mb-1.5 flex flex-wrap items-center gap-2">
              <span className={SLABEL_DENSE}>Supplier · required</span>
              {props.supplierNeedsCatalogLink && (
                <span className="rounded border border-green-200 bg-green-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-green-800">
                  New party
                </span>
              )}
            </div>
            <div className="relative supplier-dropdown-container">
              <input
                type="text"
                placeholder="Search or type party name…"
                value={props.supplierSearch}
                className={`${SEL_CLASS_DENSE} px-0`}
                onChange={(e) => {
                  props.setSupplierSearch(e.target.value);
                  props.setShowSupplierDropdown(true);
                }}
                onFocus={() => props.setShowSupplierDropdown(true)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return;
                  if (props.filteredSuppliers.length !== 1) return;
                  e.preventDefault();
                  props.pickSupplier(props.filteredSuppliers[0]);
                }}
              />
              {props.showSupplierDropdown &&
                (props.filteredSuppliers.length > 0 || props.supplierSearch.trim().length > 0) && (
                  <div className="absolute z-[60] mt-1 flex max-h-56 w-full flex-col overflow-auto rounded-xl border border-border bg-white shadow-lg">
                    {props.filteredSuppliers.length === 0 && props.supplierSearch.trim().length > 0 && (
                      <div className="border-b border-border px-3 py-2.5 text-sm text-text-secondary">
                        No matches for &quot;{props.supplierSearch.trim()}&quot;
                      </div>
                    )}
                    {props.filteredSuppliers.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        className="w-full px-4 py-2.5 text-left text-sm hover:bg-gray-50"
                        onClick={() => props.pickSupplier(s)}
                      >
                        <span className="font-medium text-text-primary">{s.name}</span>
                        {s.phone && <span className="block text-xs text-text-muted">{s.phone}</span>}
                      </button>
                    ))}
                    <div className="sticky bottom-0 border-t border-border bg-surface px-3 py-2">
                      <button
                        type="button"
                        className="link-primary text-sm font-medium"
                        onClick={() => {
                          props.setShowSupplierDropdown(false);
                          props.openAddSupplierModal();
                        }}
                      >
                        + Add new supplier
                      </button>
                    </div>
                  </div>
                )}
            </div>
            {props.supplierNeedsCatalogLink && props.supplierSearch.trim().length > 0 && (
              <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-secondary">
                <button
                  type="button"
                  className="font-medium link-primary whitespace-nowrap"
                  onClick={() => props.setShowSupplierDropdown(true)}
                >
                  Choose existing supplier
                </button>
                <span className="text-text-muted">·</span>
                <button
                  type="button"
                  className="font-medium link-primary whitespace-nowrap"
                  onClick={() => props.openAddSupplierModal()}
                >
                  Create supplier record
                </button>
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-x-3 gap-y-3">
            <FL
              dense
              label="Bill number"
              value={props.formData.bill_number}
              onChange={(e) => props.setFormData({ ...props.formData, bill_number: e.target.value })}
            />
            <div className="min-w-0 space-y-0.5">
              <label className={`${SLABEL_DENSE} block`} htmlFor="mbilldate">
                Bill date · required
              </label>
              <input
                id="mbilldate"
                required
                type="date"
                value={props.formData.bill_date}
                onChange={(e) => props.setFormData({ ...props.formData, bill_date: e.target.value })}
                className={`${SEL_CLASS_DENSE} cursor-pointer`}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-x-3 gap-y-3">
            <FL
              dense
              label="Supplier GSTIN"
              value={props.formData.supplier_gstin}
              placeholder="Optional"
              onChange={(e) =>
                props.setFormData({
                  ...props.formData,
                  supplier_gstin: e.target.value.toUpperCase().replace(/\s/g, ''),
                })
              }
            />
            <div className="min-w-0 space-y-0.5">
              <label className={`${SLABEL_DENSE} block`} htmlFor="msupst">
                Supplier state (GST)
              </label>
              <select
                id="msupst"
                className={`${SEL_CLASS_DENSE} min-w-0 cursor-pointer`}
                value={props.formData.supplier_state_code || ''}
                onChange={(e) => props.setFormData({ ...props.formData, supplier_state_code: e.target.value })}
              >
                <option value="">Auto from GSTIN</option>
                {INDIAN_STATES.map((state) => (
                  <option key={state} value={getStateCode(state)}>
                    {state}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-x-3 gap-y-3">
            <div className="min-w-0 space-y-0.5">
              <label className={`${SLABEL_DENSE} block`} htmlFor="mpos">
                Place of supply
              </label>
              <select
                id="mpos"
                className={`${SEL_CLASS_DENSE} min-w-0 cursor-pointer`}
                value={props.formData.place_of_supply_state_code || props.businessStateCode || ''}
                onChange={(e) => props.setFormData({ ...props.formData, place_of_supply_state_code: e.target.value })}
              >
                <option value="">Select</option>
                {INDIAN_STATES.map((state) => (
                  <option key={state} value={getStateCode(state)}>
                    {state}
                  </option>
                ))}
              </select>
            </div>
            <div className="min-w-0 space-y-0.5">
              <label className={`${SLABEL_DENSE} block`} htmlFor="mdoctype">
                Document type
              </label>
              <select
                id="mdoctype"
                className={`${SEL_CLASS_DENSE} min-w-0 cursor-pointer`}
                value={props.formData.document_type}
                onChange={(e) => props.setFormData({ ...props.formData, document_type: e.target.value })}
              >
                <option value="tax_invoice">Tax Invoice</option>
                <option value="bill_of_supply">Bill of Supply</option>
                <option value="bill_of_entry">Bill of Entry (Import of Goods)</option>
                <option value="import_service">Import of Services</option>
              </select>
            </div>
          </div>

          <div className="space-y-0.5">
            <label className={`${SLABEL_DENSE} block`} htmlFor="mpricemode">
              Price mode
            </label>
            <select
              id="mpricemode"
              className={`${SEL_CLASS_DENSE} cursor-pointer`}
              value={props.formData.price_mode}
              onChange={(e) =>
                props.setFormData({
                  ...props.formData,
                  price_mode: e.target.value === 'inclusive' ? 'inclusive' : 'exclusive',
                })
              }
            >
              <option value="exclusive">Exclusive (rate before GST)</option>
              <option value="inclusive">Inclusive (rate includes GST)</option>
            </select>
            <details className="mt-1.5 rounded-md border border-border bg-surface px-2 py-1.5">
              <summary className="cursor-pointer list-none text-[10px] font-medium text-text-secondary [&::-webkit-details-marker]:hidden">
                When is CGST/SGST vs IGST?
              </summary>
              <p className="mt-1.5 border-t border-dashed border-border pt-1.5 text-[10px] leading-snug text-text-secondary">
                {props.totals.intraState
                  ? 'Intra-state: CGST + SGST when supplier state matches yours.'
                  : 'Inter-state: IGST when supplier state differs.'}
              </p>
            </details>
          </div>

          {props.formData.document_type === 'bill_of_entry' && (
            <FL
              dense
              label="Port code"
              placeholder="INMAA, INBOM…"
              value={props.formData.port_code}
              onChange={(e) => props.setFormData({ ...props.formData, port_code: e.target.value })}
            />
          )}

          <details
            className="rounded-lg border border-border bg-surface px-3 py-2"
            open={billMoreOptionsOpen}
            onToggle={(e) => setBillMoreOptionsOpen((e.target as HTMLDetailsElement).open)}
          >
            <summary className="cursor-pointer list-none text-sm font-medium text-text-primary [&::-webkit-details-marker]:hidden">
              More bill options
            </summary>
            <div className="mt-2 grid grid-cols-2 gap-3 border-t border-dashed border-border pt-2">
              <label className="flex cursor-pointer items-center gap-2 text-xs text-text-secondary">
                <input
                  type="checkbox"
                  className="rounded border-border text-primary-600 focus:ring-primary-500"
                  checked={props.formData.is_reverse_charge}
                  onChange={(e) => props.setFormData({ ...props.formData, is_reverse_charge: e.target.checked })}
                />
                Reverse charge
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-xs text-text-secondary">
                <input
                  type="checkbox"
                  className="rounded border-border text-primary-600 focus:ring-primary-500"
                  checked={props.formData.itc_eligible}
                  onChange={(e) => props.setFormData({ ...props.formData, itc_eligible: e.target.checked })}
                />
                ITC eligible
              </label>
            </div>
          </details>
        </div>
      </section>

      {props.warehouses.length > 0 && (
        <section className="space-y-3 pb-8">
          <MobileSectionHeading>Warehouse</MobileSectionHeading>
          {props.warehousesLoading ? (
            <p className="text-sm text-text-secondary">Loading…</p>
          ) : (
            <select
              className={`${SEL_CLASS} cursor-pointer`}
              value={props.selectedWarehouseId}
              onChange={(e) => props.setSelectedWarehouseId(e.target.value)}
            >
              {props.warehouses.map((wh) => (
                <option key={wh.id} value={wh.id}>
                  {wh.name}
                  {wh.warehouse_code ? ` (${wh.warehouse_code})` : ''}
                </option>
              ))}
            </select>
          )}
          <p className="text-[11px] text-text-muted">Used when you finalize goods into stock.</p>
        </section>
      )}

      {props.warehousesEnabled && props.effectivePurchaseBranchId && !props.warehousesLoading && props.warehouses.length === 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900">
          No warehouses linked to this branch. Finalizing goods purchases may fail until warehouses are set up in Settings.
        </div>
      )}

      <div id="purchase-mobile-items" className="pb-6">
        <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
          <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
            <button
              type="button"
              className="flex min-w-0 items-center gap-1 text-left text-xs font-bold uppercase tracking-wide text-text-primary"
              onClick={() => setItemsSectionOpen((o) => !o)}
            >
              <ChevronDown
                className={clsx(
                  'h-4 w-4 shrink-0 text-text-secondary transition-transform',
                  itemsSectionOpen ? 'rotate-180' : 'rotate-0',
                )}
              />
              <span>Items ({props.purchaseItems.length})</span>
            </button>
            <div className="flex shrink-0 gap-2 text-sm">
              <button type="button" className="font-medium link-primary" onClick={() => props.onOpenItemPicker('goods')}>
                + Goods
              </button>
              <button type="button" className="font-medium link-primary" onClick={() => props.onOpenItemPicker('service')}>
                + Service
              </button>
            </div>
          </div>

          {itemsSectionOpen && (
            <>
        {props.purchaseItems.map((item, i) => {
          const lc = props.purchaseGstDoc?.lineComputeds[i];
          const lineTotal =
            lc != null ? lc.lineTotal : item.invoice_inclusive_line_total != null ? Number(item.invoice_inclusive_line_total) : 0;

          const taxAmt = lc?.taxAmount ?? 0;
          const isEditing = editingLineId === item.id;

          if (!isEditing) {
            return (
              <div
                key={item.id}
                className="border-b border-border px-3 py-2.5 last:border-b-0"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold leading-snug text-text-primary line-clamp-3">
                      {item.item_name?.trim() ? item.item_name : '—'}
                    </div>
                    <div className="mt-1 text-[11px] text-text-secondary">
                      Qty × rate · {item.quantity} {item.unit} × ₹{item.unit_price.toFixed(2)}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="font-semibold tabular-nums text-text-primary">₹{lineTotal.toFixed(2)}</div>
                    <button
                      type="button"
                      className="link-primary mt-1 block text-xs font-medium"
                      onClick={() => setEditingLineId(item.id)}
                    >
                      Edit
                    </button>
                  </div>
                </div>
              </div>
            );
          }

          return (
            <div
              key={item.id}
              className="mb-3 rounded-xl border border-border bg-surface p-3 shadow-sm last:mb-0"
            >
              <div className="mb-2 flex items-center justify-between gap-2 border-b border-border pb-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-gray-100 text-[11px] font-semibold text-text-primary dark:bg-slate-700 dark:text-text-primary">
                    {i + 1}
                  </span>
                  {!(item.item_id || '').trim() && (item.item_name || '').trim().length > 0 && (
                    <span className="rounded border border-green-200 bg-green-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-green-800">
                      New item
                    </span>
                  )}
                </div>
                <div className="shrink-0 text-sm font-semibold tabular-nums text-text-primary">
                  ₹{lineTotal.toFixed(2)}
                </div>
              </div>

              <div
                ref={(el) => {
                  itemWrapRefs.current[item.id] = el;
                }}
                className="space-y-0.5"
              >
                <ItemAutocomplete
                  value={item.item_name}
                  className={itemAutocompleteClass}
                  onChange={(value) => props.updateItem(item.id, 'item_name', value)}
                  warehouseId={props.selectedWarehouseId || undefined}
                  onSelect={(selectedItem) => {
                    const isBarcodeScan = !item.item_id && item.item_name === '';
                    props.setPurchaseItems((purchaseItems) =>
                      purchaseItems.map((pItem) => {
                        if (pItem.id !== item.id) return pItem;
                        return {
                          ...pItem,
                          item_id: selectedItem.id,
                          item_name: selectedItem.name,
                          item_type: selectedItem.item_type || 'goods',
                          hsn_sac: selectedItem.hsn_sac || '',
                          unit:
                            selectedItem.unit || (selectedItem.item_type === 'service' ? 'NOS' : 'pcs'),
                          unit_price: roundExclusiveUnitPrice(Number(selectedItem.purchase_price) || 0),
                          tax_rate: round2(Number(selectedItem.tax_rate) || 0),
                          quantity: isBarcodeScan ? roundRetailQty(1) : pItem.quantity,
                          invoice_inclusive_line_total: undefined,
                          fromBillExtract: false,
                          track_batch: (selectedItem as { track_batch?: boolean }).track_batch || false,
                          track_serial: (selectedItem as { track_serial?: boolean }).track_serial || false,
                          batch_number:
                            (selectedItem as { track_batch?: boolean }).track_batch
                              ? pItem.batch_number || ''
                              : undefined,
                          serial_numbers:
                            (selectedItem as { track_serial?: boolean }).track_serial
                              ? pItem.serial_numbers || ''
                              : undefined,
                        };
                      }),
                    );

                    const trackB = (selectedItem as { track_batch?: boolean }).track_batch || false;
                    const trackS = (selectedItem as { track_serial?: boolean }).track_serial || false;
                    if (trackB || trackS) {
                      props.setExpandedItems((prev) => new Set([...prev, item.id]));
                    }
                    if (isBarcodeScan) {
                      setTimeout(() => {
                        const qInput = document.querySelector(
                          `input[data-mobile-purchase-item-id="${item.id}"][data-field="quantity"]`,
                        ) as HTMLInputElement | null;
                        qInput?.focus();
                        qInput?.select();
                      }, 100);
                    }
                  }}
                />
                {!(item.item_id || '').trim() && (
                  <p className="text-[10px] leading-snug text-text-secondary">
                    Not in catalogue — search to link inventory.
                  </p>
                )}
              </div>

              <div className="mt-2 grid grid-cols-2 gap-x-2 gap-y-1 border-b border-dashed border-border pb-2">
                <div className="min-w-0">
                  <span className={`${SLABEL_DENSE} block`}>HSN / SAC</span>
                  <input
                    type="text"
                    value={item.hsn_sac}
                    onChange={(e) => props.updateItem(item.id, 'hsn_sac', e.target.value)}
                    className={SEL_CLASS_DENSE}
                  />
                </div>
                <div className="min-w-0 text-right">
                  <span className={`${SLABEL_DENSE} block`}>Tax</span>
                  <p className="pt-0.5 text-sm font-medium tabular-nums text-text-primary">
                    {item.tax_rate || 0}% · ₹{taxAmt.toFixed(2)}
                  </p>
                </div>
              </div>

              <div className="mt-2 grid grid-cols-2 gap-x-2 gap-y-2">
                <NumericBlurField
                  compact
                  label="Qty"
                  mode="qty"
                  value={item.quantity}
                  nativeInputProps={{
                    'data-mobile-purchase-item-id': item.id,
                    'data-field': 'quantity',
                  }}
                  onCommit={(v) => props.updateItem(item.id, 'quantity', v)}
                />
                <NumericBlurField
                  compact
                  label="Rate (₹ ex‑GST)"
                  mode="rate"
                  value={item.unit_price}
                  onCommit={(v) => props.updateItem(item.id, 'unit_price', v)}
                />
                <NumericBlurField
                  compact
                  label="Disc %"
                  mode="percent"
                  value={item.discount_percent}
                  onCommit={(v) => {
                    const pct = round2(v);
                    props.setPurchaseItems((rows) =>
                      rows.map((pItem) => {
                        if (pItem.id !== item.id) return pItem;
                        let next: PurchaseMobileLine = {
                          ...pItem,
                          discount_percent: pct,
                          discount_amount: pct > 0 ? 0 : (pItem.discount_amount ?? 0),
                          discount_on_tax_inclusive: pct > 0 ? false : pItem.discount_on_tax_inclusive,
                        };
                        if (next.invoice_inclusive_line_total != null) {
                          next = props.applyInvoiceAnchorDeriveUnitPrice(next);
                        }
                        return next;
                      }),
                    );
                  }}
                />
                <NumericBlurField
                  compact
                  label="Disc ₹"
                  mode="money"
                  value={item.discount_amount ?? 0}
                  onCommit={(amt) => {
                    const v = round2(amt);
                    props.setPurchaseItems((rows) =>
                      rows.map((pItem) => {
                        if (pItem.id !== item.id) return pItem;
                        let next: PurchaseMobileLine = {
                          ...pItem,
                          discount_amount: v,
                          discount_percent: v > 0 ? 0 : pItem.discount_percent,
                          discount_on_tax_inclusive: v > 0 ? (pItem.discount_on_tax_inclusive ?? false) : false,
                        };
                        if (next.invoice_inclusive_line_total != null) {
                          next = props.applyInvoiceAnchorDeriveUnitPrice(next);
                        }
                        return next;
                      }),
                    );
                  }}
                />
              </div>

              {props.formData.price_mode === 'exclusive' && (item.discount_amount ?? 0) > 0 && (
                <label className="mt-1.5 flex cursor-pointer items-center gap-2 text-[11px] text-text-secondary">
                  <input
                    type="checkbox"
                    className="rounded border-border text-primary-600 focus:ring-primary-500"
                    checked={item.discount_on_tax_inclusive === true}
                    onChange={(e) => props.updateItem(item.id, 'discount_on_tax_inclusive', e.target.checked)}
                  />
                  Discount on price incl. GST
                </label>
              )}

              <div className="mt-2 grid grid-cols-2 gap-x-2 gap-y-2">
                <NumericBlurField
                  compact
                  label="GST %"
                  mode="percent"
                  value={item.tax_rate}
                  onCommit={(v) => props.updateItem(item.id, 'tax_rate', v)}
                />
                <div className="space-y-0.5">
                  <span className={`${SLABEL_DENSE} block`}>Taxable (ex‑GST)</span>
                  <div className="flex h-[30px] items-end justify-end border-b border-border pb-1.5 text-sm font-medium tabular-nums text-text-primary">
                    {lc != null ? `₹${lc.taxableValue.toFixed(2)}` : '—'}
                  </div>
                </div>
              </div>

              <div className="mt-2 space-y-0.5">
                <label className={`${SLABEL_DENSE} block`} htmlFor={`mdisc-${item.id}`}>
                  Discount account
                </label>
                <select
                  id={`mdisc-${item.id}`}
                  className={`${SEL_CLASS_DENSE} cursor-pointer`}
                  value={item.discount_account_id || ''}
                  onChange={(e) => props.updateItem(item.id, 'discount_account_id', e.target.value || undefined)}
                >
                  <option value="">None</option>
                  {props.accounts
                    .filter((acc) => acc.account_type === 'income' && acc.is_active)
                    .map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.account_code} — {account.account_name}
                      </option>
                    ))}
                </select>
              </div>

              {(item.track_batch || item.track_serial) && (
                <div className="mt-2 border-t border-dashed border-border pt-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-text-secondary">
                      Batch / serial
                    </span>
                    <button
                      type="button"
                      className="link-primary text-[11px] font-medium"
                      onClick={() =>
                        props.setExpandedItems((prev) => {
                          const n = new Set(prev);
                          if (n.has(item.id)) n.delete(item.id);
                          else n.add(item.id);
                          return n;
                        })
                      }
                    >
                      {props.expandedItems.has(item.id) ? 'Hide' : 'Show'}
                    </button>
                  </div>
                  {props.expandedItems.has(item.id) && (
                    <div className="mt-2 space-y-2 rounded-lg border border-border bg-muted p-2.5">
                      {item.track_batch && (
                        <>
                          <FL
                            label="Batch no."
                            value={item.batch_number || ''}
                            onChange={(e) => props.updateItem(item.id, 'batch_number', e.target.value)}
                          />
                          <div className="grid grid-cols-2 gap-2">
                            <div className="space-y-1">
                              <label className={SLABEL}>Mfg date</label>
                              <input
                                type="date"
                                value={item.manufacturing_date || ''}
                                onChange={(e) =>
                                  props.updateItem(item.id, 'manufacturing_date', e.target.value)
                                }
                                className={SEL_CLASS}
                              />
                            </div>
                            <div className="space-y-1">
                              <label className={SLABEL}>Expiry</label>
                              <input
                                type="date"
                                value={item.expiry_date || ''}
                                onChange={(e) => props.updateItem(item.id, 'expiry_date', e.target.value)}
                                className={SEL_CLASS}
                              />
                            </div>
                          </div>
                        </>
                      )}
                      {item.track_serial && (
                        <div className="space-y-1">
                          <label className={SLABEL}>Serial nos.</label>
                          <textarea
                            rows={2}
                            value={item.serial_numbers || ''}
                            placeholder="Comma or newline"
                            className="w-full rounded-lg border border-border bg-white px-2 py-1.5 text-sm outline-none ring-0 focus:border-border focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 dark:bg-surface-dark"
                            onChange={(e) => props.updateItem(item.id, 'serial_numbers', e.target.value)}
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              <div className="mt-3 border-t border-border pt-2">
                <div className="flex flex-wrap items-end justify-between gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-text-secondary">
                    Line incl. GST
                  </span>
                  <InvoiceInclusiveLineMobileInput
                    itemId={item.id}
                    anchored={
                      item.invoice_inclusive_line_total != null
                        ? Number(item.invoice_inclusive_line_total)
                        : undefined
                    }
                    fallbackTotal={lc != null ? lc.lineTotal : null}
                    setLineItemInvoiceTotal={props.setLineItemInvoiceTotal}
                  />
                </div>
              </div>

              <div className="mt-2 flex flex-wrap gap-2 border-t border-dashed border-border pt-2">
                {item.fromBillExtract === true && (
                  <button
                    type="button"
                    className="min-h-10 rounded-lg border border-border bg-white px-2.5 text-xs font-medium text-text-primary touch-manipulation dark:bg-surface-dark"
                    onClick={() => itemWrapRefs.current[item.id]?.querySelector('input')?.focus()}
                  >
                    Replace with catalogue item
                  </button>
                )}
                <button
                  type="button"
                  className="min-h-10 px-1 text-xs font-medium text-red-600 touch-manipulation"
                  onClick={() => {
                    if (editingLineId === item.id) setEditingLineId(null);
                    props.removeItem(item.id);
                  }}
                >
                  Delete line
                </button>
              </div>
              <div className="mt-2 flex justify-end border-t border-border pt-2">
                <button
                  type="button"
                  className="text-sm font-medium text-text-secondary"
                  onClick={() => setEditingLineId(null)}
                >
                  Done
                </button>
              </div>
            </div>
          );
        })}

        {props.purchaseItems.length === 0 && (
          <div className="border-b border-dashed border-border py-10 text-center text-sm text-text-secondary">
            No lines yet. Tap + Goods or + Service to choose from your catalogue.
          </div>
        )}
            </>
          )}
        <div className="flex items-center justify-between border-t border-border bg-muted px-3 py-2 text-sm">
          <span className="text-text-secondary">Item subtotal (taxable)</span>
          <span className="font-medium tabular-nums text-text-primary">₹{props.totals.subtotal.toFixed(2)}</span>
        </div>
        </div>
      </div>

      <section className="space-y-4 pb-8">
        <MobileSectionHeading>GST &amp; totals</MobileSectionHeading>
        <div className="space-y-2 pt-1 text-sm">
          <div className="flex justify-between text-text-secondary">
            <span>Subtotal (taxable)</span>
            <span className="font-medium tabular-nums text-text-primary">₹{props.totals.subtotal.toFixed(2)}</span>
          </div>
          {(props.totals.cgstTotal > 0.005 || props.totals.sgstTotal > 0.005) && (
            <>
              <div className="flex justify-between text-text-secondary">
                <span>CGST</span>
                <span className="font-medium tabular-nums text-text-primary">₹{props.totals.cgstTotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-text-secondary">
                <span>SGST</span>
                <span className="font-medium tabular-nums text-text-primary">₹{props.totals.sgstTotal.toFixed(2)}</span>
              </div>
            </>
          )}
          {props.totals.igstTotal > 0.005 && props.totals.cgstTotal < 0.005 && props.totals.sgstTotal < 0.005 && (
            <div className="flex justify-between text-text-secondary">
              <span>IGST</span>
              <span className="font-medium tabular-nums text-text-primary">₹{props.totals.igstTotal.toFixed(2)}</span>
            </div>
          )}
          {props.totals.taxTotal > 0.005 &&
            props.totals.cgstTotal < 0.005 &&
            props.totals.sgstTotal < 0.005 &&
            props.totals.igstTotal < 0.005 && (
              <div className="flex justify-between text-text-secondary">
                <span>GST</span>
                <span className="font-medium tabular-nums text-text-primary">₹{props.totals.taxTotal.toFixed(2)}</span>
              </div>
            )}
          {props.totals.slabSummary.length > 0 && (
            <div className="mt-3 overflow-hidden rounded-lg border border-border">
              <div className="bg-gray-50 px-3 py-2 text-xs font-semibold text-text-secondary">GST by rate</div>
              {props.totals.slabSummary.map((row) => (
                <div key={row.gst_rate} className="flex justify-between border-t border-border px-3 py-1.5 text-xs">
                  <span>{row.gst_rate}%</span>
                  <span className="font-medium tabular-nums">Tax ₹{row.total_tax.toFixed(2)}</span>
                </div>
              ))}
            </div>
          )}
          {Math.abs(Number(props.formData.round_off) || 0) > 0.005 && (
            <div className="flex justify-between text-text-secondary">
              <span>Round off</span>
              <span className="tabular-nums">₹{(Number(props.formData.round_off) || 0).toFixed(2)}</span>
            </div>
          )}
          <div className="flex justify-between border-t border-border pt-3 text-base font-bold text-text-primary">
            <span>Grand total</span>
            <span className="tabular-nums">₹{props.totals.grandTotal.toFixed(2)}</span>
          </div>
        </div>
      </section>

      <section className="space-y-5 pb-8">
        <MobileSectionHeading>Payment &amp; notes</MobileSectionHeading>
        <div className="space-y-5 pt-1">
          <NumericBlurField
            label="Paid amount"
            id="mpaid"
            mode="money"
            value={props.formData.paid_amount}
            onCommit={(v) => props.setFormData((prev) => ({ ...prev, paid_amount: v }))}
          />
          <NumericBlurField
            label="Round off"
            id="mround"
            mode="money"
            value={props.formData.round_off}
            onCommit={(v) => props.setFormData((prev) => ({ ...prev, round_off: v }))}
          />
          <div className="space-y-1">
            <label className={SLABEL} htmlFor="mnotes">
              Notes
            </label>
            <textarea
              id="mnotes"
              rows={3}
              value={props.formData.notes}
              onChange={(e) => props.setFormData({ ...props.formData, notes: e.target.value })}
              className="w-full border-0 border-b border-border bg-transparent pb-2 text-sm text-text-primary outline-none placeholder:text-text-muted ring-0 focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
              placeholder="Internal notes…"
            />
          </div>
          <div className="rounded-lg bg-gray-50 p-4 text-sm">
            <div className="flex justify-between">
              <span className="text-text-secondary">Amount paid</span>
              <span className="font-semibold tabular-nums text-green-700">₹{(props.formData.paid_amount || 0).toFixed(2)}</span>
            </div>
            <div className="mt-2 flex justify-between border-t border-border pt-2">
              <span className="text-text-secondary">Balance due</span>
              <span className={`font-semibold tabular-nums ${balanceDue > 0.005 ? 'text-red-600' : 'text-text-primary'}`}>
                ₹{balanceDue.toFixed(2)}
              </span>
            </div>
          </div>
        </div>
      </section>

      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 md:hidden">
        <div className="pointer-events-auto mx-auto max-w-lg rounded-t-xl border border-border bg-white pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-4px_24px_rgba(0,0,0,0.08)]">
          <div className="mb-3 flex items-center justify-between px-4 text-sm">
            <span className="text-text-secondary">Total</span>
            <span className="text-lg font-bold tabular-nums text-text-primary">₹{props.totals.grandTotal.toFixed(2)}</span>
          </div>
          <div className="flex gap-3 px-3">
            <Button
              type="button"
              variant="secondary"
              className="h-11 flex-1"
              disabled={props.loading}
              onClick={() => props.onSubmitDraft()}
            >
              Save draft
            </Button>
            <Button
              type="button"
              variant="primary"
              className="h-11 flex-[1.2]"
              disabled={props.loading || !props.isOnline}
              isLoading={props.loading}
              onClick={() => props.onSubmitFinal()}
            >
              {props.isOnline ? 'Finalize' : 'Offline'}
            </Button>
          </div>
          <p className="mt-2 px-4 text-center text-[10px] text-text-muted">
            {props.isOnline ? 'Finalizing posts to GST‑linked books.' : 'Go online to finalize for filing.'}
          </p>
        </div>
      </div>
    </div>
  );
}
