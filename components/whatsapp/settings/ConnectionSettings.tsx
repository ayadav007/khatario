'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { QRCodeSVG } from 'qrcode.react';
import {
  Bell,
  Bot,
  CheckCircle2,
  ChevronRight,
  Download,
  FileText,
  Loader2,
  LogOut,
  QrCode,
  RefreshCw,
  ShoppingBag,
  type LucideIcon,
} from 'lucide-react';
import { clsx } from 'clsx';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';
import { useBotAddon } from './useBotAddon';
import { ConfirmDialog } from '@/components/whatsapp/ConfirmDialog';
import { MetaCloudCredentialsForm } from '@/components/whatsapp/MetaCloudCredentialsForm';
import { SettingsBlock, SettingsPageBody } from './SettingsBlock';
import { useMetaCloudCredentials } from './useMetaCloudCredentials';
import { WHATSAPP_SETTINGS_BASE } from './WhatsAppSettingsNav';

type ConnectionStatus = 'disconnected' | 'pending_qr' | 'connected' | 'error';

const QR_LIFETIME_SECONDS = 60;

function isExpiredError(err?: string | null) {
  return !!err && err.includes('expired');
}

function StatusPill({ status }: { status: ConnectionStatus }) {
  const map: Record<ConnectionStatus, { label: string; dot: string; text: string }> = {
    connected: { label: 'Connected', dot: 'bg-green-500', text: 'text-green-700 dark:text-green-300' },
    pending_qr: { label: 'Waiting for scan', dot: 'bg-amber-500', text: 'text-amber-700 dark:text-amber-300' },
    disconnected: { label: 'Not connected', dot: 'bg-gray-400', text: 'text-text-secondary' },
    error: { label: 'Connection problem', dot: 'bg-red-500', text: 'text-red-700 dark:text-red-300' },
  };
  const s = map[status] ?? map.disconnected;
  return (
    <span className={clsx('inline-flex items-center gap-1.5 text-sm font-medium', s.text)}>
      <span className={clsx('h-2.5 w-2.5 rounded-full', s.dot)} aria-hidden />
      {s.label}
    </span>
  );
}

function NextStep({ href, icon: Icon, title, body }: { href: string; icon: LucideIcon; title: string; body: string }) {
  return (
    <Link
      href={href}
      className="group flex items-start gap-3 rounded-lg border border-border p-3 transition-colors hover:border-primary-300 hover:bg-primary-50/40 dark:border-border-dark dark:hover:bg-primary-900/10"
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300">
        <Icon className="h-4 w-4" aria-hidden />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-text-primary">{title}</p>
        <p className="mt-0.5 text-xs text-text-secondary">{body}</p>
      </div>
      <ChevronRight className="mt-2 h-4 w-4 shrink-0 text-text-muted group-hover:text-primary-600" aria-hidden />
    </Link>
  );
}

