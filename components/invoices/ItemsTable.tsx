'use client';

import React from 'react';
import { clsx } from 'clsx';
import { Button } from '@/components/ui/Button';
import { ItemAutocomplete } from '@/components/ui/ItemAutocomplete';
import { Plus, Trash2, ArrowLeft } from 'lucide-react';

// InvoiceItemRow interface (matching parent definition)
interface InvoiceItemRow {
  itemId: string;
  name: string;
  variantId?: string;
  variantName?: string;
  quantity: number;
  freeQty: number;
  unit: string;
  price: number;
  discountPercent: number;
  discountAmount: number;
  taxPercent: number;
  taxAmount: number;
  hsnSac: string;
  taxableValue: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  total: number;
  gstIncluded?: boolean;
  priceUserOverride?: boolean;
}

interface ItemsTableProps {
  // Rows data
  rows: InvoiceItemRow[];
  
  // Row update handlers
  onUpdateRow: <K extends keyof InvoiceItemRow>(index: number, field: K, value: InvoiceItemRow[K]) => void;
  onItemSelect: (item: any, rowIndex?: number) => void;
  
  // Row management
  onAddRow: () => void;
  onRemoveRow: (index: number) => void;
  
  // Display flags
  isFinal: boolean;
  documentType: string;
  
  // Refs for ItemAutocomplete inputs (for auto-focus on barcode scan)
  itemInputRefs?: (React.RefObject<HTMLInputElement> | null)[];
  
  // Add new item callback
  onAddNewItem?: () => void;
  
  // POS mode flag - simplifies table for retail POS
  posMode?: boolean;
  
  // Totals for POS mode bill summary
  subtotal?: number;
  totalTax?: number;
  grandTotal?: number;
  
  // Warehouse ID for warehouse-specific stock
  warehouseId?: string;

  /** Table (default), stacked cards, or Billbok-style compact rows + edit sheet */
  layout?: 'table' | 'cards' | 'compact';
  /** Recalculate row totals when editing in compact edit sheet */
  recalculateRow?: (row: InvoiceItemRow, skipDiscountRecalc?: boolean) => InvoiceItemRow;
  onReplaceRow?: (index: number, row: InvoiceItemRow) => void;
}

