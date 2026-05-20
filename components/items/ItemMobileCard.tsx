'use client';

import { ArrowUpDown, Tag } from 'lucide-react';
import { clsx } from 'clsx';
import type { Item } from '@/types/database';

function itemInitial(name: string) {
  const t = name?.trim();
  return t ? t[0].toUpperCase() : '?';
}

function formatMoney(value: number | null | undefined) {
  if (value === null || value === undefined) return '—';
  return `₹${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function formatStock(stock: number, unit: string) {
  const formatted = Number.isInteger(stock)
    ? String(stock)
    : stock.toLocaleString('en-IN', { maximumFractionDigits: 3 });
  return `${formatted} ${unit || 'PCS'}`;
}

type Props = {
  item: Item;
  onOpen: () => void;
  onAdjustStock: () => void;
};

export function ItemMobileCard({ item, onOpen, onAdjustStock }: Props) {
  const stock = Number(item.current_stock);
  const minStock = Number(item.min_stock);
  const isService = item.item_type === 'service';
  const isBundle = !!(item as Item & { is_bundle?: boolean }).is_bundle;
  const hasVariants = !!(item as { has_variants?: boolean }).has_variants;
  const showStockAction = !isService;

  let stockClass = 'text-green-700 dark:text-green-500';
  if (!isService) {
    if (stock <= 0) stockClass = 'text-red-600';
    else if (stock <= minStock) stockClass = 'text-amber-700 dark:text-amber-500';
  }

  const subtitle = [isBundle && 'Bundle', hasVariants && 'Variants', item.code && `Code ${item.code}`]
    .filter(Boolean)
    .join(' · ');

  return (
    <article className="relative rounded-lg border border-border bg-white px-2.5 py-2 shadow-sm dark:bg-surface">
      <div className={clsx('flex items-start gap-2', showStockAction && 'pr-9')}>
        {item.image_url ? (
          <img
            src={item.image_url}
            alt=""
            className="h-9 w-9 shrink-0 rounded-md border border-border object-cover"
          />
        ) : (
          <div
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-xs font-bold text-slate-600 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-300"
            aria-hidden
          >
            {isService ? <Tag className="h-4 w-4" strokeWidth={1.75} /> : itemInitial(item.name)}
          </div>
        )}

        <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left touch-manipulation">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="truncate text-sm font-semibold leading-tight text-gray-900 dark:text-slate-100">
                {item.name}
              </h3>
              {subtitle ? (
                <p className="mt-0.5 truncate text-[11px] text-text-muted">{subtitle}</p>
              ) : null}
            </div>
            <div className="shrink-0 text-right">
              {!isService && (
                <p className={clsx('text-xs font-semibold tabular-nums leading-tight', stockClass)}>
                  {formatStock(stock, item.unit)}
                </p>
              )}
            </div>
          </div>

          <div className="mt-1.5 grid grid-cols-3 gap-1">
            <div>
              <p className="text-[10px] text-text-muted">Sale</p>
              <p className="text-xs font-semibold tabular-nums text-gray-900 dark:text-slate-100">
                {formatMoney(item.selling_price)}
              </p>
            </div>
            <div>
              <p className="text-[10px] text-text-muted">Purchase</p>
              <p className="text-xs font-semibold tabular-nums text-gray-900 dark:text-slate-100">
                {formatMoney(item.purchase_price)}
              </p>
            </div>
            <div className="text-right">
              <p className="text-[10px] text-text-muted">{isService ? 'Type' : 'Tax'}</p>
              <p className="text-xs font-semibold text-gray-900 dark:text-slate-100">
                {isService ? 'Service' : `${item.tax_rate}%`}
              </p>
            </div>
          </div>
        </button>
      </div>

      {showStockAction ? (
        <div className="absolute bottom-1.5 right-1.5" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={onAdjustStock}
            className="rounded-md p-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-slate-800"
            aria-label={`Adjust stock for ${item.name}`}
            title="Adjust stock"
          >
            <ArrowUpDown className="h-4 w-4" />
          </button>
        </div>
      ) : null}
    </article>
  );
}
