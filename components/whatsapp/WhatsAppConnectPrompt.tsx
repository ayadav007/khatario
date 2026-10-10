'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { QRCodeSVG } from 'qrcode.react';
import { Loader2, QrCode, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/contexts/AuthContext';

const QR_LIFETIME_SECONDS = 60;

type Step = 'choose' | 'qr';

/**
 * Shown when a send is blocked because no WhatsApp number is linked.
 * The user can scan a QR code here, or open Cloud API setup.
 */
export function WhatsAppConnectPrompt({
  open,
  onClose,
  onConnected,
}: {
  open: boolean;
  onClose: () => void;
  onConnected: () => void;
}) {
  const router = useRouter();
  const { business } = useAuth();
  const [step, setStep] = useState<Step>('choose');
  const [riskAccepted, setRiskAccepted] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [qrAge, setQrAge] = useState(0);
  const generatedAt = useRef<number | null>(null);

  useEffect(() => {
    if (!open) {
      setStep('choose');
      setQr(null);
      setError(null);
      setQrAge(0);
      generatedAt.current = null;
    }
  }, [open]);

  const refreshStatus = useCallback(async () => {
    if (!business?.id) return;
    const res = await fetch(`/api/whatsapp/status?business_id=${business.id}`);
    const data = await res.json().catch(() => ({}));
    if (data.status === 'connected') {
      onConnected();
      return;
    }
    if (data.qr && data.status === 'pending_qr') {
      setQr((current) => {
        if (current !== data.qr) generatedAt.current = Date.now();
        return data.qr;
      });
    }
  }, [business?.id, onConnected]);

  useEffect(() => {
    if (!open || step !== 'qr') return;
    const poll = setInterval(() => void refreshStatus(), 3000);
    return () => clearInterval(poll);
  }, [open, step, refreshStatus]);

  useEffect(() => {
    if (step !== 'qr' || !qr) return;
    if (!generatedAt.current) generatedAt.current = Date.now();
    const tick = setInterval(() => {
      if (generatedAt.current) setQrAge(Math.floor((Date.now() - generatedAt.current) / 1000));
    }, 1000);
    return () => clearInterval(tick);
  }, [step, qr]);

  useEffect(() => {
    if (step === 'qr' && qr && !loading && qrAge === QR_LIFETIME_SECONDS) void startQr();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qrAge, step, qr, loading]);

  const startQr = async () => {
    if (!business?.id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/whatsapp/qr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_id: business.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) throw new Error(data.error || 'Could not start the QR code');
      if (data.status === 'connected') {
        onConnected();
        return;
      }
      setStep('qr');
      if (data.qr) {
        setQr(data.qr);
        generatedAt.current = Date.now();
        setQrAge(0);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start the QR code');
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="wa-connect-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 id="wa-connect-title" className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              WhatsApp is not connected
            </h3>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
              Reminders are not sent until a number is linked. Scan a QR code with your phone, or connect the official WhatsApp Business API.
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-gray-500 hover:bg-gray-100" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        {step === 'choose' ? (
          <div className="space-y-3">
            <label className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-amber-400"
                checked={riskAccepted}
                onChange={(e) => setRiskAccepted(e.target.checked)}
              />
              <span>
                I understand a QR link is a linked device, not Meta&apos;s official Business API. I will only message my own customers about their invoices and payments.
              </span>
            </label>
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button className="flex-1" onClick={() => void startQr()} disabled={!riskAccepted || loading} isLoading={loading}>
                <QrCode className="mr-1.5 h-4 w-4" />
                Scan QR code
              </Button>
              <Button
                variant="secondary"
                className="flex-1"
                onClick={() => {
                  onClose();
                  router.push('/settings/whatsapp#wa-cloud');
                }}
              >
                Connect Business API
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {qr ? (
              <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
                <div className="rounded-lg border border-gray-200 bg-white p-3">
                  <QRCodeSVG value={qr} size={184} level="L" includeMargin />
                </div>
                <ol className="list-decimal space-y-1 pl-5 text-sm text-gray-600">
                  <li>Open WhatsApp on your phone</li>
                  <li>Go to Settings, then Linked devices, then Link a device</li>
                  <li>Point the camera at this code</li>
                </ol>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <Loader2 className="h-4 w-4 animate-spin" />
                Waiting for a QR code…
              </div>
            )}
            {qrAge >= 50 && qrAge < QR_LIFETIME_SECONDS ? (
              <p className="text-xs font-medium text-amber-700">A fresh code loads in {QR_LIFETIME_SECONDS - qrAge}s</p>
            ) : null}
            {qrAge >= QR_LIFETIME_SECONDS ? (
              <Button size="sm" onClick={() => void startQr()} disabled={loading} isLoading={loading}>
                New QR code
              </Button>
            ) : null}
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
            <Button variant="ghost" size="sm" onClick={() => setStep('choose')}>
              Back
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
