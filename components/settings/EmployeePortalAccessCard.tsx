'use client';

import { useCallback, useEffect, useState } from 'react';
import { Copy, ExternalLink, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { getAppPublicOrigin } from '@/lib/customer-surface/urls';
import { useToastContext } from '@/contexts/ToastContext';

type SurfacePayload = {
  portal_slug: string;
  portal_url: string;
  employee_portal_url: string;
  employee_portal_enabled: boolean;
};

export function EmployeePortalAccessCard() {
  const toast = useToastContext();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [data, setData] = useState<SurfacePayload | null>(null);
  const [slugDraft, setSlugDraft] = useState('');
  const [copied, setCopied] = useState<'employee' | 'customer' | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/settings/customer-surface', { credentials: 'include' });
      if (!res.ok) return;
      const json = await res.json();
      setData(json);
      setSlugDraft(json.portal_slug ?? '');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const origin = getAppPublicOrigin();
  const slugChanged =
    data?.portal_slug && slugDraft.trim().toLowerCase() !== data.portal_slug.toLowerCase();

  async function saveSlug() {
    setSaving(true);
    try {
      const res = await fetch('/api/settings/customer-surface', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ portal_slug: slugDraft }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || 'Could not save portal address');
        return;
      }
      setData(json);
      setSlugDraft(json.portal_slug ?? '');
      toast.success('Portal address updated');
    } catch {
      toast.error('Could not save portal address');
    } finally {
      setSaving(false);
    }
  }

  async function copyLink(url: string, kind: 'employee' | 'customer') {
    await navigator.clipboard.writeText(url);
    setCopied(kind);
    setTimeout(() => setCopied(null), 2000);
  }

  if (loading) {
    return (
      <Card className="flex items-center gap-2 p-4 text-sm text-text-secondary">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading public portal links…
      </Card>
    );
  }

  return (
    <Card className="space-y-4 p-4">
      <div>
        <h3 className="text-sm font-semibold text-text-primary">Public portal links</h3>
        <p className="mt-1 text-sm text-text-secondary">
          Choose a unique address for your employee portal and customer portal. Share these links
          with staff and customers — they do not use the admin app login.
        </p>
      </div>

      <div className="space-y-2">
        <label htmlFor="portal-slug" className="block text-sm font-medium text-text-primary">
          Portal address
        </label>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
          <div className="flex min-w-0 flex-1 items-center rounded-lg border border-border bg-gray-50 px-3 py-2">
            <span className="shrink-0 text-sm text-text-muted">{origin.replace(/^https?:\/\//, '')}/</span>
            <input
              id="portal-slug"
              value={slugDraft}
              onChange={(e) =>
                setSlugDraft(
                  e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '')
                )
              }
              className="min-w-0 flex-1 bg-transparent text-sm text-text-primary outline-none"
              placeholder="your-company"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <Button
            type="button"
            variant="secondary"
            disabled={saving || !slugDraft.trim() || !slugChanged}
            onClick={() => void saveSlug()}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save address'}
          </Button>
        </div>
        <p className="text-xs text-text-muted">
          Lowercase letters, numbers, and hyphens only. If &quot;acme-corp&quot; is taken, try{' '}
          <span className="font-mono">acme-corp-mumbai</span> or <span className="font-mono">acme-corp-2</span>.
        </p>
        {slugChanged ? (
          <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5">
            Changing the address will break old portal links. Update bookmarks and re-share invites
            after saving.
          </p>
        ) : null}
      </div>

      {data?.employee_portal_enabled && data.employee_portal_url ? (
        <div className="rounded-md border border-border bg-gray-50 p-3">
          <p className="text-xs font-medium text-text-secondary">Employee portal</p>
          <p className="mt-1 break-all text-sm text-text-primary">{data.employee_portal_url}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => void copyLink(data.employee_portal_url, 'employee')}
            >
              <Copy className="mr-1 h-3.5 w-3.5" />
              {copied === 'employee' ? 'Copied' : 'Copy link'}
            </Button>
            <a
              href={data.employee_portal_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm font-medium text-primary-600 hover:text-primary-700"
            >
              Open
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        </div>
      ) : (
        <p className="text-sm text-text-secondary">
          Employee portal is not on your plan.{' '}
          <Link href="/settings/subscription" className="link-primary">
            View subscription
          </Link>
        </p>
      )}

      {data?.portal_url ? (
        <div className="rounded-md border border-border bg-gray-50 p-3">
          <p className="text-xs font-medium text-text-secondary">Customer portal</p>
          <p className="mt-1 break-all text-sm text-text-primary">{data.portal_url}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => void copyLink(data.portal_url, 'customer')}
            >
              <Copy className="mr-1 h-3.5 w-3.5" />
              {copied === 'customer' ? 'Copied' : 'Copy link'}
            </Button>
            <a
              href={data.portal_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm font-medium text-primary-600 hover:text-primary-700"
            >
              Open
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
