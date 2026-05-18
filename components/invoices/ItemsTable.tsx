'use client';

import React from 'react';
import { Button } from '@/components/ui/Button';
import { ItemAutocomplete } from '@/components/ui/ItemAutocomplete';
import { Plus, Trash2 } from 'lucide-react';

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

  /** Table (default) or stacked cards for mobile invoice composer */
  layout?: 'table' | 'cards';
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
}: ItemsTableProps) {
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