export function ConnectionSettings() {
  const { business } = useAuth();
  const toast = useToastContext();
  const { hasBotAddon } = useBotAddon();
  const cloud = useMetaCloudCredentials();
  const [showCloudForm, setShowCloudForm] = useState(false);

  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [phoneNumber, setPhoneNumber] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [qrExpired, setQrExpired] = useState(false);
  const [qrCodeAge, setQrCodeAge] = useState(0);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [blocked, setBlocked] = useState<{ message: string; actionUrl: string } | null>(null);

  const isMountedRef = useRef(true);
  const qrGeneratedAtRef = useRef<number | null>(null);
  const initializedForRef = useRef<string | null>(null);

  const fetchStatus = useCallback(
    async (silent = false) => {
      if (!business?.id || !isMountedRef.current) return;
      if (!silent) setLoading(true);
      try {
        const res = await fetch(`/api/whatsapp/status?business_id=${business.id}`);
        const data = await res.json();
        if (!isMountedRef.current) return;
        if (res.status === 403) {
          setBlocked({
            message: data.error || 'WhatsApp is not available on your plan.',
            actionUrl: data.action_url || '/settings/subscription',
          });
          return;
        }
        setBlocked(null);
        const next: ConnectionStatus = data.status ?? 'disconnected';

        if (next === 'connected') {
          setQrCode(null);
          qrGeneratedAtRef.current = null;
          setQrCodeAge(0);
          setLastError(null);
        } else if (next === 'pending_qr') {
          // Keep the QR on screen between polls; only swap it when the server sends a new one.
          setQrCode((current) => {
            if (data.qr && current !== data.qr) {
              qrGeneratedAtRef.current = Date.now();
              setQrCodeAge(0);
              return data.qr;
            }
            if (current && !qrGeneratedAtRef.current) {
              qrGeneratedAtRef.current = Date.now();
              setQrCodeAge(0);
            }
            return current;
          });
        } else if (next === 'disconnected' && isExpiredError(data.lastError)) {
          setQrCode(null);
        }

        setStatus(next);
        setPhoneNumber(data.phoneNumber || null);
        setLastError(next === 'connected' ? null : data.lastError || null);
        setQrExpired(next === 'disconnected' && isExpiredError(data.lastError));
      } catch {
        if (isMountedRef.current && !silent) toast.error('Could not check the WhatsApp connection');
      } finally {
        if (isMountedRef.current && !silent) setLoading(false);
      }
    },
    [business?.id, toast],
  );

  const handleConnect = useCallback(async () => {
    if (!business?.id || !isMountedRef.current) return;
    setLoading(true);
    setQrExpired(false);
    try {
      const res = await fetch('/api/whatsapp/qr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_id: business.id }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      if (!isMountedRef.current) return;
      setStatus(data.status || 'pending_qr');
      if (data.qr) {
        setQrCode(data.qr);
        qrGeneratedAtRef.current = Date.now();
        setQrCodeAge(0);
      }
      setPhoneNumber(data.phoneNumber || null);
      setLastError(null);
    } catch (err) {
      if (isMountedRef.current) toast.error(err instanceof Error ? err.message : 'Failed to connect');
    } finally {
      if (isMountedRef.current) setLoading(false);
    }
  }, [business?.id, toast]);

  const handleDisconnect = useCallback(async () => {
    if (!business?.id) return;
    setLoading(true);
    try {
      await fetch('/api/whatsapp/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_id: business.id }),
      });
      await fetchStatus();
      toast.success('WhatsApp disconnected');
      setConfirmDisconnect(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to disconnect');
    } finally {
      if (isMountedRef.current) setLoading(false);
    }
  }, [business?.id, fetchStatus, toast]);

  const handleSyncMessages = useCallback(async () => {
    if (!business?.id) return;
    setSyncing(true);
    try {
      const res = await fetch('/api/whatsapp/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_id: business.id }),
      });
      const data = await res.json();
      if (data.success) {
        toast.info(data.message || 'Message sync started. Reconnecting…');
        setTimeout(() => {
          if (isMountedRef.current) void fetchStatus();
        }, 3000);
      } else {
        toast.error(data.error || 'Failed to sync messages');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to sync messages');
    } finally {
      if (isMountedRef.current) setSyncing(false);
    }
  }, [business?.id, fetchStatus, toast]);

  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (!id) return;
    if (id === 'wa-cloud') setShowCloudForm(true);
    requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    if (business?.id && initializedForRef.current !== business.id) {
      initializedForRef.current = business.id;
      void fetchStatus();
    }
    return () => {
      isMountedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [business?.id]);

  useEffect(() => {
    if (!business?.id) return;
    if (status !== 'pending_qr' && status !== 'connected') return;
    const interval = setInterval(() => void fetchStatus(true), status === 'pending_qr' ? 30_000 : 60_000);
    return () => clearInterval(interval);
  }, [business?.id, status, fetchStatus]);

  useEffect(() => {
    if (status !== 'pending_qr' || !qrCode) {
      setQrCodeAge(0);
      qrGeneratedAtRef.current = null;
      return;
    }
    if (!qrGeneratedAtRef.current) qrGeneratedAtRef.current = Date.now();
    const interval = setInterval(() => {
      if (qrGeneratedAtRef.current) setQrCodeAge(Math.floor((Date.now() - qrGeneratedAtRef.current) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [status, qrCode]);

  useEffect(() => {
    if (status === 'pending_qr' && qrCode && !loading && qrCodeAge === QR_LIFETIME_SECONDS) void handleConnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qrCodeAge]);

  const connected = status === 'connected';
  const cloudReady = !!cloud.credentials?.ready;
  const cloudStarted = !!(cloud.credentials?.waba_id || cloud.credentials?.phone_number_id);
  const cloudFormOpen = showCloudForm || (cloudStarted && !cloudReady);

  return (
    <SettingsPageBody>
      <SettingsBlock
        id="wa-number"
        title="Your WhatsApp number"
        description="Link the number your customers already message. Invoices, reminders and automatic replies are sent from it."
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <StatusPill status={status} />
            {connected && phoneNumber ? <p className="mt-1 text-sm text-text-secondary">+{phoneNumber.replace(/\D/g, '')}</p> : null}
            {!connected && lastError && !qrExpired ? <p className="mt-1 text-xs text-red-600">{lastError}</p> : null}
          </div>
          <Button variant="ghost" size="sm" onClick={() => void fetchStatus()} disabled={loading} aria-label="Refresh status">
            <RefreshCw className={clsx('h-4 w-4', loading && 'animate-spin')} />
          </Button>
        </div>

        <div className="border-t border-border pt-4 dark:border-border-dark">
          {blocked ? (
            <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
              <p className="flex-1 text-sm text-text-secondary">{blocked.message}</p>
              <Link href={blocked.actionUrl}>
                <Button variant="secondary">See options</Button>
              </Link>
            </div>
          ) : connected ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="mr-auto inline-flex items-center gap-1.5 text-sm text-text-secondary">
                <CheckCircle2 className="h-4 w-4 text-green-600" aria-hidden />
                Ready to send invoices and messages.
              </span>
              {hasBotAddon ? (
                <Button variant="secondary" size="sm" onClick={() => void handleSyncMessages()} disabled={syncing || loading}>
                  {syncing ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Download className="mr-1.5 h-4 w-4" />}
                  {syncing ? 'Syncing…' : 'Sync messages'}
                </Button>
              ) : null}
              <Button variant="secondary" size="sm" onClick={() => setConfirmDisconnect(true)} disabled={loading || syncing}>
                <LogOut className="mr-1.5 h-4 w-4" />
                Disconnect
              </Button>
            </div>
          ) : status === 'pending_qr' && qrCode ? (
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
              <div className="relative inline-block self-start rounded-lg border border-border bg-white p-3">
                <QRCodeSVG value={qrCode} size={184} level="L" includeMargin />
                {qrCodeAge >= QR_LIFETIME_SECONDS ? (
                  <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/40">
                    <Button size="sm" onClick={() => void handleConnect()} disabled={loading}>
                      <RefreshCw className="mr-1.5 h-4 w-4" /> New QR code
                    </Button>
                  </div>
                ) : null}
              </div>
              <div className="space-y-2 text-sm text-text-secondary">
                <p className="font-medium text-text-primary">Scan with the phone that has this number</p>
                <ol className="list-decimal space-y-1 pl-5">
                  <li>Open WhatsApp on your phone</li>
                  <li>Go to Settings, then Linked devices, then Link a device</li>
                  <li>Point the camera at this code</li>
                </ol>
                {qrCodeAge >= 50 && qrCodeAge < QR_LIFETIME_SECONDS ? (
                  <p className="text-xs font-medium text-amber-700">A fresh code loads in {QR_LIFETIME_SECONDS - qrCodeAge}s</p>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gray-100 text-text-muted dark:bg-slate-800">
                <QrCode className="h-5 w-5" aria-hidden />
              </div>
              <p className="flex-1 text-sm text-text-secondary">
                {qrExpired
                  ? 'The QR code expired before it was scanned. Get a new one and scan it within a minute.'
                  : 'You will scan a QR code with WhatsApp on your phone, the same way you link WhatsApp Web.'}
              </p>
              <Button onClick={() => void handleConnect()} disabled={loading}>
                {loading ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <QrCode className="mr-1.5 h-4 w-4" />}
                {qrExpired ? 'Get a new QR code' : 'Connect WhatsApp'}
              </Button>
            </div>
          )}
        </div>
      </SettingsBlock>

      <SettingsBlock
        id="wa-next"
        title="Set up what's sent"
        description="Once your number is linked, choose what Khatario does with it. Each step is optional."
      >
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          <NextStep
            href={`${WHATSAPP_SETTINGS_BASE}/notifications`}
            icon={Bell}
            title="Payment reminders"
            body="Remind customers before and after invoices fall due."
          />
          <NextStep
            href={`${WHATSAPP_SETTINGS_BASE}/ai-agent`}
            icon={Bot}
            title="AI agent"
            body="Answer customer questions and take orders automatically."
          />
          <NextStep
            href={`${WHATSAPP_SETTINGS_BASE}/shop`}
            icon={ShoppingBag}
            title="WhatsApp shop"
            body="Let customers browse items, send a cart and pay."
          />
          <NextStep
            href={`${WHATSAPP_SETTINGS_BASE}/templates`}
            icon={FileText}
            title="Message templates"
            body="Approved wording for invoices and order updates (Cloud API)."
          />
        </div>
      </SettingsBlock>

      <SettingsBlock
        id="wa-cloud"
        title="Meta Cloud API"
        description={
          <>
            Optional, for businesses with their own WhatsApp Business Account on Meta. Needed for approved templates,
            WhatsApp&apos;s built-in catalog and messaging customers outside the 24-hour window. The QR link above keeps working.
          </>
        }
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 text-sm">
            {!cloud.loaded ? (
              <span className="text-text-muted">Checking…</span>
            ) : cloudReady ? (
              <span className="inline-flex items-center gap-1.5 font-medium text-green-700 dark:text-green-300">
                <CheckCircle2 className="h-4 w-4" aria-hidden /> Connected. Templates can be submitted and sent.
              </span>
            ) : cloudStarted ? (
              <span className="font-medium text-amber-700 dark:text-amber-300">
                Incomplete. Missing: {(cloud.credentials?.missing || []).join(', ') || 'credentials'}
              </span>
            ) : (
              <span className="text-text-secondary">Not set up</span>
            )}
          </div>
          {!cloudFormOpen ? (
            <Button variant="secondary" size="sm" onClick={() => setShowCloudForm(true)}>
              {cloudStarted ? 'Edit credentials' : 'Set up Cloud API'}
            </Button>
          ) : cloudReady ? (
            <Button variant="ghost" size="sm" onClick={() => setShowCloudForm(false)}>
              Hide
            </Button>
          ) : null}
        </div>
        {cloudFormOpen ? (
          <div className="border-t border-border pt-4 dark:border-border-dark">
            <p className="mb-4 text-xs text-text-secondary">
              Copy these from Meta Business Suite (WhatsApp Manager and your system user). WABA ID, Phone number ID and Access
              token are required. Leave secret fields blank to keep saved values.
            </p>
            <MetaCloudCredentialsForm
              bare
              credentials={cloud.credentials}
              webhookUrl={cloud.webhookUrl}
              saving={cloud.saving}
              onSave={cloud.save}
            />
          </div>
        ) : null}
      </SettingsBlock>

      <ConfirmDialog
        isOpen={confirmDisconnect}
        title="Disconnect WhatsApp?"
        message="Invoices and replies will stop going out from this number until you scan a QR code again."
        confirmLabel="Disconnect"
        variant="danger"
        loading={loading}
        onConfirm={() => void handleDisconnect()}
        onCancel={() => setConfirmDisconnect(false)}
      />
    </SettingsPageBody>
  );
}
