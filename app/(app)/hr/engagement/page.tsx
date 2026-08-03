'use client';

export const dynamic = 'force-dynamic';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Megaphone, BarChart2, FileText, Loader2, Plus } from 'lucide-react';
import { clsx } from 'clsx';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';
import { EngagementAudienceFields } from '@/components/hr/EngagementAudienceFields';
import { buildEngagementPayload, type EngagementAudience } from '@/lib/hr/engagement-audience';
import type { EmployeeOption } from '@/components/hr/EmployeeSearchSelect';

const TABS = [
  { id: 'announcements', label: 'Announcements', icon: Megaphone },
  { id: 'polls', label: 'Polls', icon: BarChart2 },
  { id: 'articles', label: 'Articles', icon: FileText },
] as const;

type TabId = (typeof TABS)[number]['id'];

export default function HrEngagementPage() {
  const { business, user } = useAuth();
  const toast = useToastContext();
  const [tab, setTab] = useState<TabId>('announcements');
  const [loading, setLoading] = useState(true);
  const [announcements, setAnnouncements] = useState<Record<string, unknown>[]>([]);
  const [polls, setPolls] = useState<Record<string, unknown>[]>([]);
  const [articles, setArticles] = useState<Record<string, unknown>[]>([]);
  const [draft, setDraft] = useState({ title: '', body: '', question: '', options: ['', ''] });
  const [audience, setAudience] = useState<EngagementAudience>({ type: 'all' });
  const [expiresAt, setExpiresAt] = useState('');
  const [departments, setDepartments] = useState<string[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);

  const loadMeta = useCallback(async () => {
    if (!business?.id) return;
    const [org, empRes] = await Promise.all([
      fetch(`/api/settings/hr-org-catalog?business_id=${business.id}`, { credentials: 'include' }),
      user?.id
        ? fetch(`/api/employees?business_id=${business.id}&status=active&user_id=${user.id}`, {
            credentials: 'include',
          })
        : Promise.resolve(null),
    ]);
    if (org.ok) {
      const data = await org.json();
      const depts = (data.catalog?.departments ?? []) as string[];
      setDepartments(depts.filter(Boolean));
    }
    if (empRes?.ok) {
      const data = await empRes.json();
      setEmployees(
        (data.employees ?? []).map((e: Record<string, unknown>) => ({
          id: String(e.id),
          name: String(e.user_name ?? e.employee_code),
          employee_code: String(e.employee_code),
        })),
      );
    }
  }, [business?.id, user?.id]);

  const load = useCallback(async () => {
    if (!business?.id) return;
    setLoading(true);
    try {
      const [a, p, ar] = await Promise.all([
        fetch('/api/hr/announcements', { credentials: 'include' }).then((r) =>
          r.ok ? r.json() : { announcements: [] },
        ),
        fetch('/api/hr/engagement/polls', { credentials: 'include' }).then((r) =>
          r.ok ? r.json() : { polls: [] },
        ),
        fetch('/api/hr/engagement/articles', { credentials: 'include' }).then((r) =>
          r.ok ? r.json() : { articles: [] },
        ),
      ]);
      setAnnouncements(a.announcements ?? []);
      setPolls(p.polls ?? []);
      setArticles(ar.articles ?? []);
    } finally {
      setLoading(false);
    }
  }, [business?.id]);

  useEffect(() => {
    void load();
    void loadMeta();
  }, [load, loadMeta]);

  async function createAnnouncement(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.title.trim()) return;
    const res = await fetch('/api/hr/announcements', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: draft.title,
        body: draft.body,
        ...buildEngagementPayload(audience, expiresAt),
      }),
    });
    if (res.ok) {
      toast.success('Announcement published');
      setDraft({ ...draft, title: '', body: '' });
      void load();
    } else toast.error('Failed to publish');
  }

  async function createPoll(e: React.FormEvent) {
    e.preventDefault();
    const options = draft.options.filter((o) => o.trim());
    if (!draft.question.trim() || options.length < 2) return;
    const res = await fetch('/api/hr/engagement/polls', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: draft.question,
        options,
        ...buildEngagementPayload(audience, expiresAt),
      }),
    });
    if (res.ok) {
      toast.success('Poll created');
      setDraft({ ...draft, question: '', options: ['', ''] });
      void load();
    } else toast.error('Failed to create poll');
  }

  async function createArticle(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.title.trim()) return;
    const res = await fetch('/api/hr/engagement/articles', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: draft.title,
        body_html: draft.body,
        expires_at: expiresAt || undefined,
      }),
    });
    if (res.ok) {
      toast.success('Article published');
      setDraft({ ...draft, title: '', body: '' });
      void load();
    } else toast.error('Failed to publish');
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
          <h1 className="text-2xl font-bold text-text-primary">Engagement</h1>
          <p className="text-sm text-text-secondary">
            Announcements, polls, and articles for your team
          </p>
        </div>
        <Link href="/hr/dashboard">
          <Button variant="secondary">Back to HR dashboard</Button>
        </Link>
      </div>

      <div className="flex gap-1 border-b border-border">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={clsx(
                'flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-medium',
                tab === t.id
                  ? 'border-primary-600 text-text-primary'
                  : 'border-transparent text-text-secondary',
              )}
            >
              <Icon className="h-4 w-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'announcements' && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="space-y-3 p-4">
            <h2 className="font-semibold">New announcement</h2>
            <form onSubmit={createAnnouncement} className="space-y-3">
              <Input
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                placeholder="Title"
              />
              <textarea
                className="input min-h-[100px] w-full"
                value={draft.body}
                onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                placeholder="Message (no replies)"
              />
              <EngagementAudienceFields
                value={audience}
                onChange={setAudience}
                departments={departments}
                employees={employees}
                expiresAt={expiresAt}
                onExpiresAtChange={setExpiresAt}
              />
              <Button type="submit">
                <Plus className="mr-2 h-4 w-4" />
                Publish
              </Button>
            </form>
          </Card>
          <div className="space-y-2">
            {announcements.map((a) => (
              <Card key={String(a.id)} className="p-4">
                <p className="font-medium">{String(a.title)}</p>
                {a.body ? <p className="mt-1 text-sm text-text-secondary">{String(a.body)}</p> : null}
              </Card>
            ))}
          </div>
        </div>
      )}

      {tab === 'polls' && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="space-y-3 p-4">
            <h2 className="font-semibold">New poll</h2>
            <form onSubmit={createPoll} className="space-y-3">
              <Input
                value={draft.question}
                onChange={(e) => setDraft({ ...draft, question: e.target.value })}
                placeholder="Question"
              />
              <EngagementAudienceFields
                value={audience}
                onChange={setAudience}
                departments={departments}
                employees={employees}
                expiresAt={expiresAt}
                onExpiresAtChange={setExpiresAt}
              />
              {draft.options.map((opt, i) => (
                <Input
                  key={i}
                  value={opt}
                  onChange={(e) => {
                    const options = [...draft.options];
                    options[i] = e.target.value;
                    setDraft({ ...draft, options });
                  }}
                  placeholder={`Option ${i + 1}`}
                />
              ))}
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setDraft({ ...draft, options: [...draft.options, ''] })}
              >
                Add option
              </Button>
              <Button type="submit">
                <Plus className="mr-2 h-4 w-4" />
                Create poll
              </Button>
            </form>
          </Card>
          <div className="space-y-2">
            {polls.map((p) => (
              <Card key={String(p.id)} className="p-4">
                <p className="font-medium">{String(p.question)}</p>
                <ul className="mt-2 space-y-1 text-sm text-text-secondary">
                  {(p.options as Array<{ option_text: string }> | undefined)?.map((o) => (
                    <li key={o.option_text}>· {o.option_text}</li>
                  ))}
                </ul>
              </Card>
            ))}
          </div>
        </div>
      )}

      {tab === 'articles' && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="space-y-3 p-4">
            <h2 className="font-semibold">New article</h2>
            <form onSubmit={createArticle} className="space-y-3">
              <Input
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                placeholder="Title"
              />
              <textarea
                className="input min-h-[160px] w-full font-mono text-sm"
                value={draft.body}
                onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                placeholder="HTML content — use <b>, <i>, <img>, etc."
              />
              <div>
                <label className="mb-1 block text-xs text-text-muted">Expires on (optional)</label>
                <Input
                  type="date"
                  value={expiresAt ?? ''}
                  onChange={(e) => setExpiresAt(e.target.value)}
                />
              </div>
              <Button type="submit">
                <Plus className="mr-2 h-4 w-4" />
                Publish
              </Button>
            </form>
          </Card>
          <div className="space-y-2">
            {articles.map((a) => (
              <Card key={String(a.id)} className="p-4">
                <p className="font-medium">{String(a.title)}</p>
                <div
                  className="prose prose-sm mt-2 max-w-none text-text-secondary"
                  dangerouslySetInnerHTML={{ __html: String(a.body_html ?? '') }}
                />
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
