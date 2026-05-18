'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, Mail, MessageSquare, FileText, ArrowRightCircle } from 'lucide-react';
import { clsx } from 'clsx';
import { Button } from '@/components/ui/Button';
import { useToastContext } from '@/contexts/ToastContext';
import { useAuth } from '@/contexts/AuthContext';

interface TimelineEntry {
  id: string;
  kind: 'activity' | 'comment';
  description: string;
  created_at: string;
  user_name: string | null;
  action_type?: string;
}

interface PurchaseOrderCommentsHistoryPanelProps {
  orderId: string;
  /** Bump to refetch timeline (e.g. after email or attachment). */
  refreshKey?: number;
}

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function TimelineIcon({ entry }: { entry: TimelineEntry }) {
  if (entry.kind === 'comment') {
    return (
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-600">
        <MessageSquare className="h-4 w-4" />
      </span>
    );
  }
  if (entry.action_type === 'email' || entry.description.toLowerCase().includes('emailed')) {
    return (
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-green-50 text-green-700">
        <Mail className="h-4 w-4" />
      </span>
    );
  }
  if (
    entry.action_type === 'attachment' ||
    entry.description.toLowerCase().includes('attachment added')
  ) {
    return (
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-600">
        <FileText className="h-4 w-4" />
      </span>
    );
  }
  if (entry.action_type === 'convert' || entry.description.toLowerCase().includes('converted')) {
    return (
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-700">
        <ArrowRightCircle className="h-4 w-4" />
      </span>
    );
  }
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-50 text-amber-700">
      <FileText className="h-4 w-4" />
    </span>
  );
}

export function PurchaseOrderCommentsHistoryPanel({
  orderId,
  refreshKey = 0,
}: PurchaseOrderCommentsHistoryPanelProps) {
  const toast = useToastContext();
  const { user } = useAuth();
  const [history, setHistory] = useState<TimelineEntry[]>([]);
  const [commentCount, setCommentCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [commentText, setCommentText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/purchase-orders/${orderId}/history`, { credentials: 'include' });
      const data = await res.json();
      if (res.ok) {
        setHistory(data.history || []);
        setCommentCount(data.comment_count ?? 0);
      }
    } catch {
      toast.error('Failed to load history');
    } finally {
      setLoading(false);
    }
  }, [orderId, toast]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory, refreshKey]);

  const handleAddComment = async () => {
    const text = commentText.trim();
    if (!text) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/purchase-orders/${orderId}/comments`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment_text: text }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Failed to add comment');
        return;
      }
      setCommentText('');
      await fetchHistory();
    } catch {
      toast.error('Failed to add comment');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border p-4">
        <textarea
          value={commentText}
          onChange={(e) => setCommentText(e.target.value)}
          placeholder="Add a comment..."
          rows={3}
          className="w-full resize-none rounded-lg border border-border px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
        <div className="mt-2 flex justify-end">
          <Button
            size="sm"
            onClick={handleAddComment}
            disabled={!commentText.trim() || submitting}
            isLoading={submitting}
          >
            Add comment
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-text-secondary">
          All comments
          {commentCount > 0 && (
            <span className="ml-2 inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-bold text-blue-800">
              {commentCount}
            </span>
          )}
        </p>

        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-primary-600" />
          </div>
        ) : history.length === 0 ? (
          <p className="py-8 text-center text-sm text-text-secondary">No activity yet</p>
        ) : (
          <ul className="relative space-y-0 border-l border-gray-200 pl-6">
            {history.map((entry) => (
              <li key={entry.id} className="relative pb-6 last:pb-0">
                <span className="absolute -left-[1.85rem] top-0">
                  <TimelineIcon entry={entry} />
                </span>
                <p className="text-xs text-text-secondary">
                  <span className="font-medium text-gray-800">
                    {entry.user_name || user?.name || 'System'}
                  </span>
                  <span className="mx-1">·</span>
                  {formatWhen(entry.created_at)}
                </p>
                <p
                  className={clsx(
                    'mt-1 rounded-lg px-3 py-2 text-sm text-gray-900',
                    entry.kind === 'comment' ? 'bg-gray-50 border border-border' : 'bg-transparent'
                  )}
                >
                  {entry.description}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
