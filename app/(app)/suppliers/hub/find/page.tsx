'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { ArrowLeft, Building2, Check, Clock, Loader2, Search } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { ListPageHeader } from '@/components/layout/ListPageHeader';
import { useAuthorizationGuard } from '@/hooks/useAuthorizationGuard';
import { AccessDenied } from '@/components/common/AccessDenied';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { Input } from '@/components/ui/Input';
import { buildApiUrl } from '@/lib/api-helpers';

interface DirectoryRow {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  gstin: string | null;
  profile_summary: string | null;
  featured_categories: string[] | null;
  connection: 'connected' | 'requested' | null;
}

export default function FindSuppliersPage() {
  const { business, user } = useAuth();
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<DirectoryRow[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);

  const { status: authStatus } = useAuthorizationGuard({
    resource: 'purchases',
    action: 'read',
    skipCheck: !user?.id || !business?.id,
  });

  const load = useCallback(async () => {
    if (!business?.id) return;
    setLoading(true);
    try {
      const url = buildApiUrl('/api/suppliers/hub/directory', {
        q: q.trim() || undefined,
        page,
        limit: 20,
      });
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to load directory');
      const data = await res.json();
      setRows(data.businesses || []);
      setTotalPages(data.pagination?.totalPages ?? 0);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [business?.id, q, page]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [q]);

  if (authStatus === 'loading') {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-100px)]">
        <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
      </div>
    );
  }

  if (authStatus === 'denied') {
    return <AccessDenied />;
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="space-y-2">
        <Link href="/suppliers/hub" className="inline-flex items-center gap-1 text-sm font-medium text-primary-600 hover:underline">
          <ArrowLeft className="h-4 w-4" />
          Supplier Hub
        </Link>
        <ListPageHeader
          title="Find suppliers"
          description="Wholesalers and distributors on Khatario. Ask to connect, and once they accept, their bills and new arrivals come to you."
        />
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Name, city or GSTIN"
          className="pl-10"
        />
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
        </div>
      ) : rows.length === 0 ? (
        <Card padding="lg" className="text-center">
          <p className="font-medium text-text-primary">{q.trim() ? `No suppliers match “${q.trim()}”` : 'No suppliers listed yet'}</p>
          <p className="mt-1 text-sm text-text-secondary">
            Your supplier may not be listed yet. Ask them to list themselves under Settings → Suppliers
            directory, then search again.
          </p>
        </Card>
      ) : (
        <ul className="space-y-3">
          {rows.map((b) => (
            <li key={b.id}>
              <Link href={`/suppliers/hub/${b.id}`}>
                <Card
                  padding="md"
                  className="hover:border-primary-200 transition cursor-pointer"
                >
                  <div className="flex items-start gap-3">
                    <Building2 className="w-5 h-5 text-primary-500 shrink-0 mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-semibold text-text-primary">{b.name}</p>
                        {b.connection === 'connected' && (
                          <Chip variant="success" className="inline-flex items-center gap-1">
                            <Check className="h-3 w-3" /> Connected
                          </Chip>
                        )}
                        {b.connection === 'requested' && (
                          <Chip variant="warning" className="inline-flex items-center gap-1">
                            <Clock className="h-3 w-3" /> Request sent
                          </Chip>
                        )}
                      </div>
                      <p className="text-sm text-text-secondary">
                        {[b.city, b.state].filter(Boolean).join(', ') || '—'}
                        {b.gstin ? ` · ${b.gstin}` : ''}
                      </p>
                      {b.profile_summary && (
                        <p className="text-sm text-text-muted mt-2 line-clamp-2">{b.profile_summary}</p>
                      )}
                      {b.featured_categories && b.featured_categories.length > 0 && (
                        <p className="text-xs text-text-muted mt-1">
                          {b.featured_categories.slice(0, 5).join(' · ')}
                        </p>
                      )}
                    </div>
                  </div>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {totalPages > 1 && (
        <div className="flex gap-2 justify-center">
          <Button
            variant="secondary"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Previous
          </Button>
          <span className="text-sm text-text-secondary self-center">Page {page}</span>
          <Button
            variant="secondary"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
