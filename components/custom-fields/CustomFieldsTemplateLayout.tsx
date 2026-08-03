'use client';

import React, { useEffect, useState } from 'react';
import { Check, Loader2, Plus } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import type { CustomFieldDefinition, CustomFieldLayout } from '@/types/custom-fields';
import { getLayoutFromSettings } from '@/lib/custom-fields';

/**
 * Common fields users expect on invoices. "builtin" entries flip an existing
 * show_* template toggle; "custom" entries quick-create a custom field
 * definition and tick it into the invoice details block.
 */
const SUGGESTED_FIELDS: (
  | { label: string; builtin: string }
  | { label: string; fieldKey: string }
)[] = [
  { label: 'PO Number', builtin: 'show_po_number' },
  { label: 'e-Way Bill No', builtin: 'show_eway_bill_number' },
  { label: 'Reference No', builtin: 'show_reference_number' },
  { label: 'Delivery Note', builtin: 'show_delivery_note' },
  { label: 'Sales Person', fieldKey: 'sales_person' },
  { label: 'Vehicle No', fieldKey: 'vehicle_no' },
  { label: 'LR No', fieldKey: 'lr_no' },
  { label: 'Driver Name', fieldKey: 'driver_name' },
];

interface CustomFieldsTemplateLayoutProps {
  settings: Record<string, unknown>;
  onChange: (settings: Record<string, unknown>) => void;
  /**
   * Whether the document type can store invoice-level custom field values
   * (only documents stored in the invoices table can). When false, the
   * "Invoice details" section is hidden so users can't tick fields that
   * would never print.
   */
  supportsInvoiceFields?: boolean;
}

export function CustomFieldsTemplateLayout({
  settings,
  onChange,
  supportsInvoiceFields = true,
}: CustomFieldsTemplateLayoutProps) {
  const { business, user } = useAuth();
  const [itemDefs, setItemDefs] = useState<CustomFieldDefinition[]>([]);
  const [invoiceDefs, setInvoiceDefs] = useState<CustomFieldDefinition[]>([]);
  const [loading, setLoading] = useState(true);

  // Quick add
  const [newLabel, setNewLabel] = useState('');
  const [newEntity, setNewEntity] = useState<'invoice' | 'item'>(
    supportsInvoiceFields ? 'invoice' : 'item'
  );
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

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

  /** Creates a text custom field and returns the new definition (or null on failure). */
  const createField = async (
    label: string,
    entityType: 'invoice' | 'item',
    fieldKey?: string
  ): Promise<CustomFieldDefinition | null> => {
    if (!business?.id) return null;
    setCreateError(null);
    try {
      const res = await fetch('/api/custom-fields', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: business.id,
          user_id: user?.id,
          entity_type: entityType,
          label,
          field_key: fieldKey,
          field_type: 'text',
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCreateError(data.error || 'Failed to create field');
        return null;
      }
      const def: CustomFieldDefinition = data.definition;
      if (entityType === 'invoice') {
        setInvoiceDefs((prev) => [...prev, def]);
      } else {
        setItemDefs((prev) => [...prev, def]);
      }
      return def;
    } catch {
      setCreateError('Failed to create field');
      return null;
    }
  };

  const handleQuickAdd = async () => {
    const label = newLabel.trim();
    if (!label || creating) return;
    setCreating(true);
    const def = await createField(label, newEntity);
    setCreating(false);
    if (def) {
      setNewLabel('');
      toggleKey(newEntity === 'invoice' ? 'invoice_meta' : 'item_table', def.field_key);
    }
  };

  const handleSuggestedTap = async (
    suggestion: (typeof SUGGESTED_FIELDS)[number],
    active: boolean
  ) => {
    if ('builtin' in suggestion) {
      onChange({ ...settings, [suggestion.builtin]: !active });
      return;
    }
    const existing = invoiceDefs.find((d) => d.field_key === suggestion.fieldKey);
    if (existing) {
      toggleKey('invoice_meta', existing.field_key);
      return;
    }
    if (creating) return;
    setCreating(true);
    const def = await createField(suggestion.label, 'invoice', suggestion.fieldKey);
    setCreating(false);
    if (def) {
      toggleKey('invoice_meta', def.field_key);
    }
  };

  const isSuggestionActive = (suggestion: (typeof SUGGESTED_FIELDS)[number]): boolean => {
    if ('builtin' in suggestion) {
      return settings[suggestion.builtin] === true;
    }
    return (layout.invoice_meta || []).includes(suggestion.fieldKey);
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-2 text-sm text-text-muted">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading custom fields…
      </div>
    );
  }

  const visibleInvoiceDefs = supportsInvoiceFields ? invoiceDefs : [];

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

      {supportsInvoiceFields && (
        <div className="space-y-2">
          <p className="text-xs text-text-muted">
            Suggested fields — tap to add to the invoice details block
          </p>
          <div className="flex flex-wrap gap-1.5">
            {SUGGESTED_FIELDS.map((suggestion) => {
              const active = isSuggestionActive(suggestion);
              return (
                <button
                  key={suggestion.label}
                  type="button"
                  disabled={creating}
                  onClick={() => handleSuggestedTap(suggestion, active)}
                  className={`
                    inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors
                    ${
                      active
                        ? 'border-active bg-gray-100 text-text-primary'
                        : 'border-border bg-white text-text-secondary hover:border-gray-400'
                    }
                  `}
                >
                  {active ? <Check className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
                  {suggestion.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {renderList(
        'Invoice details (below number, date, due date)',
        'Shown in the invoice metadata block on print/PDF.',
        'invoice_meta',
        visibleInvoiceDefs
      )}
      {renderList(
        'Item lines',
        'Shown under each item name on the bill.',
        'item_table',
        itemDefs
      )}

      <div className="space-y-1.5">
        <p className="text-xs text-text-muted">Add your own field</p>
        <div className="flex gap-1.5">
          <input
            type="text"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleQuickAdd();
              }
            }}
            placeholder="Ex: Salesman Code"
            maxLength={60}
            className="flex-1 min-w-0 rounded-md border border-border px-2 py-1.5 text-sm bg-white focus-primary"
          />
          {supportsInvoiceFields && (
            <select
              value={newEntity}
              onChange={(e) => setNewEntity(e.target.value as 'invoice' | 'item')}
              className="rounded-md border border-border px-1.5 py-1.5 text-xs bg-white text-text-secondary"
              aria-label="Where the field appears"
            >
              <option value="invoice">Invoice details</option>
              <option value="item">Item lines</option>
            </select>
          )}
          <button
            type="button"
            onClick={handleQuickAdd}
            disabled={!newLabel.trim() || creating}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-gray-100 px-2.5 py-1.5 text-xs font-semibold text-text-primary hover:bg-gray-200 disabled:opacity-50"
          >
            {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            Add
          </button>
        </div>
        {createError && <p className="text-xs text-red-600">{createError}</p>}
        <p className="text-2xs text-text-muted">
          Manage field types and options under{' '}
          <a href="/settings/custom-fields" className="link-primary">
            Settings → Custom fields
          </a>
          .
        </p>
      </div>
    </div>
  );
}
