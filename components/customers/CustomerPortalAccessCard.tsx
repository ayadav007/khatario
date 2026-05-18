'use client';

import { useEffect, useState } from 'react';
import { Copy, ExternalLink, Loader2 } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useToastContext } from '@/contexts/ToastContext';

interface CustomerPortalAccessCardProps {
  customerId: string;
  customerEmail?: string | null;
  initialEnabled?: boolean;
}

export function CustomerPortalAccessCard({
  customerId,
  customerEmail,
  initialEnabled = false,
}: CustomerPortalAccessCardProps) {
  const toast = useToastContext();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [portalUrl, setPortalUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setEnabled(initialEnabled);
  }, [initialEnabled, customerId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/settings/customer-surface', { credentials: 'include' });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (data.portal_url) setPortalUrl(data.portal_url);
      } catch {
        // non-fatal
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function updatePortal(next: boolean, sendInvite: boolean) {
    if (next && !customerEmail?.trim()) {
      toast.warning('Add an email on this customer before enabling the portal.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/customers/${customerId}/portal`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ portal_enabled: next, send_invite: sendInvite }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Failed to update portal access');
        return;
      }
      setEnabled(next);
      if (data.portal_url) setPortalUrl(data.portal_url);
      toast.success(
        next
          ? sendInvite
            ? 'Portal enabled and invite sent'
            : 'Portal enabled for this customer'
          : 'Portal access disabled'
      );
    } catch {
      toast.error('Failed to update portal access');
    } finally {
      setBusy(false);
    }
  }

  async function copyPortalLink() {
    if (!portalUrl) return;
    await navigator.clipboard.writeText(portalUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Card className="p-4">
      <h3 className="text-sm font-semibold text-text-primary">Customer portal</h3>
      <p className="mt-1 text-sm text-text-secondary">
        Let this customer sign in with their email to see all their bills with you.
      </p>

      {portalUrl ? (
        <div className="mt-3 rounded-md border border-border bg-gray-50 p-3">
          <p className="text-xs font-medium text-text-secondary">Your business portal link</p>
          <p className="mt-1 break-all text-sm text-text-primary">{portalUrl}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => void copyPortalLink()}>
              <Copy className="mr-1 h-3.5 w-3.5" />
              {copied ? 'Copied' : 'Copy link'}
            </Button>
            <a
              href={portalUrl}
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

      <label className="mt-4 flex cursor-pointer items-center gap-3">
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-border text-primary-600 focus:ring-primary-500"
          checked={enabled}
          disabled={busy}
          onChange={(e) => void updatePortal(e.target.checked, false)}
        />
        <span className="text-sm text-text-primary">Enable customer portal</span>
      </label>

      {enabled && portalUrl ? (
        <p className="mt-2 text-xs text-text-secondary break-all">
          Portal:{' '}
          <a href={portalUrl} target="_blank" rel="noopener noreferrer" className="link-primary">
            {portalUrl}
          </a>
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        {enabled && customerEmail ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => void updatePortal(true, true)}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Send invite email'}
          </Button>
        ) : null}
        {portalUrl ? (
          <a
            href={portalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm font-medium text-primary-600 hover:text-primary-700"
          >
            Open portal
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        ) : null}
      </div>
    </Card>
  );
}
