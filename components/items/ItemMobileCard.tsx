'use client';

import { ArrowUpDown, Tag } from 'lucide-react';
import { clsx } from 'clsx';
import { ItemFlagSwitch } from '@/components/items/ItemFlagSwitch';
import { MobileListRow } from '@/components/layout/MobileList';
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
  onToggleStore?: () => void;
  onToggleFeatured?: () => void;
  flagsBusy?: boolean;
};

export function ItemMobileCard({
  item,
  onOpen,
  onAdjustStock,
  onToggleStore,
  onToggleFeatured,
  flagsBusy,
}: Props) {
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

  const leading = item.image_url ? (
    <img src={item.image_url} alt="" className="h-8 w-8 shrink-0 rounded-md object-cover" />
  ) : (
    <span
      className="flex h-8 w-8 shrink-0 items-center justify-center text-xs font-semibold text-primary-700"
      aria-hidden
    >
      {isService ? <Tag className="h-4 w-4" strokeWidth={1.75} /> : itemInitial(item.name)}
    </span>
  );

  return (
    <article>
      <MobileListRow
        label={item.name}
        hint={subtitle || (isService ? 'Service' : undefined)}
        leading={leading}
        onClick={onOpen}
        trailing={
          <span className="text-right">
            <span className="block text-sm font-semibold tabular-nums text-text-primary">
              {formatMoney(item.selling_price)}
            </span>
            {!isService ? (
              <span className={clsx('block text-xs tabular-nums', stockClass)}>
                {formatStock(stock, item.unit)}
              </span>
            ) : null}
          </span>
        }
        actions={
          showStockAction ? (
            <button
              type="button"
              onClick={onAdjustStock}
              className="inline-flex h-9 w-9 items-center justify-center text-text-secondary active:bg-slate-100"
              aria-label={`Adjust stock for ${item.name}`}
            >
              <ArrowUpDown className="h-4 w-4" />
            </button>
          ) : null
        }
      />
      {onToggleStore || onToggleFeatured ? (
        <div className="flex items-center gap-4 px-4 pb-3">
          {onToggleStore ? (
            <label className="flex items-center gap-2 text-xs text-text-secondary">
              <ItemFlagSwitch
                on={!!item.show_in_store}
                label="Show in online store"
                disabled={flagsBusy}
                onToggle={onToggleStore}
              />
              Store
            </label>
          ) : null}
          {onToggleFeatured ? (
            <label className="flex items-center gap-2 text-xs text-text-secondary">
              <ItemFlagSwitch
                on={!!item.featured_in_store}
                label="Featured in online store"
                disabled={flagsBusy}
                onToggle={onToggleFeatured}
              />
              Featured
            </label>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
