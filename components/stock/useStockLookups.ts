'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';

export interface LookupItem {
  id: string;
  name: string;
  unit: string | null;
  code: string | null;
}

/** Goods items and godowns for the stock pages' pickers. */
export function useStockLookups() {
  const { business, user } = useAuth();
  const [items, setItems] = useState<LookupItem[]>([]);
  const [warehouses, setWarehouses] = useState<Array<{ id: string; name: string }>>([]);

  useEffect(() => {
    if (!business?.id) return;
    fetch(`/api/items?business_id=${business.id}&item_type=goods&limit=1000`)
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => setItems((d.items || []).map((i: any) => ({ id: i.id, name: i.name, unit: i.unit, code: i.code }))))
      .catch(() => setItems([]));
    fetch(`/api/warehouses?business_id=${business.id}&user_id=${user?.id}`)
      .then((r) => (r.ok ? r.json() : { warehouses: [] }))
      .then((d) => setWarehouses((d.warehouses || []).filter((w: any) => w.is_active !== false).map((w: any) => ({ id: w.id, name: w.name }))))
      .catch(() => setWarehouses([]));
  }, [business?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return { items, warehouses };
}
