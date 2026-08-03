'use client';

export const dynamic = 'force-dynamic';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, Save, Store, Trash2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useAuthorizationGuard } from '@/hooks/useAuthorizationGuard';
import { AccessDenied } from '@/components/common/AccessDenied';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useToastContext } from '@/contexts/ToastContext';
import { buildApiUrl } from '@/lib/api-helpers';
import { SettingsPageShell } from '@/components/settings/SettingsPageShell';
import { SettingsFloatingSaveBar } from '@/components/settings/SettingsFloatingSaveBar';
import { STACK_PAGE_CLASS, STACK_SECTION_CLASS } from '@/lib/page-layout';
import { clsx } from 'clsx';

type Visibility = 'hidden' | 'directory' | 'link_only';

interface ListingRow {
  id: string;
  item_id: string;
  audience: string;
  display_name: string | null;
  moq: string | null;
  lead_time_text: string | null;
  price_display: string;
  from_amount: string | null;
  sort_order: number;
  is_active: boolean;
  item_name: string;
  item_unit: string;
  item_code: string | null;
}

const VISIBILITY_OPTIONS: { value: Visibility; label: string }[] = [
  { value: 'hidden', label: 'Hidden — not discoverable' },
  { value: 'link_only', label: 'Link only — profile by URL, not listed in search' },
  { value: 'directory', label: 'Directory — searchable in Suppliers Hub' },
];

