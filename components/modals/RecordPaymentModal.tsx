'use client';

import { useState } from 'react';
import { X, CreditCard, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useBadges } from '@/contexts/BadgeContext';

interface RecordPaymentModalProps {
  invoiceId: string;
  invoiceNumber: string;
  grandTotal: number;
  paidAmount: number;
  balanceAmount: number;
  onSuccess: () => void;
  onClose: () => void;
}

export function RecordPaymentModal({
  invoiceId,
  invoiceNumber,
  grandTotal,
  paidAmount,
  balanceAmount,
  onSuccess,
  onClose,
}: RecordPaymentModalProps) {
  const { refreshBadgeCounts } = useBadges();
  const [amount, setAmount] = useState<string>(balanceAmount.toString());
  const [paymentMode, setPaymentMode] = useState<string>('cash');
  const [reference, setReference] = useState<string>('');
  const [paymentDate, setPaymentDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [tdsAmount, setTdsAmount] = useState<string>('');
  const [tdsSection, setTdsSection] = useState<string>('194C');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const paymentAmount = parseFloat(amount || '0');
    const tds = parseFloat(tdsAmount || '0');
    if (isNaN(paymentAmount) || isNaN(tds) || paymentAmount < 0 || tds < 0 || paymentAmount + tds <= 0) {
      setError('Please enter a valid amount');
      return;
    }

    if (paymentAmount + tds > balanceAmount + 0.01) {
      setError(`Amount received plus TDS cannot exceed balance of ₹${balanceAmount.toLocaleString('en-IN')}`);
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`/api/invoices/${invoiceId}/payments`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: paymentAmount,
          payment_mode: paymentMode,
          reference: reference || null,
          payment_date: paymentDate,
          tds_amount: tds,
          tds_section: tds > 0 ? tdsSection : null,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to record payment');
      }

      await refreshBadgeCounts();
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to record payment');
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
            <div className="bg-green-100 p-2 rounded-lg">
              <CreditCard className="w-6 h-6 text-green-600" />
            </div>
            <h2 className="text-2xl font-bold text-gray-900">Record Payment</h2>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition"
            disabled={loading}
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <p className="text-gray-600 mb-6">
          Invoice: <span className="font-semibold">{invoiceNumber}</span>
        </p>

        {/* Payment Summary */}
        <div className="bg-gray-50 rounded-lg p-4 mb-6 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">Grand Total:</span>
            <span className="font-medium">₹{grandTotal.toLocaleString('en-IN')}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">Paid Amount:</span>
            <span className="font-medium text-green-600">₹{paidAmount.toLocaleString('en-IN')}</span>
          </div>
          <div className="flex justify-between text-sm border-t pt-2">
            <span className="text-gray-600 font-medium">Balance:</span>
            <span className="font-bold text-red-600">₹{balanceAmount.toLocaleString('en-IN')}</span>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Payment Amount */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Payment Amount <span className="text-red-500">*</span>
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              max={balanceAmount}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="input w-full"
              placeholder="Enter amount"
              required
              disabled={loading}
            />
            <p className="text-xs text-gray-500 mt-1">
              Maximum: ₹{balanceAmount.toLocaleString('en-IN')}
            </p>
          </div>

          {/* TDS withheld by customer */}
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">TDS deducted by customer</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={tdsAmount}
                onChange={(e) => {
                  const next = e.target.value;
                  const prevTds = parseFloat(tdsAmount || '0') || 0;
                  const nextTds = parseFloat(next || '0') || 0;
                  const received = parseFloat(amount || '0') || 0;
                  if (Math.abs(received + prevTds - balanceAmount) < 0.01) {
                    setAmount(Math.max(0, Math.round((balanceAmount - nextTds) * 100) / 100).toString());
                  }
                  setTdsAmount(next);
                }}
                className="input w-full"
                placeholder="0.00"
                disabled={loading}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Section</label>
              <select
                value={tdsSection}
                onChange={(e) => setTdsSection(e.target.value)}
                className="input w-full"
                disabled={loading || !(parseFloat(tdsAmount || '0') > 0)}
              >
                <option value="194C">194C</option>
                <option value="194J">194J</option>
                <option value="194H">194H</option>
                <option value="194I">194I</option>
                <option value="194Q">194Q</option>
                <option value="194O">194O</option>
                <option value="other">Other</option>
              </select>
            </div>
            <p className="col-span-3 text-xs text-gray-500 -mt-1">
              TDS settles the invoice and is booked to TDS Receivable; match it with Form 26AS.
            </p>
          </div>

          {/* Payment Date */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Payment Date <span className="text-red-500">*</span>
            </label>
            <input
              type="date"
              value={paymentDate}
              onChange={(e) => setPaymentDate(e.target.value)}
              className="input w-full"
              required
              disabled={loading}
            />
          </div>

          {/* Payment Mode */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Payment Mode <span className="text-red-500">*</span>
            </label>
            <select
              value={paymentMode}
              onChange={(e) => setPaymentMode(e.target.value)}
              className="input w-full"
              required
              disabled={loading}
            >
              <option value="cash">Cash</option>
              <option value="bank_transfer">Bank Transfer</option>
              <option value="upi">UPI</option>
              <option value="card">Card</option>
              <option value="cheque">Cheque</option>
              <option value="other">Other</option>
            </select>
          </div>

          {/* Reference */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Reference / Transaction ID
            </label>
            <input
              type="text"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              className="input w-full"
              placeholder="Optional: UPI ID, cheque no., etc."
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
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              className="flex-1"
              isLoading={loading}
            >
              Record Payment
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

