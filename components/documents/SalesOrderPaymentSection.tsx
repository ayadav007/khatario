'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Copy,
  ExternalLink,
  IndianRupee,
  Loader2,
  MessageCircle,
  QrCode,
} from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';
import { PAYMENT_AMOUNT_EPS } from '@/lib/payment-constants';
import { PaymentUpiQrModal } from '@/components/documents/PaymentUpiQrModal';

function formatInr(n: number): string {
  return `₹ ${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Compact INR for WhatsApp (no extra space after ₹). */
function formatInrPlain(n: number): string {
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

type PaymentSummary = {
  grand_total: number;
  total_paid: number;
  remaining: number;
  payment_status: string | null;
  order_status: string;
  order_number: string;
  payment_amount_eps: number;
};

/** Collect payload from POST /api/payments/upi-collect (nested under `collect`). */
type CollectSessionPayload = {
  payment_url?: string | null;
  upi_intent?: string | null;
  qr_data?: string | null;
  payment_session_id?: string | null;
  session_reference?: string | null;
  /** PayU: POST to hosted checkout (`collect_raw` from API). */
  payu_post_endpoint?: string | null;
  payu_post_fields?: Record<string, string> | null;
};

function getShareablePaymentLink(collect: CollectSessionPayload | null): string | null {
  if (!collect) return null;
  const url = typeof collect.payment_url === 'string' ? collect.payment_url.trim() : '';
  if (url) return url;
  const upi = typeof collect.upi_intent === 'string' ? collect.upi_intent.trim() : '';
  if (upi) return upi;
  return null;
}

/** Text encoded into the QR — prefers PSP `qr_data`, then payment URL / UPI intent. */
function getQrEncodePayload(collect: CollectSessionPayload | null): string | null {
  if (!collect) return null;
  const qrRaw = typeof collect.qr_data === 'string' ? collect.qr_data.trim() : '';
  if (qrRaw.length > 0) return qrRaw;
  return getShareablePaymentLink(collect);
}

function isHttpUrl(s: string | null | undefined): boolean {
  if (!s) return false;
  return /^https?:\/\//i.test(s.trim());
}

interface SalesOrderPaymentSectionProps {
  orderId: string;
}

export function SalesOrderPaymentSection({ orderId }: SalesOrderPaymentSectionProps) {
  const { business, user } = useAuth();
  const toast = useToastContext();
  const [summary, setSummary] = useState<PaymentSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [collecting, setCollecting] = useState(false);
  /** Last successful UPI collect response — used for copy / WhatsApp until cleared or order settled. */
  const [collectSession, setCollectSession] = useState<CollectSessionPayload | null>(null);
  const [qrModalOpen, setQrModalOpen] = useState(false);
  const payuFormRef = useRef<HTMLFormElement>(null);

  const loadSummary = useCallback(async () => {
    if (!business?.id || !user?.id) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        business_id: business.id,
        user_id: user.id,
      });
      const res = await fetch(
        `/api/sales-orders/${orderId}/payment-summary?${params.toString()}`,
        { credentials: 'include' }
      );
      const data = await res.json();
      if (!res.ok) {
        setSummary(null);
        if (res.status !== 404) {
          toast.error(data.error || 'Could not load payment summary');
        }
        return;
      }
      const remaining = Number(data.remaining) ?? 0;
      const epsVal = Number(data.payment_amount_eps) || PAYMENT_AMOUNT_EPS;
      setSummary({
        grand_total: Number(data.grand_total) || 0,
        total_paid: Number(data.total_paid) || 0,
        remaining,
        payment_status: data.payment_status ?? null,
        order_status: String(data.order_status || ''),
        order_number: String(data.order_number || ''),
        payment_amount_eps: epsVal,
      });
      if (remaining <= epsVal || String(data.order_status || '') === 'cancelled') {
        setCollectSession(null);
      }
    } catch {
      setSummary(null);
      toast.error('Could not load payment summary');
    } finally {
      setLoading(false);
    }
  }, [business?.id, user?.id, orderId, toast]);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  /** Close QR modal when session clears or order is settled / cancelled. */
  useEffect(() => {
    if (!summary) return;
    const eps = summary.payment_amount_eps;
    const settled =
      summary.remaining <= eps ||
      summary.order_status === 'cancelled' ||
      !getQrEncodePayload(collectSession);
    if (settled) {
      setQrModalOpen(false);
    }
  }, [summary, collectSession]);

  const handleRequestPayment = async () => {
    if (!business?.id || !user?.id || !summary) return;
    const eps = summary.payment_amount_eps;
    if (summary.remaining <= eps) return;

    setCollecting(true);
    try {
      const res = await fetch('/api/payments/upi-collect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          order_id: orderId,
          business_id: business.id,
          user_id: user.id,
        }),
      });
      const data = await res.json();

      if (res.ok && data.already_paid) {
        setCollectSession(null);
        toast.info(data.message || 'Order is already fully paid');
        await loadSummary();
        return;
      }

      if (!res.ok) {
        toast.error(data.error || data.details || 'Payment request failed');
        return;
      }

      const collect = data.collect as CollectSessionPayload | undefined;
      const hasSessionPayload =
        collect &&
        (getShareablePaymentLink(collect) ||
          (typeof collect.qr_data === 'string' && collect.qr_data.trim().length > 0));
      if (hasSessionPayload && collect) {
        setCollectSession(collect);
      } else {
        setCollectSession(null);
      }

      if (data.deduplicated) {
        toast.success(
          data.message ||
            'An active payment session already exists for this order.'
        );
      } else {
        toast.success(
          'Payment request created. Share the collect link or QR with the customer.'
        );
      }
      await loadSummary();
    } catch {
      toast.error('Payment request failed');
    } finally {
      setCollecting(false);
    }
  };

  if (!business?.id || !user?.id) {
    return null;
  }

  if (loading) {
    return (
      <Card className="border border-border bg-surface p-4">
        <div className="flex items-center gap-2 text-sm text-text-secondary">
          <Loader2 className="h-4 w-4 animate-spin text-text-muted" />
          Loading payment summary…
        </div>
      </Card>
    );
  }

  if (!summary) {
    return null;
  }

  const eps = summary.payment_amount_eps;
  const disabledCollect =
    summary.remaining <= eps ||
    summary.order_status === 'cancelled' ||
    collecting;

  const badgeStatus = summary.payment_status || 'unpaid';

  const shareLink = getShareablePaymentLink(collectSession);
  const qrPayload = getQrEncodePayload(collectSession);
  const alreadyPaidEffective = summary.remaining <= eps;

  const payuHostedReady =
    Boolean(
      collectSession?.payu_post_endpoint?.trim() &&
        collectSession?.payu_post_fields &&
        Object.keys(collectSession.payu_post_fields).length > 0
    );

  /** Copy / WhatsApp need a shareable string (URL or UPI intent). */
  const copyShareDisabled =
    alreadyPaidEffective || !shareLink || summary.order_status === 'cancelled';

  /** Open page: PayU uses hidden POST form; others use `payment_url`. */
  const openPaymentPageDisabled =
    alreadyPaidEffective ||
    summary.order_status === 'cancelled' ||
    (!payuHostedReady && (!shareLink || !isHttpUrl(shareLink)));

  const qrActionsDisabled =
    alreadyPaidEffective || !qrPayload || summary.order_status === 'cancelled';

  const handleCopyLink = async () => {
    if (!shareLink || copyShareDisabled) return;
    try {
      await navigator.clipboard.writeText(shareLink);
      toast.success('Link copied');
    } catch {
      toast.error('Could not copy to clipboard');
    }
  };

  const handleWhatsAppShare = () => {
    if (!shareLink || copyShareDisabled || !summary.order_number) return;
    const msg =
      `Hi, please complete payment for Order #${summary.order_number}.\n` +
      `Amount: ${formatInrPlain(summary.remaining)}\n` +
      `Pay here: ${shareLink}`;
    const url = `https://wa.me/?text=${encodeURIComponent(msg)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const handleOpenPaymentPage = () => {
    if (openPaymentPageDisabled) return;

    if (payuHostedReady && collectSession?.payu_post_fields && collectSession.payu_post_endpoint) {
      try {
        payuFormRef.current?.submit();
        return;
      } catch {
        /* fall through to GET URL */
      }
    }

    if (!shareLink || !isHttpUrl(shareLink)) return;
    window.open(shareLink, '_blank', 'noopener,noreferrer');
  };

  return (
    <>
    <Card className="border border-border bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-text-primary">Payment</h2>
            <StatusBadge status={badgeStatus} />
          </div>
          <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-3 sm:gap-6">
            <div>
              <div className="text-text-secondary">Order total</div>
              <div className="font-semibold text-gray-900">{formatInr(summary.grand_total)}</div>
            </div>
            <div>
              <div className="text-text-secondary">Paid (successful)</div>
              <div className="font-semibold text-gray-900">{formatInr(summary.total_paid)}</div>
            </div>
            <div>
              <div className="text-text-secondary">Remaining</div>
              <div
                className={
                  summary.remaining > eps
                    ? 'font-semibold text-amber-800'
                    : 'font-semibold text-gray-900'
                }
              >
                {formatInr(summary.remaining)}
              </div>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-stretch gap-2 sm:items-end">
          <Button
            type="button"
            variant="primary"
            disabled={disabledCollect}
            isLoading={collecting}
            onClick={() => void handleRequestPayment()}
            className="whitespace-nowrap"
          >
            <IndianRupee className="mr-2 h-4 w-4" />
            Request Payment
          </Button>
          <div className="flex flex-wrap gap-2 justify-end">
            {!openPaymentPageDisabled ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={openPaymentPageDisabled}
                onClick={handleOpenPaymentPage}
                className="whitespace-nowrap"
              >
                <ExternalLink className="mr-2 h-4 w-4" />
                Open payment page
              </Button>
            ) : null}
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={copyShareDisabled}
              onClick={() => void handleCopyLink()}
              className="whitespace-nowrap"
            >
              <Copy className="mr-2 h-4 w-4" />
              Copy link
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={copyShareDisabled || !summary.order_number}
              onClick={handleWhatsAppShare}
              className="whitespace-nowrap"
            >
              <MessageCircle className="mr-2 h-4 w-4" />
              Share on WhatsApp
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={qrActionsDisabled}
              onClick={() => setQrModalOpen(true)}
              className="whitespace-nowrap"
            >
              <QrCode className="mr-2 h-4 w-4" />
              Show QR
            </Button>
          </div>
          {copyShareDisabled &&
            !alreadyPaidEffective &&
            summary.order_status !== 'cancelled' && (
            <p className="text-xs text-text-secondary text-right max-w-[260px]">
              Request payment first to get a shareable link.
            </p>
          )}
          {summary.order_status === 'cancelled' && (
            <p className="text-xs text-text-secondary text-right max-w-[220px]">
              Payments cannot be collected for cancelled orders.
            </p>
          )}
        </div>
      </div>
    </Card>

    {payuHostedReady &&
      collectSession?.payu_post_endpoint &&
      collectSession?.payu_post_fields ? (
      <form
        ref={payuFormRef}
        method="POST"
        action={collectSession.payu_post_endpoint}
        target="_blank"
        className="hidden"
        aria-hidden
      >
        {Object.entries(collectSession.payu_post_fields).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
      </form>
    ) : null}

    <PaymentUpiQrModal
      open={qrModalOpen}
      onClose={() => setQrModalOpen(false)}
      value={qrPayload ?? ''}
      downloadFileName={`payment-qr-${summary.order_number || orderId}.png`}
    />
    </>
  );
}
