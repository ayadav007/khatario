'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Loader2, Plus, Trash2, GripVertical } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';
import type { CustomFieldDefinition, CustomFieldEntityType, CustomFieldType } from '@/types/custom-fields';
import { parseCustomFieldValues } from '@/lib/custom-fields';

const FIELD_TYPES: { value: CustomFieldType; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'dropdown', label: 'Dropdown' },
];

interface CustomFieldsManagerProps {
  entityType: CustomFieldEntityType;
  title: string;
  description: string;
}

export function CustomFieldsManager({ entityType, title, description }: CustomFieldsManagerProps) {
  const { business, user } = useAuth();
  const toast = useToastContext();
  const [definitions, setDefinitions] = useState<CustomFieldDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newType, setNewType] = useState<CustomFieldType>('text');
  const [newOptions, setNewOptions] = useState('');
  const [newRequired, setNewRequired] = useState(false);

  const load = useCallback(async () => {
    if (!business?.id) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/custom-fields?business_id=${business.id}&entity_type=${entityType}&user_id=${user?.id || ''}`
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load');
      setDefinitions(data.definitions || []);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed to load custom fields');
    } finally {
      setLoading(false);
    }
  }, [business?.id, entityType, user?.id, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreate = async () => {
    if (!business?.id || !user?.id || !newLabel.trim()) return;
    setSaving(true);
    try {
      const options =
        newType === 'dropdown'
          ? newOptions
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
          : [];
      const res = await fetch('/api/custom-fields', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: business.id,
          user_id: user.id,
          entity_type: entityType,
          label: newLabel.trim(),
          field_type: newType,
          options,
          is_required: newRequired,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create');
      setDefinitions((prev) => [...prev, data.definition]);
      setNewLabel('');
      setNewOptions('');
      setNewRequired(false);
      setNewType('text');
      setShowAdd(false);
      toast.success('Field added');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed to add field');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!business?.id || !user?.id) return;
    if (!confirm('Remove this field? Existing values will be kept in data but hidden until you re-add a field with the same key.')) {
      return;
    }
    try {
      const res = await fetch(
        `/api/custom-fields/${id}?business_id=${business.id}&user_id=${user.id}`,
        { method: 'DELETE' }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to delete');
      setDefinitions((prev) => prev.filter((d) => d.id !== id));
      toast.success('Field removed');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed to remove field');
    }
  };

  return (
    <Card className="p-4 md:p-6">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-text-primary">{title}</h2>
        <p className="text-sm text-text-secondary mt-1">{description}</p>
      </div>

      {loading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-text-muted" />
        </div>
      ) : (
        <>
          {definitions.length === 0 && !showAdd && (
            <p className="text-sm text-text-muted py-4">No custom fields yet.</p>
          )}
          <ul className="space-y-2">
            {definitions.map((def) => (
              <li
                key={def.id}
                className="flex items-center gap-3 rounded-lg border border-border bg-gray-50 px-3 py-2"
              >
                <GripVertical className="w-4 h-4 text-text-muted shrink-0" aria-hidden />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-text-primary truncate">{def.label}</p>
                  <p className="text-xs text-text-muted">
                    {def.field_type}
                    {def.is_required ? ' · Required' : ''}
                    {def.field_type === 'dropdown' && def.options.length
                      ? ` · ${def.options.join(', ')}`
                      : ''}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-error shrink-0"
                  onClick={() => handleDelete(def.id)}
                  aria-label={`Delete ${def.label}`}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </li>
            ))}
          </ul>

          {showAdd ? (
            <div className="mt-4 space-y-3 rounded-lg border border-border p-4 bg-white">
              <div>
                <label className="block text-xs font-semibold uppercase text-text-secondary mb-1">
                  Field label
                </label>
                <Input
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  placeholder="e.g. Manufacturing date"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase text-text-secondary mb-1">
                  Type
                </label>
                <select
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm"
                  value={newType}
                  onChange={(e) => setNewType(e.target.value as CustomFieldType)}
                >
                  {FIELD_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
              {newType === 'dropdown' && (
                <div>
                  <label className="block text-xs font-semibold uppercase text-text-secondary mb-1">
                    Options (comma-separated)
                  </label>
                  <Input
                    value={newOptions}
                    onChange={(e) => setNewOptions(e.target.value)}
                    placeholder="Option A, Option B"
                  />
                </div>
              )}
              <label className="flex items-center gap-2 text-sm text-text-primary">
                <input
                  type="checkbox"
                  checked={newRequired}
                  onChange={(e) => setNewRequired(e.target.checked)}
                  className="rounded border-border"
                />
                Required on forms
              </label>
              <div className="flex gap-2">
                <Button type="button" variant="secondary" onClick={() => setShowAdd(false)}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={handleCreate}
                  disabled={saving || !newLabel.trim()}
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save field'}
                </Button>
              </div>
            </div>
          ) : (
            <Button
              type="button"
              variant="secondary"
              className="mt-4"
              onClick={() => setShowAdd(true)}
            >
              <Plus className="w-4 h-4 mr-1" />
              Add field
            </Button>
          )}
        </>
      )}
    </Card>
  );
}

/** Hook to load definitions for forms */
export function useCustomFieldDefinitions(entityType: CustomFieldEntityType) {
  const { business, user } = useAuth();
  const [definitions, setDefinitions] = useState<CustomFieldDefinition[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!business?.id) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/custom-fields?business_id=${business.id}&entity_type=${entityType}&user_id=${user?.id || ''}`
        );
        const data = await res.json();
        if (!cancelled && res.ok) {
          setDefinitions(data.definitions || []);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [business?.id, entityType, user?.id]);

  return { definitions, loading };
}

export function parseItemCustomFieldsFromApi(item: { custom_fields?: unknown }): Record<string, string | number | null> {
  return parseCustomFieldValues(item.custom_fields);
}
