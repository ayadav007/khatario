'use client';

export const dynamic = 'force-dynamic';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { FileText, Loader2, Plus, Download } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { EmployeeSearchSelect } from '@/components/hr/EmployeeSearchSelect';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';

type Template = {
  id: string;
  name: string;
  document_type: string;
  body_html: string;
};

export default function HrDocumentsPage() {
  const { business } = useAuth();
  const toast = useToastContext();
  const [loading, setLoading] = useState(true);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [attributes, setAttributes] = useState<Array<{ key: string; label: string }>>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [employeeId, setEmployeeId] = useState('');
  const [newName, setNewName] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/hr/document-templates', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setTemplates(data.templates ?? []);
        setAttributes(data.attributes ?? []);
        setSelectedId(data.templates?.[0]?.id ?? null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = templates.find((t) => t.id === selectedId);

  async function createTemplate() {
    if (!newName.trim()) return;
    const res = await fetch('/api/hr/document-templates', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName }),
    });
    if (res.ok) {
      toast.success('Template created');
      setNewName('');
      void load();
    }
  }

  async function saveTemplate() {
    if (!selected) return;
    const res = await fetch('/api/hr/document-templates', {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: selected.id,
        body_html: selected.body_html,
        name: selected.name,
      }),
    });
    if (res.ok) toast.success('Saved');
    else toast.error('Save failed');
  }

  async function generate(format: 'html' | 'word' | 'pdf') {
    if (!selectedId || !employeeId.trim()) {
      toast.error('Select template and employee');
      return;
    }
    const res = await fetch(`/api/hr/document-templates/${selectedId}/generate`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employee_id: employeeId, format }),
    });
    if (!res.ok) {
      toast.error('Generation failed');
      return;
    }
    if (format === 'word' || format === 'pdf') {
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${selected?.name ?? 'document'}.${format === 'pdf' ? 'pdf' : 'doc'}`;
      a.click();
      URL.revokeObjectURL(url);
      return;
    }
    const data = await res.json();
    const w = window.open('', '_blank');
    if (w) {
      w.document.write(data.html);
      w.document.close();
      w.print();
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-text-muted" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">HR documents</h1>
          <p className="text-sm text-text-secondary">
            Appointment letters and other templates with attribute mapping
          </p>
        </div>
        <Link href="/settings/offer-letter">
          <Button variant="secondary">Offer letter templates</Button>
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="space-y-3 p-4">
          <h2 className="font-semibold">Templates</h2>
          <ul className="space-y-1">
            {templates.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(t.id)}
                  className={`w-full rounded-lg px-3 py-2 text-left text-sm ${
                    selectedId === t.id ? 'bg-gray-100 font-medium' : 'hover:bg-gray-50'
                  }`}
                >
                  {t.name}
                </button>
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New template" />
            <Button type="button" onClick={createTemplate}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </Card>

        <Card className="space-y-3 p-4 lg:col-span-2">
          {selected ? (
            <>
              <Input
                value={selected.name}
                onChange={(e) =>
                  setTemplates(
                    templates.map((t) =>
                      t.id === selected.id ? { ...t, name: e.target.value } : t,
                    ),
                  )
                }
              />
              <textarea
                className="input min-h-[200px] w-full font-mono text-sm"
                value={selected.body_html}
                onChange={(e) =>
                  setTemplates(
                    templates.map((t) =>
                      t.id === selected.id ? { ...t, body_html: e.target.value } : t,
                    ),
                  )
                }
              />
              <p className="text-xs text-text-muted">
                Attributes: {attributes.map((a) => `{{${a.key}}}`).join(', ')}
              </p>
              <Button onClick={saveTemplate}>Save template</Button>
            </>
          ) : (
            <p className="text-sm text-text-muted">Create or select a template</p>
          )}
        </Card>
      </div>

      <Card className="flex flex-wrap items-end gap-3 p-4">
        <div className="min-w-[240px] flex-1">
          <EmployeeSearchSelect
            value={employeeId}
            onChange={setEmployeeId}
            label="Employee"
            required
          />
        </div>
        <Button onClick={() => void generate('pdf')}>Download PDF</Button>
        <Button variant="secondary" onClick={() => void generate('html')}>
          Preview
        </Button>
        <Button variant="secondary" onClick={() => void generate('word')}>
          Download Word
        </Button>
      </Card>
    </div>
  );
}
