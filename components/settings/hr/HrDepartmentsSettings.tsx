'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';
import { STACK_SECTION_CLASS } from '@/lib/page-layout';

type Catalog = {
  departments: string[];
  designations: string[];
};

export function HrDepartmentsSettings() {
  const { business } = useAuth();
  const toast = useToastContext();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [catalog, setCatalog] = useState<Catalog>({ departments: [], designations: [] });
  const [newDepartment, setNewDepartment] = useState('');
  const [newDesignation, setNewDesignation] = useState('');

  const load = useCallback(async () => {
    if (!business?.id) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/settings/hr-org-catalog?business_id=${business.id}`, {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        setCatalog(data.catalog ?? { departments: [], designations: [] });
      }
    } finally {
      setLoading(false);
    }
  }, [business?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(next: Catalog) {
    if (!business?.id) return;
    setSaving(true);
    try {
      const res = await fetch('/api/settings/hr-org-catalog', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_id: business.id, ...next }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Could not save');
        return;
      }
      setCatalog(data.catalog);
      toast.success('Saved');
    } catch {
      toast.error('Could not save');
    } finally {
      setSaving(false);
    }
  }

  function addItem(kind: 'departments' | 'designations', value: string) {
    const trimmed = value.trim();
    if (!trimmed) return;
    const list = catalog[kind];
    if (list.some((x) => x.toLowerCase() === trimmed.toLowerCase())) {
      toast.error('Already in the list');
      return;
    }
    const next = { ...catalog, [kind]: [...list, trimmed].sort((a, b) => a.localeCompare(b)) };
    void save(next);
    if (kind === 'departments') setNewDepartment('');
    else setNewDesignation('');
  }

  function removeItem(kind: 'departments' | 'designations', value: string) {
    const next = {
      ...catalog,
      [kind]: catalog[kind].filter((x) => x !== value),
    };
    void save(next);
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-text-secondary">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading…
      </div>
    );
  }

  function renderList(
    title: string,
    description: string,
    kind: 'departments' | 'designations',
    draft: string,
    setDraft: (v: string) => void,
  ) {
    return (
      <section className={STACK_SECTION_CLASS}>
        <div>
          <h3 className="settings-section-title mb-0">{title}</h3>
          <p className="type-body-secondary mt-1">{description}</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={`Add ${kind === 'departments' ? 'department' : 'designation'}…`}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addItem(kind, draft);
              }
            }}
          />
          <Button
            type="button"
            variant="secondary"
            disabled={saving || !draft.trim()}
            onClick={() => addItem(kind, draft)}
          >
            <Plus className="mr-1 h-4 w-4" />
            Add
          </Button>
        </div>
        {catalog[kind].length === 0 ? (
          <p className="text-sm text-text-muted">No entries yet.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {catalog[kind].map((item) => (
              <li key={item} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                <span className="text-text-primary">{item}</span>
                <button
                  type="button"
                  className="rounded p-1 text-text-muted hover:bg-red-50 hover:text-red-600"
                  onClick={() => removeItem(kind, item)}
                  disabled={saving}
                  aria-label={`Remove ${item}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  }

  return (
    <div className="space-y-8">
      {renderList(
        'Departments',
        'Used on employee profiles and org reports. Existing employee text is unchanged until you edit them.',
        'departments',
        newDepartment,
        setNewDepartment,
      )}
      {renderList(
        'Designations',
        'Job titles for dropdowns when adding or editing employees.',
        'designations',
        newDesignation,
        setNewDesignation,
      )}
    </div>
  );
}
