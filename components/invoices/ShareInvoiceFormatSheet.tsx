'use client';

import React, { useState } from 'react';
import { X, FileText, Image as ImageIcon, Link2, Loader2 } from 'lucide-react';
import {
  canUseNativeInvoiceShare,
  shareInvoiceNative,
  type InvoiceShareFormat,
} from '@/lib/share-invoice';

export interface ShareInvoiceFormatSheetProps {
  open: boolean;
  onClose: () => void;
  invoiceId: string;
  invoiceNumber: string;
  businessName?: string;
  userId?: string;
  /** When native share is unavailable or file generation fails */
  onFallbackModal: () => void;
}

export function ShareInvoiceFormatSheet({
  open,
  onClose,
  invoiceId,
  invoiceNumber,
  businessName,
  userId,
  onFallbackModal,
}: ShareInvoiceFormatSheetProps) {
  const [loadingFormat, setLoadingFormat] = useState<InvoiceShareFormat | null>(null);

  if (!open) return null;

  const handleFormat = async (format: InvoiceShareFormat) => {
    if (!canUseNativeInvoiceShare()) {
      onClose();
      onFallbackModal();
      return;
    }

    setLoadingFormat(format);
    try {
      const result = await shareInvoiceNative({
        invoiceId,
        invoiceNumber,
        businessName,
        format,
        userId,
      });
      if (result === 'modal') {
        onClose();
        onFallbackModal();
      } else if (result === 'shared') {
        onClose();
      }
    } finally {
      setLoadingFormat(null);
    }
  };

  const options: {
    format: InvoiceShareFormat;
    label: string;
    description: string;
    icon: React.ReactNode;
  }[] = [
    {
      format: 'pdf',
      label: 'Share as PDF',
      description: 'Attach invoice PDF — WhatsApp, Gmail, Drive, etc.',
      icon: <FileText className="w-6 h-6 text-red-600" />,
    },
    {
      format: 'image',
      label: 'Share as image',
      description: 'Attach PNG screenshot of the invoice',
      icon: <ImageIcon className="w-6 h-6 text-blue-600" />,
    },
    {
      format: 'link',
      label: 'Share link only',
      description: 'Send a view link without attaching a file',
      icon: <Link2 className="w-6 h-6 text-purple-600" />,
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button
        type="button"
        className="absolute inset-0 bg-black/50"
        aria-label="Close"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-labelledby="share-format-title"
        className="relative z-10 w-full max-w-md rounded-t-2xl sm:rounded-2xl bg-white dark:bg-slate-900 p-5 pb-8 shadow-xl"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 id="share-format-title" className="text-lg font-bold text-text-primary">
            Share invoice
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 hover:bg-gray-100 dark:hover:bg-slate-800"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <p className="text-sm text-text-secondary mb-4">
          Choose how to share <span className="font-semibold">{invoiceNumber}</span>
        </p>
        <div className="space-y-2">
          {options.map((opt) => (
            <button
              key={opt.format}
              type="button"
              disabled={loadingFormat !== null}
              onClick={() => void handleFormat(opt.format)}
              className="w-full flex items-center gap-4 p-4 rounded-xl border border-border bg-surface hover:bg-slate-50 dark:hover:bg-slate-800/80 transition disabled:opacity-60 text-left"
            >
              <div className="shrink-0 rounded-lg bg-gray-50 dark:bg-slate-800 p-3">{opt.icon}</div>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-text-primary">{opt.label}</p>
                <p className="text-xs text-text-secondary">{opt.description}</p>
              </div>
              {loadingFormat === opt.format && (
                <Loader2 className="w-5 h-5 shrink-0 animate-spin text-primary-600" />
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
