'use client';

import { useState } from 'react';
import { X, AlertTriangle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';

interface CancelInvoiceModalProps {
  invoiceId: string;
  invoiceNumber: string;
  onSuccess: () => void;
  onClose: () => void;
  cancelledBy?: string;
}

export function CancelInvoiceModal({
  invoiceId,
  invoiceNumber,
  onSuccess,
  onClose,
  cancelledBy,
}: CancelInvoiceModalProps) {
  const [reason, setReason] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!reason.trim()) {
      setError('Please provide a cancellation reason');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`/api/invoices/${invoiceId}/cancel`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason: reason.trim(),
          cancelled_by: cancelledBy || null,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to cancel invoice');
      }

      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to cancel invoice');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl max-w-md w-full p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="bg-red-100 p-2 rounded-lg">
              <AlertTriangle className="w-6 h-6 text-red-600" />
            </div>
            <h2 className="text-2xl font-bold text-gray-900">Cancel Invoice</h2>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition"
            disabled={loading}
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="mb-6">
          <p className="text-gray-600 mb-2">
            Invoice: <span className="font-semibold">{invoiceNumber}</span>
          </p>
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm text-yellow-800">
            <p className="font-medium mb-1">⚠️ Warning</p>
            <p>This action will:</p>
            <ul className="list-disc list-inside mt-2 space-y-1 text-xs">
              <li>Reverse stock movements for all items</li>
              <li>Set payment status to unpaid</li>
              <li>Lock the invoice from further edits</li>
              <li>Affect GST filing (removed from GSTR-1)</li>
            </ul>
            <p className="mt-2 font-medium">This action cannot be undone.</p>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Cancellation Reason */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Cancellation Reason <span className="text-red-500">*</span>
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="input w-full min-h-[100px] resize-none"
              placeholder="Please provide a reason for cancellation..."
              required
              disabled={loading}
            />
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-4">
            <Button
              type="button"
              variant="secondary"
              onClick={onClose}
              className="flex-1"
              disabled={loading}
            >
              Keep Invoice
            </Button>
            <Button
              type="submit"
              variant="primary"
              className="flex-1 bg-red-600 hover:bg-red-700"
              isLoading={loading}
            >
              Confirm Cancellation
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

