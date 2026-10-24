'use client';

import { useId, useState } from 'react';
import Link from 'next/link';
import { X, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import type { AccountingErrorView } from '@/lib/accounting-ui/errors';

interface ReasonConfirmModalProps {
  title: string;
  /** Document the action applies to, e.g. "Bill: PB-102". */
  subject?: string;
  description: string;
  confirmLabel: string;
  requireReason?: boolean;
  reasonLabel?: string;
  reasonPlaceholder?: string;
  /** Resolves to null on success, or an error to show inside the dialog. */
  onConfirm: (reason: string) => Promise<AccountingErrorView | null>;
  onClose: () => void;
}

export function ReasonConfirmModal({
  title,
  subject,
  description,
  confirmLabel,
  requireReason = false,
  reasonLabel = 'Reason',
  reasonPlaceholder,
  onConfirm,
  onClose,
}: ReasonConfirmModalProps) {
  const reasonId = useId();
  const titleId = useId();
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<AccountingErrorView | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (requireReason && !reason.trim()) {
      setError({ message: `Please enter a ${reasonLabel.toLowerCase()}.` });
      return;
    }
    setLoading(true);
    try {
      const result = await onConfirm(reason.trim());
      if (result) setError(result);
    } catch {
      setError({ message: 'Something went wrong. Please try again.' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="bg-white rounded-2xl max-w-md w-full p-6"
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="bg-red-100 p-2 rounded-lg">
              <AlertTriangle className="w-6 h-6 text-red-600" />
            </div>
            <h2 id={titleId} className="text-xl font-bold text-gray-900">
              {title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition"
            disabled={loading}
            aria-label="Close"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {subject && <p className="text-gray-600 mb-2 font-semibold">{subject}</p>}
        <p className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm text-yellow-800 mb-4">
          {description}
        </p>

        {error && (
          <div role="alert" className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">
            <p>{error.message}</p>
            {error.action && (
              <Link href={error.action.href} className="mt-1 inline-block font-medium underline">
                {error.action.label}
              </Link>
            )}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {requireReason && (
            <div>
              <label htmlFor={reasonId} className="block text-sm font-medium text-gray-700 mb-1">
                {reasonLabel} <span className="text-red-500">*</span>
              </label>
              <textarea
                id={reasonId}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="input w-full min-h-[90px] resize-none"
                placeholder={reasonPlaceholder}
                disabled={loading}
              />
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={onClose} className="flex-1" disabled={loading}>
              Go back
            </Button>
            <Button type="submit" variant="destructive" className="flex-1" isLoading={loading}>
              {confirmLabel}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
