'use client';

import { useEffect, useState } from 'react';
import { Loader2, Megaphone, BarChart2, FileText } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useEmployeePortal } from '@/components/employee-portal/EmployeePortalContext';
import { EmployeePortalLoginForm } from '@/components/employee-portal/EmployeePortalLoginForm';

type Poll = {
  id: string;
  question: string;
  options: Array<{ id: string; text: string; votes: number }>;
  my_votes: string[];
};

export default function EmployeePortalEngagementPage() {
  const { loading, session } = useEmployeePortal();
  const [feedLoading, setFeedLoading] = useState(true);
  const [announcements, setAnnouncements] = useState<Record<string, unknown>[]>([]);
  const [articles, setArticles] = useState<Record<string, unknown>[]>([]);
  const [polls, setPolls] = useState<Poll[]>([]);

  const load = async () => {
    setFeedLoading(true);
    try {
      const res = await fetch('/api/public/employee/portal/engagement', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setAnnouncements(data.announcements ?? []);
        setArticles(data.articles ?? []);
        setPolls(data.polls ?? []);
      }
    } finally {
      setFeedLoading(false);
    }
  };

  useEffect(() => {
    if (session) void load();
  }, [session]);

  async function vote(pollId: string, optionId: string) {
    await fetch('/api/public/employee/portal/engagement', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'vote', poll_id: pollId, option_id: optionId }),
    });
    await load();
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-text-muted" />
      </div>
    );
  }

  if (!session) return <EmployeePortalLoginForm />;

  if (feedLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-text-muted" />
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 md:p-6">
      <h1 className="text-lg font-semibold text-gray-900">Engagement</h1>

      {announcements.length > 0 && (
        <section>
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <Megaphone className="h-4 w-4" />
            Announcements
          </h2>
          <div className="space-y-2">
            {announcements.map((a) => (
              <Card key={String(a.id)} className="p-4">
                <p className="font-medium">{String(a.title)}</p>
                {a.body ? <p className="mt-1 text-sm text-text-secondary">{String(a.body)}</p> : null}
              </Card>
            ))}
          </div>
        </section>
      )}

      {polls.length > 0 && (
        <section>
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <BarChart2 className="h-4 w-4" />
            Polls
          </h2>
          <div className="space-y-3">
            {polls.map((p) => (
              <Card key={p.id} className="space-y-2 p-4">
                <p className="font-medium">{p.question}</p>
                {p.options.map((o) => (
                  <Button
                    key={o.id}
                    variant={p.my_votes.includes(o.id) ? 'primary' : 'secondary'}
                    size="sm"
                    className="mr-2"
                    onClick={() => void vote(p.id, o.id)}
                  >
                    {o.text} ({o.votes})
                  </Button>
                ))}
              </Card>
            ))}
          </div>
        </section>
      )}

      {articles.length > 0 && (
        <section>
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <FileText className="h-4 w-4" />
            Articles
          </h2>
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
        </section>
      )}

      {!announcements.length && !polls.length && !articles.length && (
        <p className="text-sm text-text-muted">No engagement content right now.</p>
      )}
    </div>
  );
}
