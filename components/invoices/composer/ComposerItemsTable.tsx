'use client';

import { useState } from 'react';
import { clsx } from 'clsx';
import { AlertTriangle, Barcode, Plus, Trash2 } from 'lucide-react';
import type { ComposerRow } from './types';
import { GST_RATES, inr, Kbd, NumberInput, Switch } from './ui';

type Props = {
  rows: ComposerRow[];
  patchRow: (index: number, patch: Partial<ComposerRow>, skipDiscountRecalc?: boolean) => void;
  removeRow: (index: number) => void;
  onOpenPicker: (initialQuery: string) => void;
  onBarcode: (code: string) => void;
  onBarcodeFocusChange: (focused: boolean) => void;
  addBarRef: React.RefObject<HTMLButtonElement>;
  barcodeRef: React.RefObject<HTMLInputElement>;
  documentType: string;
  isExport: boolean;
  exportType: 'wp' | 'wop';
  isIntraState: boolean;
  pricesIncludeGst: boolean;
  setPricesIncludeGst: (v: boolean) => void;
  readOnly: boolean;
};

const EDIT_COLS = 3;

const cellInput =
  'h-8 w-full rounded-md border border-transparent bg-transparent px-2 text-right text-sm tabular-nums text-text-primary outline-none transition hover:border-border hover:bg-surface focus:border-primary-500 focus:bg-surface focus:ring-4 focus:ring-primary-100 disabled:cursor-default disabled:hover:border-transparent disabled:hover:bg-transparent dark:focus:ring-primary-900/40';

