'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';

interface CouponRow {
  id: string;
  code: string;
  discount_type: string;
  discount_value: number;
  min_order_amount: number;
  is_active: boolean;
  used_count: number;
}

export function StoreCouponManager({ businessId }: { businessId: string }) {
  const [coupons, setCoupons] = useState<CouponRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [code, setCode] = useState('');
  const [value, setValue] = useState('10');
  const [type, setType] = useState<'percent' | 'flat'>('percent');
  const [minOrder, setMinOrder] = useState('0');
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
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Could not save coupon');
        return;
      }
      setCode('');
      void load();
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    await fetch(`/api/settings/online-store/coupons?business_id=${businessId}&id=${id}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    void load();
  };

  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-900">Coupons</h3>
      <p className="mt-1 text-xs text-gray-500">Customers can apply these at checkout.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <input
          className="w-28 rounded-lg border px-3 py-2 text-sm uppercase"
          placeholder="SAVE10"
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
        <select
          className="rounded-lg border px-2 py-2 text-sm"
          value={type}
          onChange={(e) => setType(e.target.value as 'percent' | 'flat')}
        >
          <option value="percent">Percent</option>
          <option value="flat">₹ off</option>
        </select>
        <input
          className="w-20 rounded-lg border px-3 py-2 text-sm"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <input
          className="w-24 rounded-lg border px-3 py-2 text-sm"
          placeholder="Min ₹"
          value={minOrder}
          onChange={(e) => setMinOrder(e.target.value)}
        />
        <Button type="button" onClick={() => void add()} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Add'}
        </Button>
      </div>
      {error ? <p className="mt-2 text-xs text-red-600">{error}</p> : null}

      {loading ? (
        <div className="mt-4 flex justify-center">
          <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
        </div>
      ) : coupons.length === 0 ? (
        <p className="mt-4 text-xs text-gray-400">No coupons yet.</p>
      ) : (
        <ul className="mt-4 divide-y divide-gray-100 rounded-lg border border-gray-100">
          {coupons.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
              <div>
                <p className="font-medium text-gray-900">{c.code}</p>
                <p className="text-xs text-gray-500">
                  {c.discount_type === 'flat' ? `₹${c.discount_value} off` : `${c.discount_value}% off`}
                  {c.min_order_amount > 0 ? ` · min ₹${c.min_order_amount}` : ''}
                  {c.used_count ? ` · used ${c.used_count}` : ''}
                </p>
              </div>
              <button
                type="button"
                className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
                onClick={() => void remove(c.id)}
                aria-label={`Delete ${c.code}`}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
