'use client';

import { useCallback, useEffect, useState } from 'react';
import { BellRing, Loader2, Smartphone } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

type OwnerLinkState = {
  transport: 'cloud' | 'baileys';
  businessPhone: string | null;
  qrConnected: boolean;
  link: null | {
    linkedPhone: string | null;
    linkedAt: string | null;
    selfChat: boolean;
    code: string | null;
    codeExpiresAt: string | null;
    dailySummaryEnabled: boolean;
    dailySummaryTime: string;
    lastSummarySentOn: string | null;
    lastSummaryError: string | null;
    lastOwnerMessageAt: string | null;
    templateStatus: string | null;
  };
};

const API = '/api/whatsapp/owner-link';

function maskPhone(p: string): string {
  const d = p.replace(/\D/g, '');
  if (d.length <= 4) return p;
  const country = d.length > 10 ? `+${d.slice(0, -10)} ` : '';
  return `${country}••••••${d.slice(-4)}`;
}

const TEMPLATE_LABEL: Record<string, string> = {
  approved: 'Approved',
  pending: 'Waiting for Meta approval',
  rejected: 'Rejected by Meta',
  paused: 'Paused by Meta',
  disabled: 'Disabled by Meta',
  missing: 'Not created',
};

/**
 * Settings > WhatsApp: link the owner's phone to the business's own WhatsApp number for business
 * figures on request and an evening summary. Renders nothing for anyone but the primary admin.
 */
