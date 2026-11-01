'use client';

import React, { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Loader2, Send } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useToastContext } from '@/contexts/ToastContext';

type Comment = {
  id: string;
  body: string;
  created_at: string;
  mine: boolean;
  business_name: string;
  user_name: string | null;
};

/** Messages between buyer and supplier on one Supplier Hub order. */
export function SupplyOrderComments({ orderId, otherName }: { orderId: string; otherName: string }) {
  const toast = useToastContext();
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/supply-orders/${orderId}/comments`, { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (res.ok) setComments(data.comments || []);
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    load();
  }, [load]);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    const body = draft.trim();
    if (!body) return;
    setSending(true);
    try {
      const res = await fetch(`/api/supply-orders/${orderId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to send');
      setComments((prev) => [...prev, data.comment]);
      setDraft('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send');
    } finally {
      setSending(false);
    }
  };

  return (
    <Card padding="md" className="space-y-3">
      <h2 className="text-base font-semibold text-text-primary">Messages</h2>
      {loading ? (
        <Loader2 className="h-5 w-5 animate-spin text-primary-500" />
      ) : comments.length === 0 ? (
        <p className="text-sm text-text-secondary">
          Ask {otherName} about delivery, rates or a substitute item. They see it here and get a notice.
        </p>
      ) : (
        <ul className="space-y-2">
          {comments.map((c) => (
            <li key={c.id} className={c.mine ? 'flex justify-end' : 'flex justify-start'}>
              <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${c.mine ? 'bg-primary-50' : 'bg-gray-100'}`}>
                <p className="whitespace-pre-wrap text-text-primary">{c.body}</p>
                <p className="mt-1 text-xs text-text-secondary">
                  {c.mine ? 'You' : c.business_name}
                  {c.user_name ? ` · ${c.user_name}` : ''} ·{' '}
                  {new Date(c.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={send} className="flex gap-2">
        <label htmlFor="order-message" className="sr-only">
          Message
        </label>
        <input
          id="order-message"
          type="text"
          value={draft}
          maxLength={2000}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={`Message ${otherName}`}
          className="min-w-0 flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm"
        />
        <Button type="submit" disabled={sending || !draft.trim()}>
          <Send className="mr-1.5 h-4 w-4" aria-hidden="true" />
          Send
        </Button>
      </form>
    </Card>
  );
}
