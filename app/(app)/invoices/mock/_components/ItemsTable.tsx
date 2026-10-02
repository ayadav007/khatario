'use client';

import { useState } from 'react';
import { clsx } from 'clsx';
import { AlertTriangle, Barcode, Plus, Settings2, Trash2 } from 'lucide-react';
import { Kbd } from './Kbd';
import { calcLine, GST_RATES, inr, type LineItem } from '../_lib/mock-data';

type Props = {
  lines: LineItem[];
  onUpdate: (lineId: string, patch: Partial<LineItem>) => void;
  onRemove: (lineId: string) => void;
  onOpenPicker: (initialQuery: string) => void;
  onBarcode: (code: string) => void;
  addBarRef: React.RefObject<HTMLButtonElement>;
  barcodeRef: React.RefObject<HTMLInputElement>;
  isInterState: boolean;
  zeroRated: boolean;
};

const EDIT_COLS = ['qty', 'rate', 'discount'] as const;

const cellInput =
  'h-8 w-full rounded-md border border-transparent bg-transparent px-2 text-right text-sm tabular-nums text-slate-900 outline-none transition hover:border-slate-200 hover:bg-white focus:border-primary-500 focus:bg-white focus:ring-4 focus:ring-primary-100';

export function ItemsTable({
  lines,
  onUpdate,
  onRemove,
  onOpenPicker,
  onBarcode,
  addBarRef,
  barcodeRef,
  isInterState,
  zeroRated,
}: Props) {
  const focusCell = (row: number, col: number) => {
    const el = document.querySelector<HTMLInputElement>(`[data-cell="${row}-${col}"]`);
    if (el) {
      el.focus();
      el.select();
    } else {
      addBarRef.current?.focus();
    }
  };

  const onCellKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, row: number, col: number, lineId: string) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (col < EDIT_COLS.length - 1) focusCell(row, col + 1);
      else focusCell(row + 1, 0);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusCell(row + 1, col);
    } else if (e.key === 'ArrowUp' && row > 0) {
      e.preventDefault();
      focusCell(row - 1, col);
    } else if (e.key === 'Delete' && e.ctrlKey) {
      e.preventDefault();
      onRemove(lineId);
      requestAnimationFrame(() => focusCell(Math.max(0, row - 1), col));
    }
  };

  const sum = lines.reduce(
    (acc, l) => {
      const c = calcLine(l, zeroRated);
      acc.qty += l.qty;
      acc.discount += c.discount;
      acc.tax += c.tax;
      acc.amount += c.amount;
      return acc;
    },
    { qty: 0, discount: 0, tax: 0, amount: 0 }
  );

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[920px] text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/80 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              <th className="w-10 py-2.5 pl-4 pr-2">#</th>
              <th className="px-2 py-2.5">Item</th>
              <th className="w-20 px-2 py-2.5">HSN</th>
              <th className="w-28 px-2 py-2.5 text-right">Qty</th>
              <th className="w-32 px-2 py-2.5 text-right">Price / item</th>
              <th className="w-32 px-2 py-2.5 text-right">Discount</th>
              <th className="w-32 px-2 py-2.5 text-right">Tax</th>
              <th className="w-32 px-2 py-2.5 text-right">Amount</th>
              <th className="w-12 py-2.5 pl-2 pr-4 text-right">
                <button type="button" className="text-slate-400 hover:text-primary-700" aria-label="Column settings">
                  <Settings2 className="h-4 w-4" />
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, row) => {
              const c = calcLine(l, zeroRated);
              const noPrice = l.rate <= 0;
              const belowCost = !noPrice && l.purchasePrice > 0 && l.rate < l.purchasePrice;
              const shortStock = l.stock < 9999 && l.qty > l.stock;
              return (
                <tr key={l.lineId} className="group border-b border-slate-100 align-top transition hover:bg-slate-50/60">
                  <td className="py-2.5 pl-4 pr-2 text-xs font-semibold text-slate-400">{row + 1}</td>
                  <td className="px-2 py-2">
                    <p className="font-semibold text-slate-900">{l.name}</p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
                      <span className="font-mono text-slate-400">{l.code}</span>
                      {shortStock && (
                        <span className="font-semibold text-rose-600">
                          Only {Math.max(0, l.stock)} {l.unit} in stock
                        </span>
                      )}
                      {noPrice && (
                        <span className="inline-flex items-center gap-1 font-semibold text-amber-600">
                          <AlertTriangle className="h-3 w-3" /> No sale price set
                        </span>
                      )}
                      {belowCost && (
                        <span className="inline-flex items-center gap-1 font-semibold text-rose-600">
                          <AlertTriangle className="h-3 w-3" /> Below cost ({inr(l.purchasePrice, 0)})
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-2 py-2.5 font-mono text-xs text-slate-500">{l.hsn}</td>
                  <td className="px-2 py-2">
                    <div className="flex items-center justify-end gap-1">
                      <input
                        data-cell={`${row}-0`}
                        value={l.qty}
                        inputMode="decimal"
                        onChange={(e) => onUpdate(l.lineId, { qty: Math.max(0, Number(e.target.value) || 0) })}
                        onKeyDown={(e) => onCellKeyDown(e, row, 0, l.lineId)}
                        className={clsx(cellInput, 'w-16 font-semibold')}
                      />
                      <span className="w-9 text-[11px] font-medium text-slate-400">{l.unit}</span>
                    </div>
                  </td>
                  <td className="px-2 py-2">
                    <input
                      data-cell={`${row}-1`}
                      value={l.rate}
                      inputMode="decimal"
                      onChange={(e) => onUpdate(l.lineId, { rate: Math.max(0, Number(e.target.value) || 0) })}
                      onKeyDown={(e) => onCellKeyDown(e, row, 1, l.lineId)}
                      className={clsx(cellInput, noPrice && 'bg-amber-50 ring-1 ring-amber-200')}
                    />
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex items-center justify-end gap-1">
                      <input
                        data-cell={`${row}-2`}
                        value={l.discount}
                        inputMode="decimal"
                        onChange={(e) => onUpdate(l.lineId, { discount: Math.max(0, Number(e.target.value) || 0) })}
                        onKeyDown={(e) => onCellKeyDown(e, row, 2, l.lineId)}
                        className={clsx(cellInput, 'w-16')}
                      />
                      <button
                        type="button"
                        tabIndex={-1}
                        onClick={() => onUpdate(l.lineId, { discountType: l.discountType === 'pct' ? 'amt' : 'pct' })}
                        className="h-6 w-7 rounded-md bg-slate-100 text-[11px] font-bold text-slate-600 hover:bg-primary-100 hover:text-primary-700"
                        title="Switch between % and ₹"
                      >
                        {l.discountType === 'pct' ? '%' : '₹'}
                      </button>
                    </div>
                    {c.discount > 0 && (
                      <p className="mt-0.5 pr-8 text-right text-[11px] text-emerald-600">−{inr(c.discount)}</p>
                    )}
                  </td>
                  <td className="px-2 py-2 text-right">
                    {zeroRated ? (
                      <div className="py-1.5 pr-1" title={`Item rate ${l.gstPct}%, zero-rated under LUT`}>
                        <p className="text-sm font-medium text-slate-700">IGST 0%</p>
                        <p className="text-[11px] text-amber-600">LUT · item {l.gstPct}%</p>
                      </div>
                    ) : (
                      <>
                        <select
                          tabIndex={-1}
                          value={l.gstPct}
                          onChange={(e) => onUpdate(l.lineId, { gstPct: Number(e.target.value) })}
                          className="h-8 rounded-md border border-transparent bg-transparent px-1 text-right text-sm font-medium text-slate-700 outline-none hover:border-slate-200 focus:border-primary-500"
                        >
                          {GST_RATES.map((r) => (
                            <option key={r} value={r}>
                              {isInterState ? 'IGST' : 'GST'} {r}%
                            </option>
                          ))}
                        </select>
                        <p className="pr-1 text-[11px] text-slate-400">{inr(c.tax)}</p>
                      </>
                    )}
                  </td>
                  <td className="px-2 py-2.5 text-right font-semibold tabular-nums text-slate-900">{inr(c.amount)}</td>
                  <td className="py-2 pl-2 pr-4 text-right">
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => onRemove(l.lineId)}
                      className="rounded-md p-1.5 text-slate-300 transition hover:bg-rose-50 hover:text-rose-600 group-hover:text-slate-400"
                      aria-label={`Remove ${l.name}`}
                      title="Remove (Ctrl + Delete)"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tbody>
            <tr>
              <td colSpan={9} className="p-3">
                <AddItemsBar
                  addBarRef={addBarRef}
                  barcodeRef={barcodeRef}
                  onOpenPicker={onOpenPicker}
                  onBarcode={onBarcode}
                />
              </td>
            </tr>
          </tbody>
          {lines.length > 0 && (
            <tfoot>
              <tr className="border-y border-slate-200 bg-slate-50/80 text-sm font-semibold tabular-nums text-slate-700">
                <td colSpan={3} className="py-2.5 pl-4 pr-2 text-right text-[11px] uppercase tracking-wider text-slate-500">
                  Subtotal · {lines.length} {lines.length === 1 ? 'item' : 'items'}
                </td>
                <td className="px-2 py-2.5 pr-11 text-right">{sum.qty}</td>
                <td />
                <td className="px-2 py-2.5 text-right text-emerald-600">
                  {sum.discount ? `−${inr(sum.discount)}` : '—'}
                </td>
                <td className="px-2 py-2.5 text-right">{inr(sum.tax)}</td>
                <td className="px-2 py-2.5 text-right text-slate-900">{inr(sum.amount)}</td>
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
}: Pick<Props, 'addBarRef' | 'barcodeRef' | 'onOpenPicker' | 'onBarcode'>) {
  const [barcode, setBarcode] = useState('');

  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <button
        ref={addBarRef}
        type="button"
        onClick={() => onOpenPicker('')}
        onKeyDown={(e) => {
          if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && e.key !== ' ') {
            e.preventDefault();
            onOpenPicker(e.key);
          }
        }}
        className="group flex h-12 min-w-0 flex-1 items-center gap-3 rounded-xl border-2 border-primary-200 bg-primary-50 px-3 text-left transition hover:border-primary-400 hover:bg-primary-100/70 focus:border-primary-500 focus:outline-none focus:ring-4 focus:ring-primary-100"
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary-600 text-white shadow-sm shadow-primary-600/30 transition group-hover:scale-105">
          <Plus className="h-4 w-4" strokeWidth={2.5} />
        </span>
        <span className="shrink-0 text-sm font-bold text-primary-700">Add items</span>
        <span className="hidden truncate text-sm text-primary-700/60 md:inline">
          Search by name, code or HSN, or just start typing
        </span>
        <Kbd className="ml-auto border-primary-200 text-primary-700">F3</Kbd>
      </button>

      <div className="flex h-12 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 transition focus-within:border-primary-500 focus-within:ring-4 focus-within:ring-primary-100 sm:w-72">
        <Barcode className="h-5 w-5 shrink-0 text-slate-500" />
        <input
          ref={barcodeRef}
          value={barcode}
          onChange={(e) => setBarcode(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && barcode.trim()) {
              e.preventDefault();
              onBarcode(barcode.trim());
              setBarcode('');
            }
          }}
          placeholder="Scan barcode or item code"
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400"
        />
        <Kbd>F4</Kbd>
      </div>
    </div>
  );
}
