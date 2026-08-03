'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Loader2, CheckSquare } from 'lucide-react';
import { clsx } from 'clsx';

type Task = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  due_date: string | null;
  assigner_name: string | null;
};

export function EmployeePortalTodoPage() {
  const [loading, setLoading] = useState(true);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selected, setSelected] = useState<Task | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/public/employee/portal/tasks', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        const list = data.tasks ?? [];
        setTasks(list);
        setSelected((prev) => prev ?? list[0] ?? null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function addTask(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.trim()) return;
    setSaving(true);
    try {
      await fetch('/api/public/employee/portal/tasks', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: draft.trim() }),
      });
      setDraft('');
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function completeTask(id: string) {
    await fetch('/api/public/employee/portal/tasks', {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status: 'completed' }),
    });
    setSelected(null);
    await load();
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-text-muted" />
      </div>
    );
  }

  return (
    <div className="flex min-h-[60vh] flex-col p-4 md:p-6">
      <h1 className="mb-4 text-lg font-semibold text-gray-900">To do</h1>

      <form onSubmit={addTask} className="mb-4">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Enter task name and press Enter"
          disabled={saving}
        />
      </form>

      <p className="mb-2 text-xs text-text-muted">All tasks · {tasks.length}</p>

      <div className="flex flex-1 flex-col gap-3 lg:flex-row">
        <ul className="flex-1 space-y-1 overflow-y-auto rounded-lg border border-border">
          {tasks.length === 0 ? (
            <li className="p-4 text-sm text-text-muted">No open tasks.</li>
          ) : (
            tasks.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => setSelected(t)}
                  className={clsx(
                    'flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm',
                    selected?.id === t.id ? 'bg-gray-100' : 'hover:bg-gray-50',
                  )}
                >
                  <CheckSquare className="h-4 w-4 shrink-0 text-text-muted" />
                  <span className="truncate">{t.title}</span>
                </button>
              </li>
            ))
          )}
        </ul>

        {selected && (
          <Card className="w-full space-y-3 p-4 lg:max-w-md lg:flex-1">
            <h2 className="font-semibold text-text-primary">{selected.title}</h2>
            {selected.description ? (
              <p className="text-sm text-text-secondary">{selected.description}</p>
            ) : null}
            <dl className="space-y-1 text-xs text-text-secondary">
              <div>
                <dt className="inline font-medium">Priority: </dt>
                <dd className="inline capitalize">{selected.priority}</dd>
              </div>
              {selected.due_date ? (
                <div>
                  <dt className="inline font-medium">Due: </dt>
                  <dd className="inline">{selected.due_date}</dd>
                </div>
              ) : null}
              {selected.assigner_name ? (
                <div>
                  <dt className="inline font-medium">Created by: </dt>
                  <dd className="inline">{selected.assigner_name}</dd>
                </div>
              ) : null}
            </dl>
            <Button className="w-full" size="sm" onClick={() => void completeTask(selected.id)}>
              Mark complete
            </Button>
          </Card>
        )}
      </div>
    </div>
  );
}
