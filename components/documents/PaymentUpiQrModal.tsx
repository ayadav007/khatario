'use client';

import { useRef, useEffect } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/Button';

export interface PaymentUpiQrModalProps {
  open: boolean;
  onClose: () => void;
  /** Payload encoded in the QR (UPI intent, payment URL, or PSP `qr_data`). */
  value: string;
  /** Downloaded PNG filename */
  downloadFileName?: string;
}

export function PaymentUpiQrModal({
  open,
  onClose,
  value,
  downloadFileName = 'payment-qr.png',
}: PaymentUpiQrModalProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const handleDownload = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      const url = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = url;
      a.download = downloadFileName.replace(/[^a-zA-Z0-9._-]/g, '_');
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch {
      /* ignore */
    }
  };

  if (!open || !value.trim()) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="payment-qr-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative w-full max-w-md rounded-xl border border-border bg-white p-6 shadow-lg dark:bg-slate-900">
        <button
          type="button"
          className="absolute right-3 top-3 rounded-lg p-2 text-text-secondary hover:bg-gray-100 hover:text-text-primary dark:hover:bg-slate-800"
          onClick={onClose}
          aria-label="Close"
        >
          <X className="h-5 w-5" />
        </button>
        <h3
          id="payment-qr-title"
          className="pr-10 text-lg font-semibold text-text-primary"
        >
          Scan to pay
        </h3>
        <p className="mt-1 text-sm text-text-secondary">
          Customer can scan with any UPI app or banking app that supports QR.
        </p>
        <div className="mt-6 flex justify-center rounded-lg border border-border bg-white p-4 dark:bg-white">
          <QRCodeCanvas
            ref={canvasRef}
            value={value}
            size={240}
            level="M"
            includeMargin
            title="Payment QR code"
          />
        </div>
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button type="button" variant="primary" onClick={handleDownload}>
            Download QR
          </Button>
        </div>
      </div>
    </div>
  );
}