export function OwnerUpdatesCard({ onToast }: { onToast?: (message: string, type: 'success' | 'error' | 'info') => void }) {
  const [state, setState] = useState<OwnerLinkState | null>(null);
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(API, { credentials: 'include' }).catch(() => null);
    if (!res || res.status === 403 || res.status === 401) {
      setHidden(true);
      return;
    }
    if (res.ok) setState((await res.json()) as OwnerLinkState);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Poll while a code is waiting, so the card flips to "Linked" when the message arrives.
  useEffect(() => {
    if (!state?.link?.code) return;
    const id = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(id);
  }, [state?.link?.code, load]);

  const call = async (method: 'POST' | 'PATCH', body: Record<string, unknown>, key: string) => {
    setBusy(key);
    try {
      const res = await fetch(API, {
        method,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error || 'Something went wrong');
      setState(data as OwnerLinkState);
      return data as OwnerLinkState & { test?: { sent: boolean; reason?: string; error?: string } };
    } catch (err) {
      onToast?.(err instanceof Error ? err.message : 'Something went wrong', 'error');
      return null;
    } finally {
      setBusy(null);
    }
  };

  if (hidden || !state) return null;
  const link = state.link;
  const linked = Boolean(link?.linkedPhone);
  const cloud = state.transport === 'cloud';
  const numberText = state.businessPhone ? `+${state.businessPhone.replace(/\D/g, '')}` : 'your business WhatsApp number';

  const sendTest = async () => {
    const data = await call('POST', { action: 'test_summary' }, 'test');
    const t = data?.test;
    if (!t) return;
    if (t.sent) onToast?.('Summary sent to your phone.', 'success');
    else if (t.reason === 'no_template')
      onToast?.('Send any message to your business number first (opens a 24-hour window), or create the summary template below.', 'info');
    else onToast?.(t.error || 'Could not send the summary.', 'error');
  };

  return (
    <Card padding="lg" className="space-y-4" data-testid="owner-updates-card">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-50 text-primary-600 dark:bg-primary-950/40">
          <BellRing className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <h3 className="text-lg font-semibold text-text-primary">Owner updates on WhatsApp</h3>
          <p className="mt-1 text-sm text-text-secondary">
            Ask &quot;sales today&quot; or &quot;who owes me the most&quot; from your phone and get the answer from your own business number,
            plus an evening summary. Only you (the primary admin) can link a phone.
          </p>
        </div>
      </div>

      {!cloud && !state.qrConnected ? (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          Connect your WhatsApp number first (QR below, or Meta Cloud API above).
        </p>
      ) : null}

      {linked ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
          <div className="flex items-center gap-2 text-sm">
            <Smartphone className="h-4 w-4 text-green-600" />
            <span className="font-medium text-text-primary">
              {link!.selfChat ? 'Linked: "Message yourself" chat' : `Linked: ${maskPhone(link!.linkedPhone!)}`}
            </span>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => void call('POST', { action: 'start' }, 'start')} disabled={!!busy}>
              Change phone
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void call('POST', { action: 'unlink' }, 'unlink')} disabled={!!busy}>
              Unlink
            </Button>
          </div>
        </div>
      ) : null}

      {link?.code ? (
        <div className="rounded-lg border border-primary-200 bg-primary-50 px-4 py-3 text-sm dark:border-primary-800 dark:bg-primary-950/30">
          <p className="text-text-primary">
            From your phone, send this message to <strong>{numberText}</strong>:
          </p>
          <p className="my-2 select-all font-mono text-2xl font-bold tracking-widest text-primary-700 dark:text-primary-300">LINK {link.code}</p>
          <p className="text-xs text-text-muted">
            {cloud
              ? 'The code expires in 15 minutes.'
              : 'If your personal number is the business number, send it in the "Message yourself" chat. The code expires in 15 minutes.'}
          </p>
          <div className="mt-2 flex items-center gap-2 text-xs text-text-muted">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Waiting for your message…
            <button type="button" className="underline" onClick={() => void call('POST', { action: 'cancel_code' }, 'cancel')}>
              Cancel
            </button>
          </div>
        </div>
      ) : !linked ? (
        <Button onClick={() => void call('POST', { action: 'start' }, 'start')} isLoading={busy === 'start'} disabled={!!busy}>
          Link my phone
        </Button>
      ) : null}

      {linked && link ? (
        <div className="space-y-3 border-t border-border pt-4">
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex items-center gap-2 text-sm text-text-primary">
              <input
                type="checkbox"
                checked={link.dailySummaryEnabled}
                onChange={(e) => void call('PATCH', { dailySummaryEnabled: e.target.checked }, 'toggle')}
                disabled={!!busy}
                className="h-4 w-4 rounded border-border"
              />
              Evening summary at
            </label>
            <input
              type="time"
              value={link.dailySummaryTime}
              onChange={(e) => void call('PATCH', { dailySummaryTime: e.target.value }, 'time')}
              disabled={!!busy || !link.dailySummaryEnabled}
              className="rounded-md border border-border bg-white px-2 py-1 text-sm dark:bg-slate-800"
              aria-label="Summary time"
            />
            <span className="text-xs text-text-muted">Indian time</span>
            <Button variant="secondary" size="sm" onClick={() => void sendTest()} isLoading={busy === 'test'} disabled={!!busy}>
              Send test now
            </Button>
          </div>
          {link.lastSummarySentOn ? (
            <p className="text-xs text-text-muted">
              Last summary: {link.lastSummarySentOn}
              {link.lastSummaryError && link.lastSummaryError !== 'template_pending' ? ` (failed: ${link.lastSummaryError})` : ''}
            </p>
          ) : null}

          {cloud ? (
            <div className="rounded-lg bg-surface-muted px-3 py-2 text-xs text-text-secondary dark:bg-slate-800/50">
              <p>
                Meta only allows a free-form message within 24 hours of your last message to the business number. Outside that window
                the summary uses an approved template on your own WhatsApp Business Account.
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span>
                  Summary template: <strong>{TEMPLATE_LABEL[link.templateStatus ?? 'missing'] ?? link.templateStatus}</strong>
                </span>
                {link.templateStatus && link.templateStatus !== 'missing' ? (
                  <Button variant="ghost" size="sm" onClick={() => void call('POST', { action: 'refresh_template' }, 'refresh')} disabled={!!busy}>
                    Check status
                  </Button>
                ) : (
                  <Button variant="secondary" size="sm" onClick={() => void call('POST', { action: 'create_template' }, 'template')} isLoading={busy === 'template'} disabled={!!busy}>
                    Create summary template
                  </Button>
                )}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