export function ItemsTable({
  rows,
  patchRow,
  removeRow,
  onOpenPicker,
  onBarcode,
  onBarcodeFocusChange,
  addBarRef,
  barcodeRef,
  documentType,
  isExport,
  exportType,
  isIntraState,
  pricesIncludeGst,
  setPricesIncludeGst,
  readOnly,
}: Props) {
  const [amountMode, setAmountMode] = useState<Record<number, boolean>>({});
  const showTax = documentType !== 'bill_of_supply';
  const zeroRated = isExport && exportType === 'wop';
  const visible = rows.map((row, index) => ({ row, index })).filter(({ row }) => row.itemId || row.name);
  const colCount = showTax ? 9 : 8;

  const focusCell = (pos: number, col: number) => {
    const el = document.querySelector<HTMLInputElement>(`[data-composer-cell="${pos}-${col}"]`);
    if (el) {
      el.focus();
      el.select();
    } else {
      addBarRef.current?.focus();
    }
  };

  const onCellKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, pos: number, col: number, index: number) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (col < EDIT_COLS - 1) focusCell(pos, col + 1);
      else focusCell(pos + 1, 0);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusCell(pos + 1, col);
    } else if (e.key === 'ArrowUp' && pos > 0) {
      e.preventDefault();
      focusCell(pos - 1, col);
    } else if (e.key === 'Delete' && e.ctrlKey) {
      e.preventDefault();
      removeRow(index);
      requestAnimationFrame(() => focusCell(Math.max(0, pos - 1), col));
    }
  };

  const sum = visible.reduce(
    (acc, { row }) => {
      acc.qty += Number(row.quantity) || 0;
      acc.discount += Number(row.discountAmount) || 0;
      acc.tax += Number(row.taxAmount) || 0;
      acc.amount += Number(row.total) || 0;
      return acc;
    },
    { qty: 0, discount: 0, tax: 0, amount: 0 }
  );

  return (
    <div>
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2">
        <p className="text-xs font-semibold text-text-secondary">
          Items{visible.length > 0 ? ` · ${visible.length}` : ''}
        </p>
        {showTax && (
          <label className="flex items-center gap-2 text-xs font-medium text-text-secondary">
            Prices include GST
            <Switch
              checked={pricesIncludeGst}
              onChange={setPricesIncludeGst}
              disabled={readOnly}
              label="Prices include GST"
            />
          </label>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[880px] text-sm">
          <thead>
            <tr className="border-b border-border bg-slate-50/80 text-left text-[11px] font-semibold uppercase tracking-wider text-text-secondary dark:bg-slate-800/50">
              <th className="w-10 py-2.5 pl-4 pr-2">#</th>
              <th className="px-2 py-2.5">Item</th>
              <th className="w-24 px-2 py-2.5">HSN / SAC</th>
              <th className="w-28 px-2 py-2.5 text-right">Qty</th>
              <th className="w-32 px-2 py-2.5 text-right">{pricesIncludeGst ? 'Price (incl. GST)' : 'Price / item'}</th>
              <th className="w-32 px-2 py-2.5 text-right">Discount</th>
              {showTax && <th className="w-32 px-2 py-2.5 text-right">Tax</th>}
              <th className="w-32 px-2 py-2.5 text-right">Amount</th>
              <th className="w-12 py-2.5 pl-2 pr-4" aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {visible.map(({ row, index }, pos) => {
              const noPrice = !(Number(row.price) > 0);
              const byAmount = amountMode[index] ?? (row.discountAmount > 0 && !row.discountPercent);
              const rateOptions = GST_RATES.includes(row.taxPercent) ? GST_RATES : [...GST_RATES, row.taxPercent].sort((a, b) => a - b);
              return (
                <tr
                  key={`${row.itemId}:${row.variantId ?? ''}:${index}`}
                  className="group border-b border-border/70 align-top transition hover:bg-slate-50/60 dark:hover:bg-slate-800/30"
                >
                  <td className="py-2.5 pl-4 pr-2 text-xs font-semibold text-text-muted">{pos + 1}</td>
                  <td className="px-2 py-2">
                    <p className="font-semibold text-text-primary">{row.name || '—'}</p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
                      {row.code && <span className="font-mono text-text-muted">{row.code}</span>}
                      {row.freeQty > 0 && <span className="text-emerald-600">+{row.freeQty} free</span>}
                      {noPrice && (
                        <span className="inline-flex items-center gap-1 font-semibold text-amber-600">
                          <AlertTriangle className="h-3 w-3" /> No price set
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-2 py-2">
                    <input
                      value={row.hsnSac || ''}
                      onChange={(e) => patchRow(index, { hsnSac: e.target.value })}
                      disabled={readOnly}
                      tabIndex={-1}
                      placeholder="—"
                      className={clsx(cellInput, 'text-left font-mono text-xs text-text-secondary')}
                    />
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex items-center justify-end gap-1">
                      <NumberInput
                        data-composer-cell={`${pos}-0`}
                        value={row.quantity}
                        onValue={(n) => patchRow(index, { quantity: n })}
                        onKeyDown={(e) => onCellKeyDown(e, pos, 0, index)}
                        disabled={readOnly}
                        className={clsx(cellInput, 'w-16 font-semibold')}
                      />
                      <span className="w-10 truncate text-[11px] font-medium text-text-muted" title={row.unit}>
                        {row.unit}
                      </span>
                    </div>
                  </td>
                  <td className="px-2 py-2">
                    <NumberInput
                      data-composer-cell={`${pos}-1`}
                      value={row.price}
                      onValue={(n) => patchRow(index, { price: n, priceUserOverride: true })}
                      onKeyDown={(e) => onCellKeyDown(e, pos, 1, index)}
                      disabled={readOnly}
                      className={clsx(cellInput, noPrice && 'bg-amber-50 ring-1 ring-amber-200 dark:bg-amber-950/30')}
                    />
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex items-center justify-end gap-1">
                      <NumberInput
                        data-composer-cell={`${pos}-2`}
                        value={byAmount ? row.discountAmount : row.discountPercent}
                        onValue={(n) =>
                          byAmount
                            ? patchRow(index, { discountAmount: n }, true)
                            : patchRow(index, { discountPercent: Math.min(100, n) })
                        }
                        onKeyDown={(e) => onCellKeyDown(e, pos, 2, index)}
                        disabled={readOnly}
                        className={clsx(cellInput, 'w-16')}
                      />
                      <button
                        type="button"
                        tabIndex={-1}
                        disabled={readOnly}
                        onClick={() => setAmountMode((m) => ({ ...m, [index]: !byAmount }))}
                        className="h-6 w-7 rounded-md bg-slate-100 text-[11px] font-bold text-slate-600 hover:bg-primary-100 hover:text-primary-700 disabled:cursor-default dark:bg-slate-800 dark:text-slate-300"
                        title="Switch between % and ₹"
                      >
                        {byAmount ? '₹' : '%'}
                      </button>
                    </div>
                    {row.discountAmount > 0 && (
                      <p className="mt-0.5 pr-8 text-right text-[11px] text-emerald-600">
                        {byAmount ? `${Math.round(row.discountPercent * 100) / 100}%` : `−${inr(row.discountAmount)}`}
                      </p>
                    )}
                  </td>
                  {showTax && (
                    <td className="px-2 py-2 text-right">
                      {zeroRated ? (
                        <div className="py-1.5 pr-1" title={`Item rate ${row.taxPercent}%, zero-rated under LUT`}>
                          <p className="text-sm font-medium text-text-primary">IGST 0%</p>
                          <p className="text-[11px] text-amber-600">LUT · item {row.taxPercent}%</p>
                        </div>
                      ) : (
                        <>
                          <select
                            tabIndex={-1}
                            value={row.taxPercent}
                            disabled={readOnly}
                            onChange={(e) => patchRow(index, { taxPercent: Number(e.target.value) })}
                            className="h-8 rounded-md border border-transparent bg-transparent px-1 text-right text-sm font-medium text-text-primary outline-none hover:border-border focus:border-primary-500 disabled:opacity-100"
                          >
                            {rateOptions.map((r) => (
                              <option key={r} value={r}>
                                {isExport || !isIntraState ? 'IGST' : 'GST'} {r}%
                              </option>
                            ))}
                          </select>
                          <p className="pr-1 text-[11px] text-text-muted">{inr(row.taxAmount)}</p>
                        </>
                      )}
                    </td>
                  )}
                  <td className="px-2 py-2.5 text-right font-semibold tabular-nums text-text-primary">{inr(row.total)}</td>
                  <td className="py-2 pl-2 pr-4 text-right">
                    {!readOnly && (
                      <button
                        type="button"
                        tabIndex={-1}
                        onClick={() => removeRow(index)}
                        className="rounded-md p-1.5 text-slate-300 transition hover:bg-rose-50 hover:text-rose-600 group-hover:text-slate-400 dark:text-slate-600"
                        aria-label={`Remove ${row.name}`}
                        title="Remove (Ctrl + Delete)"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {visible.length === 0 && readOnly && (
              <tr>
                <td colSpan={colCount} className="px-4 py-8 text-center text-sm text-text-muted">
                  No items on this document.
                </td>
              </tr>
            )}
          </tbody>
          {!readOnly && (
            <tbody>
              <tr>
                <td colSpan={colCount} className="p-3">
                  <AddItemsBar
                    addBarRef={addBarRef}
                    barcodeRef={barcodeRef}
                    onOpenPicker={onOpenPicker}
                    onBarcode={onBarcode}
                    onBarcodeFocusChange={onBarcodeFocusChange}
                    onArrowUp={() => visible.length > 0 && focusCell(visible.length - 1, 0)}
                    empty={visible.length === 0}
                  />
                </td>
              </tr>
            </tbody>
          )}
          {visible.length > 0 && (
            <tfoot>
              <tr className="border-y border-border bg-slate-50/80 text-sm font-semibold tabular-nums text-text-secondary dark:bg-slate-800/50">
                <td colSpan={3} className="py-2.5 pl-4 pr-2 text-right text-[11px] uppercase tracking-wider text-text-muted">
                  Subtotal · {visible.length} {visible.length === 1 ? 'item' : 'items'}
                </td>
                <td className="px-2 py-2.5 pr-[3.25rem] text-right">{Math.round(sum.qty * 1000) / 1000}</td>
                <td />
                <td className="px-2 py-2.5 text-right text-emerald-600">{sum.discount ? `−${inr(sum.discount)}` : '—'}</td>
                {showTax && <td className="px-2 py-2.5 text-right">{inr(sum.tax)}</td>}
                <td className="px-2 py-2.5 text-right text-text-primary">{inr(sum.amount)}</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

function AddItemsBar({
  addBarRef,
  barcodeRef,
  onOpenPicker,
  onBarcode,
  onBarcodeFocusChange,
  onArrowUp,
  empty,
}: Pick<Props, 'addBarRef' | 'barcodeRef' | 'onOpenPicker' | 'onBarcode' | 'onBarcodeFocusChange'> & {
  onArrowUp: () => void;
  empty: boolean;
}) {
  const [barcode, setBarcode] = useState('');

  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <button
        ref={addBarRef}
        type="button"
        onClick={() => onOpenPicker('')}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp') {
            e.preventDefault();
            onArrowUp();
          } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && e.key !== ' ') {
            e.preventDefault();
            onOpenPicker(e.key);
          }
        }}
        className={clsx(
          'group flex min-w-0 flex-1 items-center gap-3 rounded-xl border-2 border-primary-200 bg-primary-50 px-3 text-left transition hover:border-primary-400 hover:bg-primary-100/70 focus:border-primary-500 focus:outline-none focus:ring-4 focus:ring-primary-100 dark:border-primary-800 dark:bg-primary-900/20 dark:hover:bg-primary-900/30',
          empty ? 'h-14' : 'h-12'
        )}
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary-600 text-white shadow-sm shadow-primary-600/30 transition group-hover:scale-105">
          <Plus className="h-4 w-4" strokeWidth={2.5} />
        </span>
        <span className="shrink-0 text-sm font-bold text-primary-700 dark:text-primary-300">Add items</span>
        <span className="hidden truncate text-sm text-primary-700/60 dark:text-primary-300/60 md:inline">
          Search by name, code or barcode, or just start typing
        </span>
        <Kbd className="ml-auto border-primary-200 text-primary-700">F3</Kbd>
      </button>

      <div className="flex h-12 items-center gap-2 self-end rounded-xl border border-border bg-surface px-3 transition focus-within:border-primary-500 focus-within:ring-4 focus-within:ring-primary-100 sm:w-72 sm:self-auto">
        <Barcode className="h-5 w-5 shrink-0 text-text-secondary" />
        <input
          ref={barcodeRef}
          value={barcode}
          onChange={(e) => setBarcode(e.target.value)}
          onFocus={() => onBarcodeFocusChange(true)}
          onBlur={() => onBarcodeFocusChange(false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && barcode.trim()) {
              e.preventDefault();
              onBarcode(barcode.trim());
              setBarcode('');
            }
          }}
          placeholder="Scan barcode or item code"
          className="min-w-0 flex-1 bg-transparent text-sm text-text-primary outline-none placeholder:text-text-muted"
        />
        <Kbd>F4</Kbd>
      </div>
    </div>
  );
}
