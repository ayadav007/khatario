'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PageHeader } from '@/components/layout/PageHeader';
import { useToastContext } from '@/contexts/ToastContext';

type ExpenseItem = {
  id: string;
  name: string;
  item_type: 'goods' | 'service';
  unit: string | null;
  hsn_sac: string | null;
  tax_rate: number;
  is_active: boolean;
};

export default function ExpenseItemsPage() {
  const router = useRouter();
  const toast = useToastContext();
  const [items, setItems] = useState<ExpenseItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  function load() {
    void fetch('/api/expense-items?include_inactive=1')
      .then((res) => res.json())
      .then((data) => setItems(data.items || []))
      .catch(() => setError('Could not load expense items'));
  }

  useEffect(() => {
    load();
  }, []);

  async function setActive(item: ExpenseItem, isActive: boolean) {
    const res = await fetch(`/api/expense-items/${item.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: isActive }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setError(data?.error || 'Could not update the item');
      return;
    }
    toast.success(isActive ? 'Item restored' : 'Item hidden');
    load();
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Expense items"
        subtitle="Goods and services you buy for the business. These are not the items you sell."
        actions={
          <button type="button" onClick={() => router.push('/expenses/new')} className="rounded-lg bg-primary-600 px-4 py-2 text-sm text-white">
            New expense
          </button>
        }
      />
      {error && <p className="text-sm text-red-700">{error}</p>}
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-600">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Unit</th>
              <th className="px-4 py-3">HSN / SAC</th>
              <th className="px-4 py-3">GST %</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className="border-t border-gray-100">
                <td className="px-4 py-3">{item.name}{item.is_active ? '' : ' (hidden)'}</td>
                <td className="px-4 py-3 capitalize">{item.item_type}</td>
                <td className="px-4 py-3">{item.unit}</td>
                <td className="px-4 py-3">{item.hsn_sac || '—'}</td>
                <td className="px-4 py-3">{item.tax_rate}</td>
                <td className="px-4 py-3 text-right">
                  <button type="button" className="text-primary-600 hover:underline" onClick={() => void setActive(item, !item.is_active)}>
                    {item.is_active ? 'Hide' : 'Restore'}
                  </button>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                  No expense items yet. Add one while entering an expense.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
