'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, BadgePercent, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { AffixInput, SetupBlock, SetupGroup, setupSelectClass } from './StoreSetupLayout';

interface CouponRow {
  id: string;
  code: string;
  discount_type: string;
  discount_value: number;
  min_order_amount: number;
  is_active: boolean;
  used_count: number;
  usage_cap: number | null;
  expires_at: string | null;
  show_in_store: boolean;
}

/** Coupons save on their own (Add, Show in cart, delete); they are not part of the Store editor's Save. */
export function StoreCouponManager({ businessId }: { businessId: string }) {
  const [coupons, setCoupons] = useState<CouponRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [code, setCode] = useState('');
  const [value, setValue] = useState('10');
  const [type, setType] = useState<'percent' | 'flat'>('percent');
  const [minOrder, setMinOrder] = useState('0');
  const [showInStore, setShowInStore] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/settings/online-store/coupons?business_id=${businessId}`, {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        setCoupons(data.coupons ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    void load();
  }, [load]);

  const closeForm = () => {
    setFormOpen(false);
    setCode('');
    setError(null);
  };

  const add = async () => {
    if (code.trim().length < 3) {
      setError('Code must be at least 3 characters');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/settings/online-store/coupons', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: businessId,
          code,
          discount_type: type,
          discount_value: parseFloat(value) || 0,
          min_order_amount: parseFloat(minOrder) || 0,
          show_in_store: showInStore,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Could not save coupon');
        return;
      }
      closeForm();
      void load();
    } finally {
      setSaving(false);
    }
  };

  /** The save endpoint upserts every field, so the row is sent back whole with only the flag changed. */
  const toggleShow = async (c: CouponRow) => {
    setCoupons((rows) => rows.map((r) => (r.id === c.id ? { ...r, show_in_store: !c.show_in_store } : r)));
    await fetch('/api/settings/online-store/coupons', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        business_id: businessId,
        code: c.code,
        discount_type: c.discount_type,
        discount_value: c.discount_value,
        min_order_amount: c.min_order_amount,
        usage_cap: c.usage_cap,
        expires_at: c.expires_at,
        is_active: c.is_active,
        show_in_store: !c.show_in_store,
      }),
    });
    void load();
  };

  const remove = async (id: string) => {
    await fetch(`/api/settings/online-store/coupons?business_id=${businessId}&id=${id}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    void load();
  };

  const activeCount = coupons.filter((c) => c.is_active).length;

  return (
    <SetupGroup
      icon={BadgePercent}
      title="Coupons"
      testId="store-setup-coupons"
      meta={loading ? null : `${activeCount} active`}
      action={
        formOpen ? null : (
          <button
            type="button"
            onClick={() => setFormOpen(true)}
            className="ml-2 inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            <Plus className="h-3.5 w-3.5" />
            New coupon
          </button>
        )
      }
    >
      {formOpen ? (
        <SetupBlock muted>
          <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr_0.8fr_0.9fr]">
            <label className="block text-xs text-gray-500">
              Code
              <input
                autoFocus
                className="mt-1 h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm uppercase text-gray-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                placeholder="SAVE10"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </label>
            <label className="block text-xs text-gray-500">
              Discount type
              <select
                className={`mt-1 ${setupSelectClass}`}
                value={type}
                onChange={(e) => setType(e.target.value as 'percent' | 'flat')}
              >
                <option value="percent">Percent off</option>
                <option value="flat">₹ off</option>
              </select>
            </label>
            <div className="text-xs text-gray-500">
              Value
              <AffixInput
                className="mt-1"
                min={0}
                prefix={type === 'flat' ? '₹' : undefined}
                suffix={type === 'percent' ? '%' : undefined}
                value={value}
                onChange={setValue}
              />
            </div>
            <div className="text-xs text-gray-500">
              Min order
              <AffixInput className="mt-1" min={0} prefix="₹" value={minOrder} onChange={setMinOrder} />
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={showInStore} onChange={(e) => setShowInStore(e.target.checked)} />
              Show as an offer in the store cart
            </label>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={closeForm}>
                Cancel
              </Button>
              <Button type="button" onClick={() => void add()} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Add coupon'}
              </Button>
            </div>
          </div>
          {error ? <p className="mt-2 text-xs text-red-600">{error}</p> : null}
        </SetupBlock>
      ) : null}

      {loading ? (
        <SetupBlock>
          <div className="flex justify-center">
            <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
          </div>
        </SetupBlock>
      ) : coupons.length === 0 ? (
        <SetupBlock>
          <p className="text-center text-xs text-gray-500">
            Customers apply coupons at checkout. Ones marked &quot;Show in cart&quot; are listed as offers in the
            store cart.
          </p>
        </SetupBlock>
      ) : (
        coupons.map((c) => (
          <div key={c.id} className="flex items-center gap-3 px-5 py-3 text-sm">
            <span className="rounded-md border border-dashed border-gray-300 bg-gray-50 px-2 py-0.5 font-mono text-xs font-semibold text-gray-900">
              {c.code}
            </span>
            <p className="min-w-0 flex-1 truncate text-xs text-gray-500">
              {c.discount_type === 'flat' ? `₹${c.discount_value} off` : `${c.discount_value}% off`}
              {c.min_order_amount > 0 ? ` · min ₹${c.min_order_amount}` : ''}
              {c.used_count ? ` · used ${c.used_count}` : ''}
              {!c.is_active ? ' · off' : ''}
            </p>
            <label className="flex items-center gap-1.5 text-xs text-gray-500">
              <input type="checkbox" checked={!!c.show_in_store} onChange={() => void toggleShow(c)} />
              Show in cart
            </label>
            <button
              type="button"
              className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
              onClick={() => void remove(c.id)}
              aria-label={`Delete ${c.code}`}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))
      )}
    </SetupGroup>
  );
}