export default function SuppliersDirectorySettingsPage() {
  const { business, user } = useAuth();
  const toast = useToastContext();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [summary, setSummary] = useState('');
  const [categories, setCategories] = useState('');
  const [slug, setSlug] = useState('');
  const [visibility, setVisibility] = useState<Visibility>('hidden');
  const [listings, setListings] = useState<ListingRow[]>([]);
  const [incoming, setIncoming] = useState<
    Array<{ id: string; status: string; counterparty_name: string; created_at: string; message?: string | null }>
  >([]);
  const [itemSearch, setItemSearch] = useState('');
  const [itemHits, setItemHits] = useState<Array<{ id: string; name: string; code: string | null; unit: string }>>(
    []
  );
  const [adding, setAdding] = useState(false);

  const { status: authStatus } = useAuthorizationGuard({
    resource: 'settings',
    action: 'read',
    skipCheck: !user?.id || !business?.id,
  });

  const load = useCallback(async () => {
    if (!business?.id) return;
    setLoading(true);
    try {
      const dUrl = buildApiUrl('/api/suppliers/hub/discovery', {
        business_id: business.id,
        user_id: user?.id,
      });
      const dRes = await fetch(dUrl, { cache: 'no-store' });
      if (dRes.ok) {
        const dj = await dRes.json();
        const disc = dj.discovery;
        setSummary(disc.profile_summary || '');
        setCategories((disc.featured_categories || []).join(', '));
        setSlug(disc.public_slug || '');
        setVisibility(disc.visibility || 'hidden');
      }

      const lUrl = buildApiUrl('/api/suppliers/hub/published-listings', {
        business_id: business.id,
        user_id: user?.id,
      });
      const lRes = await fetch(lUrl, { cache: 'no-store' });
      if (lRes.ok) {
        const lj = await lRes.json();
        setListings(lj.listings || []);
      }

      const cUrl = buildApiUrl('/api/suppliers/hub/connection-requests', {
        business_id: business.id,
        user_id: user?.id,
      });
      const cRes = await fetch(cUrl, { cache: 'no-store' });
      if (cRes.ok) {
        const cj = await cRes.json();
        const inc = (cj.incoming || []).filter((r: { status: string }) => r.status === 'pending');
        setIncoming(inc);
      }
    } finally {
      setLoading(false);
    }
  }, [business?.id, user?.id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!business?.id || itemSearch.trim().length < 2) {
      setItemHits([]);
      return;
    }
    const t = setTimeout(async () => {
      const url = buildApiUrl('/api/items', {
        business_id: business.id,
        user_id: user?.id,
        search: itemSearch.trim(),
        limit: 15,
      });
      const res = await fetch(url, { cache: 'no-store' });
      if (res.ok) {
        const j = await res.json();
        setItemHits(j.items || j.data || []);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [itemSearch, business?.id, user?.id]);

  async function saveDiscovery() {
    if (!business?.id || !user?.id) return;
    setSaving(true);
    try {
      const res = await fetch('/api/suppliers/hub/discovery', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: business.id,
          visibility,
          profile_summary: summary.trim() || null,
          featured_categories: categories,
          public_slug: slug.trim() || null,
          updated_by_user_id: user.id,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(j.error || 'Save failed');
        return;
      }
      toast.success('Directory settings saved');
      load();
    } finally {
      setSaving(false);
    }
  }

  async function resolveRequest(id: string, action: 'accept' | 'decline') {
    if (!user?.id) return;
    const res = await fetch(`/api/suppliers/hub/connection-requests/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        business_id: business?.id,
        action,
        updated_by_user_id: user.id,
      }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(j.error || 'Update failed');
      return;
    }
    toast.success(action === 'accept' ? 'Connection accepted' : 'Request declined');
    load();
  }

  async function addListing(itemId: string) {
    if (!business?.id || !user?.id) return;
    setAdding(true);
    try {
      const res = await fetch('/api/suppliers/hub/published-listings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: business.id,
          item_id: itemId,
          audience: 'public_preview',
          price_display: 'on_request',
          created_by_user_id: user.id,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(j.error || 'Could not add listing');
        return;
      }
      toast.success('Listing published');
      setItemSearch('');
      setItemHits([]);
      load();
    } finally {
      setAdding(false);
    }
  }

  async function removeListing(id: string) {
    if (!user?.id || !business?.id) return;
    const url = buildApiUrl(`/api/suppliers/hub/published-listings/${id}`, {
      business_id: business.id,
      user_id: user.id,
      updated_by_user_id: user.id,
    });
    const res = await fetch(url, { method: 'DELETE' });
    if (!res.ok) {
      toast.error('Could not remove');
      return;
    }
    toast.success('Removed');
    load();
  }

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
    <SettingsPageShell
      title="Suppliers directory"
      description="Let other businesses find you in the Suppliers Hub and request a connection."
      icon={Store}
    >
      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
        </div>
      ) : (
        <>
          <div className={STACK_PAGE_CLASS}>
            <section>
              <h3 className="settings-section-title">Visibility</h3>
              <div className={clsx(STACK_SECTION_CLASS, 'max-w-2xl')}>
                <div className="space-y-2">
                  {VISIBILITY_OPTIONS.map((opt) => (
                    <label key={opt.value} className="flex items-start gap-2.5 cursor-pointer">
                      <input
                        type="radio"
                        name="vis"
                        checked={visibility === opt.value}
                        onChange={() => setVisibility(opt.value)}
                        className="mt-0.5 h-4 w-4 shrink-0 text-primary-600 focus:ring-primary-500"
                      />
                      <span className="type-body-sm text-text-primary">{opt.label}</span>
                    </label>
                  ))}
                </div>

                <div>
                  <label htmlFor="profile-summary" className="type-label mb-1.5 block">
                    Profile summary
                  </label>
                  <textarea
                    id="profile-summary"
                    className="input min-h-[100px] resize-y"
                    value={summary}
                    onChange={(e) => setSummary(e.target.value)}
                    placeholder="Describe what you supply (required for directory listing, min 10 characters)."
                  />
                </div>

                <Input
                  label="Featured categories"
                  value={categories}
                  onChange={(e) => setCategories(e.target.value)}
                  placeholder="e.g. Groceries, Beverages (comma-separated)"
                />

                <div>
                  <Input
                    label="Public URL slug (optional)"
                    value={slug}
                    onChange={(e) => setSlug(e.target.value)}
                    placeholder="e.g. prem-traders"
                  />
                  {slug ? (
                    <p className="mt-1.5 text-xs text-text-muted">
                      Slug saved for future vanity URLs. Profile link today uses your business id:{' '}
                      <Link href={`/suppliers/hub/${business?.id}`} className="link-primary">
                        /suppliers/hub/{business?.id?.slice(0, 8)}…
                      </Link>
                    </p>
                  ) : null}
                </div>
              </div>
            </section>

            <section>
              <h3 className="settings-section-title">Incoming connection requests</h3>
              <p className="type-body-secondary mb-4 max-w-2xl">
                When a buyer sends a request, accept it to create their supplier record linked to your
                business.
              </p>
              {incoming.length === 0 ? (
                <p className="type-body-secondary text-text-muted">No pending requests.</p>
              ) : (
                <ul className={STACK_SECTION_CLASS}>
                  {incoming.map((r) => (
                    <li
                      key={r.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface p-3"
                    >
                      <div className="min-w-0">
                        <p className="type-label text-text-primary">{r.counterparty_name}</p>
                        {r.message ? (
                          <p className="mt-1 text-xs text-text-secondary whitespace-pre-wrap">{r.message}</p>
                        ) : null}
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" variant="primary" onClick={() => resolveRequest(r.id, 'accept')}>
                          Accept
                        </Button>
                        <Button size="sm" variant="secondary" onClick={() => resolveRequest(r.id, 'decline')}>
                          Decline
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <h3 className="settings-section-title">Published listings (public preview)</h3>
              <p className="type-body-secondary mb-4 max-w-2xl">
                Add up to 20 items shown to buyers browsing the hub. Link-only customers see the same preview;
                after connection, buyers may also see “linked only” lines if you add them (via API for now).
              </p>

              <div className={clsx(STACK_SECTION_CLASS, 'max-w-2xl')}>
                <Input
                  value={itemSearch}
                  onChange={(e) => setItemSearch(e.target.value)}
                  placeholder="Search your items to publish…"
                />
                {itemHits.length > 0 ? (
                  <ul className="max-h-48 divide-y divide-border overflow-auto rounded-lg border border-border bg-surface">
                    {itemHits.map((it) => (
                      <li
                        key={it.id}
                        className="flex items-center justify-between gap-2 px-3 py-2 type-body-sm"
                      >
                        <span className="min-w-0 truncate text-text-primary">
                          {it.name}
                          {it.code ? ` (${it.code})` : ''}
                        </span>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={adding}
                          onClick={() => addListing(it.id)}
                        >
                          Add
                        </Button>
                      </li>
                    ))}
                  </ul>
                ) : null}

                <ul className="space-y-2">
                  {listings
                    .filter((l) => l.audience === 'public_preview')
                    .map((l) => (
                      <li
                        key={l.id}
                        className="flex items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 py-2 type-body-sm"
                      >
                        <span className="min-w-0 truncate text-text-primary">
                          {l.display_name || l.item_name} ({l.item_unit})
                        </span>
                        <Button variant="ghost" size="sm" onClick={() => removeListing(l.id)} aria-label="Remove">
                          <Trash2 className="h-4 w-4 text-red-600" />
                        </Button>
                      </li>
                    ))}
                </ul>
              </div>
            </section>

            <p className="type-body-secondary">
              Browse the directory as a buyer:{' '}
              <Link href="/suppliers/hub" className="link-primary">
                Suppliers Hub
              </Link>
            </p>
          </div>

          <SettingsFloatingSaveBar>
            <Button
              variant="primary"
              onClick={saveDiscovery}
              disabled={saving}
              isLoading={saving}
              className="w-full sm:w-auto"
            >
              <Save className="w-4 h-4 mr-2" />
              Save Changes
            </Button>
          </SettingsFloatingSaveBar>
        </>
      )}
    </SettingsPageShell>
  );
}
