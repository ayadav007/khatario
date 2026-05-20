'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { Loader2, X } from 'lucide-react';
import { clsx } from 'clsx';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useAuth } from '@/contexts/AuthContext';
import { useBranch } from '@/contexts/BranchContext';
import { useToastContext } from '@/contexts/ToastContext';
import type { Item } from '@/types/database';
import { getApiErrorMessage, safeJsonParse } from '@/lib/api-utils';

type Location = { id: string; name: string; location_code?: string };

type Props = {
  item: Item | null;
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
};

export function AdjustItemStockSheet({ item, open, onClose, onSuccess }: Props) {
  const { business, user } = useAuth();
  const { currentBranchId } = useBranch();
  const toast = useToastContext();

  const [direction, setDirection] = useState<'INCREASE' | 'DECREASE'>('INCREASE');
  const [quantity, setQuantity] = useState('');
  const [reasonCode, setReasonCode] = useState('STOCK_TAKE');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [warehousesEnabled, setWarehousesEnabled] = useState(false);
  const [locations, setLocations] = useState<Location[]>([]);
  const [locationId, setLocationId] = useState('');

  const currentStock = Number(item?.current_stock ?? 0);
  const unit = item?.unit || 'PCS';

  const quantityAfter = useMemo(() => {
    const q = parseFloat(quantity);
    if (!Number.isFinite(q) || q <= 0) return null;
    const delta = direction === 'INCREASE' ? q : -q;
    return currentStock + delta;
  }, [quantity, direction, currentStock]);

  useEffect(() => {
    if (!open) {
      setDirection('INCREASE');
      setQuantity('');
      setReasonCode('STOCK_TAKE');
      setNotes('');
      setLocationId('');
      return;
    }
    if (!business?.id) return;

    (async () => {
      try {
        const [whRes, locRes] = await Promise.all([
          fetch(`/api/settings/warehouses?business_id=${business.id}`, { credentials: 'include' }),
          fetch(`/api/locations?business_id=${business.id}`, { credentials: 'include' }),
        ]);
        if (whRes.ok) {
          const whData = await whRes.json();
          setWarehousesEnabled(!!whData.warehouses_enabled);
        }
        if (locRes.ok) {
          const locData = await locRes.json();
          const list: Location[] = locData.locations || [];
          setLocations(list);
          if (list.length === 1) setLocationId(list[0].id);
        }
      } catch {
        /* optional */
      }
    })();
  }, [open, business?.id]);

  if (!open || !item) return null;

  const handleSubmit = async () => {
    if (!business?.id || !user?.id) return;
    const q = parseFloat(quantity);
    if (!Number.isFinite(q) || q <= 0) {
      toast.error('Enter a quantity greater than zero');
      return;
    }
    if (quantityAfter !== null && quantityAfter < 0) {
      toast.error('Stock cannot go below zero');
      return;
    }
    if (warehousesEnabled && !locationId) {
      toast.error('Select a warehouse');
      return;
    }

    setLoading(true);
    try {
      const payload: Record<string, unknown> = {
        business_id: business.id,
        adjustment_type: 'QUANTITY',
        adjustment_date: format(new Date(), 'yyyy-MM-dd'),
        item_id: item.id,
        direction,
        quantity: q,
        reason_code: reasonCode,
        reason_notes: notes.trim() || undefined,
        created_by: user.id,
      };

      if (warehousesEnabled && locationId) {
        payload.location_id = locationId;
      } else if (currentBranchId && currentBranchId !== 'ALL') {
        payload.branch_id = currentBranchId;
      }

      const res = await fetch('/api/inventory-adjustments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });

      const data = await safeJsonParse(res);
      if (!res.ok) {
        toast.error(getApiErrorMessage(data, 'Failed to adjust stock'));
        return;
      }

      toast.success('Stock updated');
      window.dispatchEvent(new Event('inventory-updated'));
      onSuccess?.();
      onClose();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to adjust stock');
    } finally {
      setLoading(false);
    }
  };

  const body = (
    <>
      <div className="flex items-center justify-between border-b border-border px-4 py-3 shrink-0">
        <h2 className="text-base font-semibold text-text-primary">Adjust stock</h2>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full p-2 text-text-secondary hover:bg-gray-100 dark:hover:bg-slate-800"
          aria-label="Close"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 space-y-4">
        <div>
          <p className="text-sm font-medium text-text-primary truncate">{item.name}</p>
          <p className="mt-0.5 text-xs text-text-secondary">
            Current stock:{' '}
            <span className="font-semibold tabular-nums text-text-primary">
              {currentStock} {unit}
            </span>
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setDirection('INCREASE')}
            className={clsx(
              'rounded-lg border py-2.5 text-sm font-medium transition-colors',
              direction === 'INCREASE'
                ? 'border-green-300 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950/40 dark:text-green-300'
                : 'border-border bg-white text-text-secondary dark:bg-surface'
            )}
          >
            Add stock
          </button>
          <button
            type="button"
            onClick={() => setDirection('DECREASE')}
            className={clsx(
              'rounded-lg border py-2.5 text-sm font-medium transition-colors',
              direction === 'DECREASE'
                ? 'border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300'
                : 'border-border bg-white text-text-secondary dark:bg-surface'
            )}
          >
            Reduce stock
          </button>
        </div>

        <Input
          label={`Quantity (${unit})`}
          type="number"
          inputMode="decimal"
          min="0"
          step="any"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          placeholder="0"
          autoFocus
        />

        {quantityAfter !== null ? (
          <p className="text-xs text-text-secondary">
            New stock:{' '}
            <span
              className={clsx(
                'font-semibold tabular-nums',
                quantityAfter < 0 ? 'text-red-600' : 'text-text-primary'
              )}
            >
              {quantityAfter.toLocaleString('en-IN', { maximumFractionDigits: 3 })} {unit}
            </span>
          </p>
        ) : null}

        {warehousesEnabled && locations.length > 0 ? (
          <div>
            <label className="mb-1 block text-sm font-medium text-text-secondary">Warehouse</label>
            <select
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
              className="input w-full text-sm"
            >
              <option value="">Select warehouse</option>
              {locations.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {loc.name}
                  {loc.location_code ? ` (${loc.location_code})` : ''}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <div>
          <label className="mb-1 block text-sm font-medium text-text-secondary">Reason</label>
          <select
            value={reasonCode}
            onChange={(e) => setReasonCode(e.target.value)}
            className="input w-full text-sm"
          >
            <option value="STOCK_TAKE">Stock take</option>
            <option value="DAMAGE">Damage</option>
            <option value="THEFT">Theft / missing</option>
            <option value="EXPIRED">Expired</option>
            <option value="FREE_SAMPLE">Free sample</option>
          </select>
        </div>

        <Input
          label="Notes (optional)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Optional note"
        />
      </div>

      <div className="shrink-0 border-t border-border p-4">
        <Button className="w-full h-11 rounded-xl" onClick={handleSubmit} isLoading={loading}>
          Save adjustment
        </Button>
      </div>
    </>
  );

  return (
    <>
      <button
        type="button"
        className="fixed inset-0 z-[10070] bg-black/40"
        aria-label="Close"
        onClick={onClose}
      />
      <div className="fixed inset-x-0 bottom-0 z-[10071] flex max-h-[85vh] flex-col rounded-t-2xl border border-border bg-background shadow-[0_-8px_30px_rgba(0,0,0,0.15)] lg:hidden">
        {body}
      </div>
      <div className="fixed inset-0 z-[10071] hidden items-center justify-center p-4 lg:flex pointer-events-none">
        <div className="pointer-events-auto flex w-full max-w-md max-h-[85vh] flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-xl">
          {body}
        </div>
      </div>
    </>
  );
}
