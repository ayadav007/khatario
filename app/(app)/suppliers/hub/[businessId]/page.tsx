'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  ArrowLeft,
  Building2,
  Loader2,
  Link2,
  Package,
  Send,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useAuthorizationGuard } from '@/hooks/useAuthorizationGuard';
import { AccessDenied } from '@/components/common/AccessDenied';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useToastContext } from '@/contexts/ToastContext';
import { buildApiUrl } from '@/lib/api-helpers';

interface ProfilePayload {
  business: {
    id: string;
    name: string;
    city: string | null;
    state: string | null;
    gstin: string | null;
  };
  discovery: {
    visibility: string;
    profile_summary: string | null;
    featured_categories: string[];
  };
  viewer: {
    is_linked: boolean;
    pending_request_id: string | null;
    supplier_record_id: string | null;
  };
  listings: Array<{
    id: string;
    item_id: string;
    audience: string;
    display_name: string | null;
    moq: string | null;
    lead_time_text: string | null;
    price_display: string;
    from_amount: string | null;
    item_name: string;
    item_unit: string;
    item_code: string | null;
  }>;
}

export default function SupplierHubProfilePage() {
  const params = useParams();
  const businessId = params.businessId as string;
  const { business, user } = useAuth();
  const toast = useToastContext();
  const [data, setData] = useState<ProfilePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const { status: authStatus } = useAuthorizationGuard({
    resource: 'purchases',
    action: 'read',
    skipCheck: !user?.id || !business?.id,
  });

  const load = useCallback(async () => {
    if (!business?.id || !businessId) return;
    setLoading(true);
    try {
      const url = buildApiUrl(`/api/suppliers/hub/profile/${businessId}`, {
        business_id: business.id,
        user_id: user?.id,
      });
      const res = await fetch(url, { cache: 'no-store' });
      if (res.status === 404) {
        setData(null);
        return;
      }
      if (!res.ok) throw new Error('Failed to load profile');
      setData(await res.json());
    } catch {
      setData(null);
      toast.error('Could not load supplier profile');
    } finally {
      setLoading(false);
    }
  }, [business?.id, businessId, user?.id, toast]);

  useEffect(() => {
    load();
  }, [load]);

  async function requestConnection() {
    if (!business?.id || !user?.id || !businessId) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/suppliers/hub/connection-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: business.id,
          supplier_business_id: businessId,
          message: msg.trim() || null,
          created_by_user_id: user.id,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(j.error || 'Request failed');
        return;
      }
      toast.success(
        j.existing ? 'You already have a pending request.' : 'Connection request sent.'
      );
      load();
    } finally {
      setSubmitting(false);
    }
  }

  if (authStatus === 'loading' || authStatus === 'denied') {
    if (authStatus === 'denied') return <AccessDenied />;
    return (
      <div className="flex items-center justify-center h-[calc(100vh-100px)]">
        <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-100px)]">
        <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-4">
        <Link href="/suppliers/hub">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Hub
          </Button>
        </Link>
        <Card padding="lg">Listing not found or not visible.</Card>
      </div>
    );
  }

  const { viewer } = data;
  const isSelf = business?.id === businessId;

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <Link href="/suppliers/hub">
        <Button variant="ghost" size="sm">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Hub
        </Button>
      </Link>

      <Card padding="md">
        <div className="flex items-start gap-3">
          <Building2 className="w-8 h-8 text-primary-500 shrink-0" />
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold text-text-primary">{data.business.name}</h1>
            <p className="text-sm text-text-secondary mt-1">
              {[data.business.city, data.business.state].filter(Boolean).join(', ')}
              {data.business.gstin ? ` · ${data.business.gstin}` : ''}
            </p>
            {data.discovery.profile_summary && (
              <p className="text-sm text-text-primary mt-4 whitespace-pre-wrap">
                {data.discovery.profile_summary}
              </p>
            )}
            {data.discovery.featured_categories?.length > 0 && (
              <p className="text-xs text-text-muted mt-2">
                {data.discovery.featured_categories.join(' · ')}
              </p>
            )}
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          {viewer.is_linked && viewer.supplier_record_id && (
            <Link href={`/suppliers/${viewer.supplier_record_id}`}>
              <Button variant="primary">
                <Link2 className="w-4 h-4 mr-2" />
                Open supplier
              </Button>
            </Link>
          )}
          {viewer.is_linked && (
            <Link href={`/purchases/requests`}>
              <Button variant="secondary">Purchase requests</Button>
            </Link>
          )}
        </div>

        {isSelf && (
          <p className="mt-4 text-sm text-amber-700 bg-amber-50 border border-amber-100 rounded-md px-3 py-2">
            You are viewing your own directory profile. Buyers see this when you enable visibility in
            Settings → Suppliers directory.
          </p>
        )}

        {!isSelf && !viewer.is_linked && (
          <div className="mt-6 p-4 bg-slate-50 rounded-lg border border-slate-200">
            {viewer.pending_request_id ? (
              <p className="text-sm text-text-secondary">
                Connection request pending — the supplier can accept it from their notifications
                and purchase settings.
              </p>
            ) : (
              <>
                <p className="text-sm font-medium text-text-primary mb-2">Request connection</p>
                <textarea
                  className="w-full text-sm border rounded-md p-2 mb-3 min-h-[72px]"
                  placeholder="Optional message to the supplier"
                  value={msg}
                  onChange={(e) => setMsg(e.target.value)}
                />
                <Button
                  variant="primary"
                  onClick={requestConnection}
                  disabled={submitting}
                  className="gap-2"
                >
                  {submitting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                  Send request
                </Button>
              </>
            )}
          </div>
        )}
      </Card>

      <div>
        <h2 className="text-lg font-semibold text-text-primary mb-3 flex items-center gap-2">
          <Package className="w-5 h-5" />
          Published listings
        </h2>
        {data.listings.length === 0 ? (
          <Card padding="md" className="text-text-secondary text-sm">
            No published items yet.
          </Card>
        ) : (
          <ul className="space-y-2">
            {data.listings.map((l) => (
              <li key={l.id}>
                <Card padding="sm" className="text-sm">
                  <div className="flex justify-between gap-4">
                    <div>
                      <p className="font-medium text-text-primary">
                        {l.display_name || l.item_name}
                      </p>
                      <p className="text-text-muted text-xs">
                        {l.item_code ? `${l.item_code} · ` : ''}
                        {l.item_unit}
                        {l.audience === 'linked_only' ? ' · Linked customers only' : ''}
                      </p>
                      {(l.moq || l.lead_time_text) && (
                        <p className="text-text-secondary text-xs mt-1">
                          {l.moq ? `MOQ ${l.moq}` : ''}
                          {l.moq && l.lead_time_text ? ' · ' : ''}
                          {l.lead_time_text || ''}
                        </p>
                      )}
                    </div>
                    <div className="text-right text-xs text-text-secondary shrink-0">
                      {l.price_display === 'on_request' && 'Price on request'}
                      {l.price_display === 'hidden' && 'Price hidden'}
                      {l.price_display === 'from_amount' &&
                        l.from_amount &&
                        `From ₹${Number(l.from_amount).toLocaleString('en-IN')}`}
                    </div>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