const ItemsTable = React.memo(function ItemsTable({
  rows,
  onUpdateRow,
  onItemSelect,
  onAddRow,
  onRemoveRow,
  isFinal,
  documentType,
  itemInputRefs,
  warehouseId,
  onAddNewItem,
  posMode = false,
  subtotal = 0,
  totalTax = 0,
  grandTotal = 0,
  layout = 'table',
  recalculateRow,
  onReplaceRow,
}: ItemsTableProps) {
  const [editIndex, setEditIndex] = React.useState<number | null>(null);
  const [editDraft, setEditDraft] = React.useState<InvoiceItemRow | null>(null);
  const [editTab, setEditTab] = React.useState<'price' | 'other'>('price');

  // POS Mode: Simplified table (Item Name, Qty, Price, Tax, Total)
  // Invoice Mode: Full table (includes HSN, Discount)
  
  const [posSearchValue, setPosSearchValue] = React.useState('');
  const [lastScannedItem, setLastScannedItem] = React.useState<InvoiceItemRow | null>(null);
  const lastScannedItemRef = React.useRef<InvoiceItemRow | null>(null);
  
  // Update last scanned item when rows change (new item added)
  React.useEffect(() => {
    if (posMode && rows.length > 0) {
      // Find the most recently added item (last non-empty row)
      const filledRows = rows.filter(r => r.itemId && r.name);
      if (filledRows.length > 0) {
        const lastRow = filledRows[filledRows.length - 1];
        // Only update if it's different from current display (new item or quantity changed)
        if (!lastScannedItemRef.current || 
            lastScannedItemRef.current.itemId !== lastRow.itemId || 
            lastScannedItemRef.current.quantity !== lastRow.quantity ||
            lastScannedItemRef.current.total !== lastRow.total) {
          setLastScannedItem(lastRow);
          lastScannedItemRef.current = lastRow;
        }
      } else {
        // No filled rows, clear display
        setLastScannedItem(null);
        lastScannedItemRef.current = null;
      }
    }
  }, [rows, posMode]);

  /** Bordered inputs — text-sm matches header scale; min-w-0 works inside table-fixed cells. */
  const tableFieldBase =
    'box-border w-full min-w-0 rounded-md border border-border bg-background px-3 py-2 text-sm font-medium tabular-nums text-text-primary outline-none placeholder:text-text-muted focus:ring-2 focus:ring-primary-500/20 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-slate-900/30';

  if (layout === 'compact' && !posMode) {
    const gstOptions = [0, 0.1, 0.25, 1, 1.5, 3, 5, 6, 7.5, 12, 18, 28];
    const openEdit = (i: number) => {
      setEditDraft({ ...rows[i] });
      setEditTab('price');
      setEditIndex(i);
    };
    const patchDraft = (partial: Partial<InvoiceItemRow>, skipDisc = false) => {
      if (!recalculateRow || editDraft === null) return;
      setEditDraft((prev) =>
        prev ? recalculateRow({ ...prev, ...partial, priceUserOverride: true }, skipDisc) : prev
      );
    };
    const applyEdit = () => {
      if (editIndex === null || !editDraft || !onReplaceRow) return;
      onReplaceRow(editIndex, editDraft);
      setEditIndex(null);
      setEditDraft(null);
    };

    return (
      <>
        <div className="bg-surface rounded-lg border border-border shadow-sm overflow-hidden">
          <div className="p-3 border-b border-border bg-gray-50 dark:bg-slate-800">
            <h3 className="text-sm font-semibold text-text-primary">Items ({rows.filter((r) => r.itemId).length})</h3>
          </div>
          {rows.filter((r) => r.itemId || r.name).length > 0 ? (
            <div className="divide-y divide-border">
              {rows.map((row, i) => {
                if (!row.itemId && !row.name) return null;
                const unit = row.unit || 'PCS';
                return (
                  <div key={i} className="px-3 py-3 flex gap-3 items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-text-primary truncate">{row.name || 'Item'}</p>
                      <p className="text-xs text-text-secondary mt-0.5">
                        Qty × Rate · {row.quantity} {unit} × ₹{Number(row.price).toFixed(2)}
                      </p>
                    </div>
                    <div className="text-right shrink-0 flex flex-col items-end gap-1">
                      <span className="font-semibold text-text-primary tabular-nums">₹{row.total.toFixed(2)}</span>
                      {!isFinal && (
                        <button
                          type="button"
                          onClick={() => openEdit(i)}
                          className="text-xs font-semibold text-primary-600 border border-primary-300 rounded-full px-3 py-0.5"
                        >
                          EDIT
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}
          {!isFinal && (
            <div
              className={clsx(
                'p-3 bg-gray-50 dark:bg-slate-800',
                rows.filter((r) => r.itemId || r.name).length > 0 && 'border-t border-border'
              )}
            >
              <button type="button" onClick={onAddRow} className="flex items-center gap-2 text-primary-600 text-sm font-medium w-full justify-center py-2">
                <Plus className="w-4 h-4" /> Add item
              </button>
            </div>
          )}
        </div>
        {editIndex !== null && editDraft && recalculateRow && onReplaceRow && (
          <>
            <button
              type="button"
              className="fixed inset-0 z-[60] bg-black/40 animate-in fade-in duration-200"
              aria-label="Close"
              onClick={() => {
                setEditIndex(null);
                setEditDraft(null);
              }}
            />
            <div className="fixed inset-x-0 bottom-0 z-[61] flex max-h-[50vh] flex-col rounded-t-2xl border border-border bg-background shadow-[0_-8px_30px_rgba(0,0,0,0.12)] animate-in slide-in-from-bottom duration-300">
              <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-border" aria-hidden />
              <div className="flex items-center gap-2 border-b border-border px-3 py-3 bg-surface shrink-0">
            <button type="button" onClick={() => { setEditIndex(null); setEditDraft(null); }} className="p-2 -ml-1 text-text-secondary" aria-label="Back">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <h2 className="flex-1 text-base font-semibold text-text-primary truncate pr-2">{editDraft.name || 'Edit item'}</h2>
            {!isFinal && (
              <button
                type="button"
                onClick={() => { onRemoveRow(editIndex!); setEditIndex(null); setEditDraft(null); }}
                className="text-xs font-bold text-red-600 border border-red-300 rounded px-2 py-1"
              >
                DEL
              </button>
            )}
          </div>
          <div className="flex border-b border-border shrink-0">
            <button
              type="button"
              onClick={() => setEditTab('price')}
              className={`flex-1 py-2.5 text-sm font-medium ${editTab === 'price' ? 'text-primary-600 border-b-2 border-primary-600' : 'text-text-secondary'}`}
            >
              Price & Discount
            </button>
            <button
              type="button"
              onClick={() => setEditTab('other')}
              className={`flex-1 py-2.5 text-sm font-medium ${editTab === 'other' ? 'text-primary-600 border-b-2 border-primary-600' : 'text-text-secondary'}`}
            >
              Other Details
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4 space-y-4">
            {editTab === 'price' ? (
              <>
                <div>
                  <label className="text-xs font-semibold text-text-secondary uppercase">Price (ex tax)</label>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    value={Number(editDraft.price).toFixed(2)}
                    onChange={(e) => patchDraft({ price: Number(e.target.value) })}
                    className={`${tableFieldBase} mt-1 text-right`}
                    disabled={isFinal}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-text-secondary uppercase">Qty</label>
                    <input
                      type="number"
                      inputMode="numeric"
                      value={editDraft.quantity}
                      onChange={(e) => patchDraft({ quantity: Number(e.target.value) })}
                      className={`${tableFieldBase} mt-1 text-right`}
                      disabled={isFinal}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-text-secondary uppercase">Unit</label>
                    <input value={editDraft.unit || 'PCS'} readOnly className={`${tableFieldBase} mt-1 bg-gray-50`} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-text-secondary uppercase">Disc %</label>
                    <input
                      type="number"
                      inputMode="decimal"
                      value={editDraft.discountPercent}
                      onChange={(e) => patchDraft({ discountPercent: Number(e.target.value), discountAmount: 0 })}
                      className={`${tableFieldBase} mt-1 text-right`}
                      disabled={isFinal}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-text-secondary uppercase">Disc ₹</label>
                    <input
                      type="number"
                      inputMode="decimal"
                      value={editDraft.discountAmount}
                      onChange={(e) => patchDraft({ discountAmount: Number(e.target.value), discountPercent: 0 }, true)}
                      className={`${tableFieldBase} mt-1 text-right`}
                      disabled={isFinal}
                    />
                  </div>
                </div>
                {documentType !== 'bill_of_supply' && (
                  <div>
                    <label className="text-xs font-semibold text-text-secondary uppercase">GST %</label>
                    <select
                      value={editDraft.taxPercent}
                      onChange={(e) => patchDraft({ taxPercent: Number(e.target.value) })}
                      className={`${tableFieldBase} mt-1`}
                      disabled={isFinal}
                    >
                      {gstOptions.map((g) => (
                        <option key={g} value={g}>{g}%</option>
                      ))}
                    </select>
                  </div>
                )}
              </>
            ) : (
              <>
                <div>
                  <label className="text-xs font-semibold text-text-secondary uppercase">HSN / SAC</label>
                  <input
                    value={editDraft.hsnSac}
                    onChange={(e) => patchDraft({ hsnSac: e.target.value }, true)}
                    className={`${tableFieldBase} mt-1`}
                    disabled={isFinal}
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-text-secondary uppercase">Free qty</label>
                  <input
                    type="number"
                    value={editDraft.freeQty}
                    onChange={(e) => patchDraft({ freeQty: Number(e.target.value) })}
                    className={`${tableFieldBase} mt-1 text-right`}
                    disabled={isFinal}
                  />
                </div>
              </>
            )}
            <div className="rounded-lg border border-border bg-gray-50 dark:bg-slate-800/50 p-3 space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-text-secondary">Taxable</span><span className="tabular-nums">₹{editDraft.taxableValue.toFixed(2)}</span></div>
              {documentType !== 'bill_of_supply' && (
                <div className="flex justify-between"><span className="text-text-secondary">Tax</span><span className="tabular-nums">₹{editDraft.taxAmount.toFixed(2)}</span></div>
              )}
              <div className="flex justify-between font-semibold text-text-primary pt-1 border-t border-border">
                <span>Line total</span><span className="tabular-nums">₹{editDraft.total.toFixed(2)}</span>
              </div>
            </div>
          </div>
          <div className="p-4 border-t border-border bg-surface shrink-0">
            <Button type="button" variant="primary" className="w-full" onClick={applyEdit} disabled={isFinal}>
              Done
            </Button>
          </div>
        </div>
          </>
        )}
      </>
    );
  }

  if (layout === 'cards' && !posMode) {
    return (
      <div className="bg-surface rounded-lg border border-border shadow-sm overflow-hidden flex flex-col">
        <div className="p-3 border-b border-border bg-gray-50 dark:bg-slate-800 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-text-primary">Items</h3>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-3 max-h-[min(70vh,520px)]">
          {rows.length === 0 ? (
            <p className="text-center text-text-muted text-sm py-6">No items yet. Search or scan to add.</p>
          ) : (
            rows.map((row, i) => (
              <div key={i} className="rounded-lg border border-border p-3 bg-surface shadow-sm space-y-2">
                <div className="flex justify-between items-start gap-2">
                  <span className="text-xs font-bold text-primary-600 bg-slate-50 w-6 h-6 rounded-full flex items-center justify-center shrink-0">{i + 1}</span>
                  {!isFinal && rows.length > 1 && (
                    <button type="button" onClick={() => onRemoveRow(i)} className="text-text-muted hover:text-red-500 dark:hover:text-red-400 p-1" aria-label="Remove line">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase text-text-secondary block mb-1">Item</label>
                  <ItemAutocomplete
                    value={row.name}
                    onChange={(val) => onUpdateRow(i, 'name', val)}
                    inputRef={itemInputRefs?.[i] || undefined}
                    warehouseId={warehouseId}
                    onSelect={(item) => onItemSelect(item, i)}
                    onAddNew={onAddNewItem}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] font-bold uppercase text-text-secondary block mb-1">HSN</label>
                    <input
                      value={row.hsnSac}
                      onChange={(e) => onUpdateRow(i, 'hsnSac', e.target.value)}
                      className="w-full border border-border rounded px-2 py-1.5 text-sm bg-surface text-text-primary"
                      disabled={isFinal}
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold uppercase text-text-secondary block mb-1">Qty</label>
                    <input
                      type="number"
                      inputMode="numeric"
                      value={row.quantity}
                      onChange={(e) => onUpdateRow(i, 'quantity', Number(e.target.value))}
                      className="w-full border border-border rounded px-2 py-1.5 text-sm text-right bg-surface text-text-primary"
                      disabled={isFinal}
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold uppercase text-text-secondary block mb-1">Price</label>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      value={Number(row.price).toFixed(2)}
                      onChange={(e) => onUpdateRow(i, 'price', Number(e.target.value))}
                      className="w-full border border-border rounded px-2 py-1.5 text-sm text-right bg-surface text-text-primary"
                      disabled={isFinal}
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold uppercase text-text-secondary block mb-1">Disc %</label>
                    <input
                      type="number"
                      inputMode="decimal"
                      value={row.discountPercent}
                      onChange={(e) => onUpdateRow(i, 'discountPercent', Number(e.target.value))}
                      className="w-full border border-border rounded px-2 py-1.5 text-sm text-right bg-surface text-text-primary"
                      placeholder="%"
                      disabled={isFinal}
                    />
                  </div>
                </div>
                {documentType !== 'bill_of_supply' && (
                  <div>
                    <label className="text-[10px] font-bold uppercase text-text-secondary block mb-1">Tax %</label>
                    <input
                      type="number"
                      inputMode="decimal"
                      value={row.taxPercent}
                      onChange={(e) => onUpdateRow(i, 'taxPercent', Number(e.target.value))}
                      className="w-full border border-border rounded px-2 py-1.5 text-sm text-right bg-surface text-text-primary"
                      disabled={isFinal}
                    />
                    <div className="text-xs text-red-600 dark:text-red-400 text-right">Tax ₹{row.taxAmount.toFixed(2)}</div>
                  </div>
                )}
                <div className="flex justify-between items-center pt-2 border-t border-dashed border-border">
                  <span className="text-sm text-text-secondary">Line total</span>
                  <span className="text-base font-bold text-text-primary">₹{row.total.toFixed(2)}</span>
                </div>
              </div>
            ))
          )}
        </div>
        {!isFinal && (
          <div className="p-3 bg-gray-50 dark:bg-slate-800 border-t border-border">
            <button
              type="button"
              onClick={onAddRow}
              className="flex items-center gap-2 text-primary-600 dark:text-sky-400 dark:hover:text-sky-300 text-sm font-medium w-full justify-center py-2 hover:bg-white dark:hover:bg-slate-700/80 rounded transition"
            >
              <Plus className="w-4 h-4" /> Add Line
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-sm"
      style={{ height: '100%' }}
    >
      {/* POS Mode: Large Item Search Input Above Table */}
      {posMode && !isFinal && (
        <div className="p-4 border-b border-border bg-surface flex-shrink-0">
          <div className="border-2 border-border rounded-lg focus-within:border-primary-500 focus-within:ring-2 focus-within:ring-primary-200 dark:focus-within:ring-primary-900/40">
            <ItemAutocomplete 
              value={posSearchValue} 
              onChange={setPosSearchValue} 
              inputRef={itemInputRefs?.[0] || undefined}
              warehouseId={warehouseId}
              onSelect={item => {
                // In POS mode, find the first empty row or use the first row if it's empty
                const firstEmptyIndex = rows.findIndex(r => !r.itemId && !r.name);
                const targetIndex = firstEmptyIndex >= 0 ? firstEmptyIndex : (rows.length > 0 && !rows[0].itemId ? 0 : rows.length);
                onItemSelect(item, targetIndex);
                // Clear search input after selection
                setPosSearchValue('');
                // Focus search input again after a brief delay
                setTimeout(() => {
                  if (itemInputRefs?.[0]?.current) {
                    itemInputRefs[0].current?.focus();
                  }
                }, 100);
              }}
              onAddNew={onAddNewItem}
              placeholder="Scan barcode or type item name..."
              className="h-14 text-lg px-4"
            />
          </div>
        </div>
      )}
      
      {/* POS Mode: Last Scanned Item Display (neutral per color rules) */}
      {posMode && !isFinal && lastScannedItem && (
        <div className="px-4 py-3 bg-gray-50 dark:bg-slate-800 border-b border-border flex-shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <div className="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-1">Last Scanned Item</div>
              <div className="flex items-center gap-4">
                <div className="flex-1">
                  <div className="text-2xl font-bold text-text-primary mb-1">{lastScannedItem.name}</div>
                  <div className="flex items-center gap-4 text-sm text-text-secondary">
                    <span><strong>Qty:</strong> {lastScannedItem.quantity} {lastScannedItem.unit}</span>
                    <span><strong>Price:</strong> ₹{lastScannedItem.price.toFixed(2)}</span>
                    {lastScannedItem.taxPercent > 0 && (
                      <span><strong>Tax:</strong> {lastScannedItem.taxPercent}%</span>
                    )}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-1">Line Total</div>
                  <div className="text-3xl font-bold text-text-primary">₹{lastScannedItem.total.toFixed(2)}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* Scrollable Table Area — table-fixed + colgroup keeps numeric columns wide enough for long values */}
      <div className="flex-1 overflow-x-auto overflow-y-auto">
        <table className="w-full min-w-[720px] table-fixed border-collapse border-spacing-0 text-sm">
        <colgroup>
          <col className="w-10" />
          <col />
          {!posMode && <col className="w-[7rem]" />}
          <col className="w-[9rem]" />
          <col className="w-[9.5rem]" />
          {!posMode && <col className="w-[8rem]" />}
          {documentType !== 'bill_of_supply' && <col className="w-[8rem]" />}
          <col className="w-[9rem]" />
          <col className="w-11" />
        </colgroup>
        <thead className="border-b border-gray-200 bg-gray-50 dark:border-slate-700 dark:bg-slate-800/90">
          <tr>
            <th className="px-3 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-text-secondary">#</th>
            <th className="px-3 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-text-secondary">
              Item Description
            </th>
            {!posMode && (
              <th className="px-2 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-text-secondary">
                HSN
              </th>
            )}
            <th className="px-2 py-2.5 text-right text-xs font-medium uppercase tracking-wide text-text-secondary">Qty</th>
            <th className="px-2 py-2.5 text-right text-xs font-medium uppercase tracking-wide text-text-secondary">Price</th>
            {!posMode && (
              <th className="px-2 py-2.5 text-right text-xs font-medium uppercase tracking-wide text-text-secondary">Disc</th>
            )}
            {documentType !== 'bill_of_supply' && (
              <th className="px-2 py-2.5 text-right text-xs font-medium uppercase tracking-wide text-text-secondary">Tax</th>
            )}
            <th className="px-3 py-2.5 text-right text-xs font-medium uppercase tracking-wide text-text-secondary">Total</th>
            <th className="px-2 py-2.5" aria-label="Actions" />
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200/70 dark:divide-slate-700/80">
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={6 + (posMode ? 0 : 2) + (documentType === 'bill_of_supply' ? 0 : 1)}
                className="px-4 py-10 text-center text-sm text-text-muted"
              >
                No items added yet. Start typing or scanning to add items.
              </td>
            </tr>
          ) : (
            rows.map((row, i) => (
            <tr key={i} className="transition-colors hover:bg-gray-50/80 dark:hover:bg-slate-800/40">
              <td className="px-3 py-2.5 align-middle text-left text-sm tabular-nums text-text-muted">{i + 1}</td>
              <td className="min-w-0 px-3 py-2.5 align-middle">
                {posMode ? (
                  // POS Mode: Read-only item name
                  <div className="truncate text-sm font-medium text-text-primary" title={row.name || undefined}>
                    {row.name || '—'}
                  </div>
                ) : (
                  // Invoice Mode: Editable item autocomplete
                  <div className="rounded-md border border-border bg-background px-1.5 py-0.5 dark:bg-slate-900/30">
                    <ItemAutocomplete 
                      value={row.name} 
                      onChange={val => onUpdateRow(i, 'name', val)} 
                      inputRef={itemInputRefs?.[i] || undefined}
                      warehouseId={warehouseId}
                      onSelect={item => {
                        onItemSelect(item, i);
                      }}
                      onSelectDone={() => {
                        // Optional: Add new row if current row is filled and user wants to scan another item
                      }}
                      onAddNew={onAddNewItem}
                      className="!min-h-0 !py-1.5 !px-2 !text-sm"
                    />
                  </div>
                )}
              </td>
              {!posMode && (
                <td className="px-2 py-2.5 align-middle">
                  <input 
                    value={row.hsnSac} 
                    onChange={e => onUpdateRow(i, 'hsnSac', e.target.value)} 
                    className={tableFieldBase} 
                    disabled={isFinal} 
                  />
                </td>
              )}
              <td className="px-2 py-2.5 align-middle">
                <input 
                  type="number" 
                  inputMode="numeric" 
                  value={row.quantity} 
                  onChange={e => onUpdateRow(i, 'quantity', Number(e.target.value))} 
                    className={`${tableFieldBase} text-right`}
                    disabled={isFinal}
                    data-row-index={i}
                    data-field="quantity"
                />
              </td>
              <td className="px-2 py-2.5 align-middle">
                <input 
                  type="number" 
                  inputMode="decimal" 
                  step="0.01"
                  value={Number(row.price).toFixed(2)} 
                  onChange={e => onUpdateRow(i, 'price', Number(e.target.value))} 
                  className={`${tableFieldBase} text-right`}
                  disabled={isFinal} 
                />
              </td>
              {!posMode && (
                <td className="px-2 py-2.5 align-middle text-right">
                  <input 
                    type="number" 
                    inputMode="decimal" 
                    value={row.discountPercent} 
                    onChange={e => onUpdateRow(i, 'discountPercent', Number(e.target.value))} 
                    className={`${tableFieldBase} text-right`} 
                    placeholder="%" 
                    disabled={isFinal} 
                  />
                  <div className="mt-0.5 whitespace-nowrap text-xs tabular-nums leading-none text-red-500 dark:text-red-400">
                    {row.discountAmount.toFixed(2)}
                  </div>
                </td>
              )}
              {documentType !== 'bill_of_supply' && (
                <td className="px-2 py-2.5 align-middle text-right">
                  {posMode ? (
                    // POS Mode: Read-only tax display
                    <div className="text-sm tabular-nums text-text-secondary">{row.taxPercent}%</div>
                  ) : (
                    // Invoice Mode: Editable tax
                    <>
                      <input 
                        type="number" 
                        inputMode="decimal" 
                        value={row.taxPercent} 
                        onChange={e => onUpdateRow(i, 'taxPercent', Number(e.target.value))} 
                        className={`${tableFieldBase} text-right`}
                        disabled={isFinal} 
                      />
                      <div className="mt-0.5 whitespace-nowrap text-xs tabular-nums leading-none text-red-500 dark:text-red-400">
                        {row.taxAmount.toFixed(2)}
                      </div>
                    </>
                  )}
                </td>
              )}
              <td className="px-3 py-2.5 align-middle text-right text-sm font-semibold tabular-nums text-text-primary whitespace-nowrap">
                {row.total.toFixed(2)}
              </td>
              <td className="px-2 py-2.5 align-middle text-center">
                {!isFinal && (
                  <button 
                    onClick={() => {
                      if (rows.length > 1) {
                        onRemoveRow(i);
                      }
                    }} 
                    className="text-text-muted hover:text-red-500 dark:hover:text-red-400"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </td>
            </tr>
          ))
          )}
         </tbody>
       </table>
       {!isFinal && !posMode && (
         <div className="border-t border-border bg-gray-50/90 px-3 py-2.5 dark:bg-slate-800/60">
           <button 
             onClick={onAddRow} 
             className="flex items-center gap-2 rounded px-2 py-1.5 text-sm font-medium text-primary-600 transition hover:bg-white/90 dark:text-sky-400 dark:hover:bg-slate-700/60"
           >
             <Plus className="w-4 h-4" /> Add Line
           </button>
         </div>
       )}
      </div>
       
     </div>
   );
 });

export default ItemsTable;

