'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';

export type ItemCategoryOption = { id: string; name: string };

export function CategoryCombobox({
  categories,
  value,
  onChange,
  onCategoryCreated,
}: {
  categories: ItemCategoryOption[];
  value: string;
  onChange: (categoryId: string) => void;
  onCategoryCreated?: (category: ItemCategoryOption) => void;
}) {
  const { business, user } = useAuth();
  const toast = useToastContext();
  const selected = categories.find((category) => category.id === value);
  const [query, setQuery] = useState(selected?.name || '');
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const suppressBlur = useRef(false);

  useEffect(() => {
    setQuery(selected?.name || '');
  }, [selected?.id, selected?.name]);

  const trimmed = query.trim();
  const matches = useMemo(() => {
    const needle = trimmed.toLowerCase();
    if (!needle) return categories;
    return categories.filter((category) => category.name.toLowerCase().includes(needle));
  }, [categories, trimmed]);

  const exact = categories.find((category) => category.name.toLowerCase() === trimmed.toLowerCase());
  const canAdd = trimmed.length > 0 && !exact;

  async function addCategory() {
    if (!canAdd || !business?.id || !user?.id || saving) return;
    setSaving(true);
    try {
      const response = await fetch('/api/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: business.id,
          created_by_user_id: user.id,
          name: trimmed,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.category?.id) {
        toast.error(data.error || 'Could not add the category');
        return;
      }
      const created: ItemCategoryOption = { id: data.category.id, name: data.category.name || trimmed };
      onCategoryCreated?.(created);
      onChange(created.id);
      setQuery(created.name);
      setOpen(false);
      toast.success(`Category "${created.name}" added`);
    } catch {
      toast.error('Could not add the category');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-text-secondary" htmlFor="item-category">
        Category (optional)
      </label>
      <input
        id="item-category"
        className="input w-full"
        value={query}
        placeholder="Search or add a category"
        autoComplete="off"
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          if (!event.target.value.trim()) onChange('');
        }}
        onBlur={() => {
          window.setTimeout(() => {
            if (suppressBlur.current) {
              suppressBlur.current = false;
              return;
            }
            setOpen(false);
            if (exact) {
              onChange(exact.id);
              setQuery(exact.name);
              return;
            }
            setQuery(selected?.name || '');
            if (!selected) onChange('');
          }, 180);
        }}
      />
      {open && (
        <div className="mt-1 max-h-40 overflow-y-auto rounded-md border border-border bg-white shadow-sm">
          <button
            type="button"
            className="block w-full px-3 py-2 text-left text-sm text-text-secondary hover:bg-slate-50"
            onMouseDown={(event) => {
              suppressBlur.current = true;
              event.preventDefault();
            }}
            onClick={() => {
              onChange('');
              setQuery('');
              setOpen(false);
            }}
          >
            No category
          </button>
          {matches.map((category) => (
            <button
              key={category.id}
              type="button"
              className="block w-full px-3 py-2 text-left text-sm text-text-primary hover:bg-slate-50"
              onMouseDown={(event) => {
                suppressBlur.current = true;
                event.preventDefault();
              }}
              onClick={() => {
                onChange(category.id);
                setQuery(category.name);
                setOpen(false);
              }}
            >
              {category.name}
            </button>
          ))}
          {canAdd && (
            <button
              type="button"
              className="block w-full border-t border-border px-3 py-2 text-left text-sm font-medium text-primary-600 hover:bg-slate-50"
              disabled={saving}
              onMouseDown={(event) => {
                suppressBlur.current = true;
                event.preventDefault();
              }}
              onClick={addCategory}
            >
              {saving ? 'Adding category…' : `+ Add category "${trimmed}"`}
            </button>
          )}
          {matches.length === 0 && !canAdd && (
            <div className="px-3 py-2 text-sm text-text-secondary">No categories yet</div>
          )}
        </div>
      )}
    </div>
  );
}
