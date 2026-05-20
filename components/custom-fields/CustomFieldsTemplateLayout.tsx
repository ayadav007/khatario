'use client';

import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import type { CustomFieldDefinition, CustomFieldLayout } from '@/types/custom-fields';
import { getLayoutFromSettings } from '@/lib/custom-fields';

interface CustomFieldsTemplateLayoutProps {
  settings: Record<string, unknown>;
  onChange: (settings: Record<string, unknown>) => void;
}

export function CustomFieldsTemplateLayout({
  settings,
  onChange,
}: CustomFieldsTemplateLayoutProps) {
  const { business, user } = useAuth();
  const [itemDefs, setItemDefs] = useState<CustomFieldDefinition[]>([]);
  const [invoiceDefs, setInvoiceDefs] = useState<CustomFieldDefinition[]>([]);
  const [loading, setLoading] = useState(true);

  const layout = getLayoutFromSettings(settings);

  useEffect(() => {
    if (!business?.id) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/custom-fields?business_id=${business.id}&user_id=${user?.id || ''}`
        );
        const data = await res.json();
        if (!cancelled && res.ok) {
          const all: CustomFieldDefinition[] = data.definitions || [];
          setItemDefs(all.filter((d) => d.entity_type === 'item'));
          setInvoiceDefs(all.filter((d) => d.entity_type === 'invoice'));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [business?.id, user?.id]);

  const updateLayout = (patch: Partial<CustomFieldLayout>) => {
    const next: CustomFieldLayout = {
      invoice_meta: layout.invoice_meta || [],
      item_table: layout.item_table || [],
      ...patch,
    };
    onChange({
      ...settings,
      custom_field_layout: next,
    });
  };

  const toggleKey = (list: 'invoice_meta' | 'item_table', key: string) => {
    const current = layout[list] || [];
    const next = current.includes(key)
      ? current.filter((k) => k !== key)
      : [...current, key];
    updateLayout({ [list]: next });
  };

  const moveKey = (list: 'invoice_meta' | 'item_table', key: string, dir: -1 | 1) => {
    const current = [...(layout[list] || [])];
    const idx = current.indexOf(key);
    if (idx < 0) return;
    const swap = idx + dir;
    if (swap < 0 || swap >= current.length) return;
    [current[idx], current[swap]] = [current[swap], current[idx]];
    updateLayout({ [list]: current });
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-2 text-sm text-text-muted">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading custom fields…
      </div>
    );
  }

  if (itemDefs.length === 0 && invoiceDefs.length === 0) {
    return (
      <p className="text-sm text-text-muted py-2">
        No custom fields defined. Add them under{' '}
        <a href="/settings/custom-fields" className="link-primary">
          Settings → Custom fields
        </a>
        .
      </p>
    );
  }

  const renderList = (
    title: string,
    hint: string,
    listKey: 'invoice_meta' | 'item_table',
    defs: CustomFieldDefinition[]
  ) => {
    if (defs.length === 0) return null;
    const active = layout[listKey] || [];
    return (
      <div className="space-y-2">
        <div>
          <p className="text-sm font-medium text-text-primary">{title}</p>
          <p className="text-xs text-text-muted">{hint}</p>
        </div>
        <ul className="space-y-1">
          {defs.map((def) => {
            const on = active.includes(def.field_key);
            const orderIdx = active.indexOf(def.field_key);
            return (
              <li
                key={def.id}
                className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5 bg-white text-sm"
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => toggleKey(listKey, def.field_key)}
                  className="rounded border-border"
                />
                <span className="flex-1 text-text-primary">{def.label}</span>
                {on && (
                  <span className="flex gap-1">
                    <button
                      type="button"
                      className="text-xs text-text-secondary hover:text-text-primary px-1"
                      disabled={orderIdx <= 0}
                      onClick={() => moveKey(listKey, def.field_key, -1)}
                      aria-label="Move up"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="text-xs text-text-secondary hover:text-text-primary px-1"
                      disabled={orderIdx >= active.length - 1}
                      onClick={() => moveKey(listKey, def.field_key, 1)}
                      aria-label="Move down"
                    >
                      ↓
                    </button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    );
  };

  return (
    <div className="space-y-4 pt-2 border-t border-border">
      <p className="text-sm font-medium text-text-primary">Custom fields on this template</p>
      {renderList(
        'Invoice details (below number, date, due date)',
        'Shown in the invoice metadata block on print/PDF.',
        'invoice_meta',
        invoiceDefs
      )}
      {renderList(
        'Item lines',
        'Shown under each item name on the bill.',
        'item_table',
        itemDefs
      )}
    </div>
  );
}
