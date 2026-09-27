'use client';

import { useCallback, useEffect, useState } from 'react';
import { Archive, Clock, Inbox, Loader2, Mail, MessageCircle, Phone } from 'lucide-react';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { useAuth } from '@/contexts/AuthContext';
import { SettingsPageShell } from '@/components/settings/SettingsPageShell';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

interface Enquiry {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  topic: string | null;
  message: string;
  source_path: string | null;
  status: 'new' | 'read' | 'replied' | 'archived';
  created_at: string;
}

const FILTERS: Array<{ key: string | null; label: string }> = [
  { key: null, label: 'Inbox' },
  { key: 'new', label: 'New' },
  { key: 'replied', label: 'Replied' },
  { key: 'archived', label: 'Archived' },
];

const STATUS_STYLE: Record<Enquiry['status'], string> = {
  new: 'bg-amber-100 text-amber-800',
  read: 'bg-gray-100 text-gray-700',
  replied: 'bg-green-100 text-green-800',
  archived: 'bg-gray-100 text-gray-500',
};

function formatDate(value: string) {
  return new Date(value).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function whatsappLink(e: Enquiry) {
  const digits = (e.phone ?? '').replace(/\D/g, '');
  const to = digits.length === 10 ? `91${digits}` : digits;
  return `https://wa.me/${to}?text=${encodeURIComponent(`Hi ${e.name}, thanks for reaching out. `)}`;
}

export default function StoreEnquiriesPage() {
  const { business } = useAuth();
  const [enquiries, setEnquiries] = useState<Enquiry[]>([]);
  const [total, setTotal] = useState(0);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string | null>(null);
  const [queryText, setQueryText] = useState('');
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!business?.id) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ business_id: business.id, page: String(page) });
      if (filter) params.set('status', filter);
      if (queryText.trim()) params.set('q', queryText.trim());
      const res = await fetch(`/api/settings/online-store/enquiries?${params}`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setEnquiries(data.enquiries);
        setTotal(data.total);
        setUnread(data.unread);
      }
    } finally {
      setLoading(false);
    }
  }, [business?.id, filter, page, queryText]);

  useEffect(() => {
    void load();
  }, [load]);

  const setStatus = useCallback(
    async (enquiry: Enquiry, status: Enquiry['status'], quiet = false) => {
      if (!business?.id || enquiry.status === status) return;
      const res = await fetch('/api/settings/online-store/enquiries', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_id: business.id, enquiry_id: enquiry.id, status }),
      });
      if (!res.ok) {
        if (!quiet) toast.error('Could not update enquiry');
        return;
      }
      setEnquiries((list) =>
        list
          .map((e) => (e.id === enquiry.id ? { ...e, status } : e))
          .filter((e) => (filter === 'archived' ? true : e.status !== 'archived')),
      );
      if (enquiry.status === 'new') setUnread((n) => Math.max(0, n - 1));
      if (!quiet) toast.success(status === 'archived' ? 'Archived' : 'Updated');
    },
    [business?.id, filter],
  );

  const toggle = (e: Enquiry) => {
    setOpenId((id) => (id === e.id ? null : e.id));
    if (e.status === 'new') void setStatus(e, 'read', true);
  };

  return (
    <SettingsPageShell
      title="Store Enquiries"
      description="Messages shoppers send from the Contact page of your online store."
      icon={Inbox}
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={queryText}
          onChange={(e) => { setQueryText(e.target.value); setPage(1); }}
          placeholder="Search name, phone, email or message"
          className="min-w-[200px] flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm"
        />
        {unread > 0 ? (
          <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800">
            {unread} new
          </span>
        ) : null}
      </div>

      <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
        {FILTERS.map((f) => (
          <button
            key={f.label}
            type="button"
            onClick={() => { setFilter(f.key); setPage(1); }}
            className={clsx(
              'flex-shrink-0 rounded-full px-4 py-1.5 text-sm font-medium transition-colors',
              filter === f.key ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      ) : enquiries.length === 0 ? (
        <div className="py-12 text-center">
          <Inbox className="mx-auto h-12 w-12 text-gray-300" />
          <p className="mt-3 text-sm text-gray-500">No enquiries here yet</p>
          <p className="mt-1 text-xs text-gray-400">
            Turn on the contact form in Online Store → Studio → Contact page → Contact form.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {enquiries.map((e) => {
            const open = openId === e.id;
            return (
              <Card key={e.id} className={clsx('p-4', e.status === 'new' && 'border-amber-200')}>
                <button type="button" className="block w-full text-left" onClick={() => toggle(e)}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={clsx('text-sm text-gray-900', e.status === 'new' ? 'font-bold' : 'font-medium')}>
                          {e.name}
                        </span>
                        <span className={clsx('rounded-full px-2 py-0.5 text-xs font-medium capitalize', STATUS_STYLE[e.status])}>
                          {e.status}
                        </span>
                        {e.topic ? (
                          <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                            {e.topic}
                          </span>
                        ) : null}
                      </div>
                      <p className={clsx('mt-1 text-sm text-gray-600', !open && 'line-clamp-2')}>
                        {e.message}
                      </p>
                    </div>
                    <span className="flex flex-shrink-0 items-center gap-1 text-xs text-gray-400">
                      <Clock className="h-3 w-3" />
                      {formatDate(e.created_at)}
                    </span>
                  </div>
                </button>

                {open ? (
                  <div className="mt-3 space-y-3 border-t border-gray-100 pt-3">
                    <div className="flex flex-wrap gap-4 text-sm">
                      {e.phone ? (
                        <a href={`tel:${e.phone}`} className="flex items-center gap-1 text-blue-600 hover:underline">
                          <Phone className="h-3.5 w-3.5" />
                          {e.phone}
                        </a>
                      ) : null}
                      {e.email ? (
                        <a href={`mailto:${e.email}`} className="flex items-center gap-1 text-blue-600 hover:underline">
                          <Mail className="h-3.5 w-3.5" />
                          {e.email}
                        </a>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {e.phone ? (
                        <a
                          href={whatsappLink(e)}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() => void setStatus(e, 'replied', true)}
                          className="inline-flex items-center gap-1 rounded-lg border border-green-200 bg-green-50 px-3 py-1.5 text-xs font-medium text-green-700 hover:bg-green-100"
                        >
                          <MessageCircle className="h-3.5 w-3.5" />
                          Reply on WhatsApp
                        </a>
                      ) : null}
                      {e.status !== 'replied' ? (
                        <Button size="sm" variant="secondary" type="button" onClick={() => void setStatus(e, 'replied')}>
                          Mark replied
                        </Button>
                      ) : null}
                      {e.status !== 'archived' ? (
                        <Button size="sm" variant="ghost" type="button" onClick={() => void setStatus(e, 'archived')}>
                          <Archive className="mr-1 h-3.5 w-3.5" />
                          Archive
                        </Button>
                      ) : (
                        <Button size="sm" variant="ghost" type="button" onClick={() => void setStatus(e, 'read')}>
                          Move to inbox
                        </Button>
                      )}
                    </div>
                  </div>
                ) : null}
              </Card>
            );
          })}

          {total > 20 ? (
            <div className="flex justify-center gap-2 pt-4">
              <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                Previous
              </Button>
              <span className="flex items-center px-3 text-sm text-gray-500">
                Page {page} of {Math.ceil(total / 20)}
              </span>
              <Button variant="ghost" size="sm" disabled={page * 20 >= total} onClick={() => setPage(page + 1)}>
                Next
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </SettingsPageShell>
  );
}
