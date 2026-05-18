'use client';

import { useState, useEffect } from 'react';
import { X, CreditCard, Plus, Trash2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { format } from 'date-fns';

type PaymentEntry = {
  id: string;
  amount: number;
  mode: string;
  date: string;
  reference: string;
};

interface InvoicePaymentModalProps {
  grandTotal: number;
  payments: PaymentEntry[];
  onSave: (payments: PaymentEntry[]) => void;
  onClose: () => void;
}

export function InvoicePaymentModal({
  grandTotal,
  payments: initialPayments,
  onSave,
  onClose,
}: InvoicePaymentModalProps) {
  const [payments, setPayments] = useState<PaymentEntry[]>(initialPayments.length > 0 ? initialPayments : []);
  const [error, setError] = useState<string>('');

  // Add a payment entry if empty
  useEffect(() => {
    if (payments.length === 0) {
      setPayments([{
        id: Date.now().toString(),
        amount: 0,
        mode: 'cash',
        date: format(new Date(), 'yyyy-MM-dd'),
        reference: ''
      }]);
    }
  }, []);

  const totalPaid = payments.reduce((sum, p) => sum + (p.amount || 0), 0);
  const balance = grandTotal - totalPaid;

  const handleQuickPayment = (percentage: number) => {
    const amount = grandTotal * percentage;
    if (payments.length === 0) {
      setPayments([{
        id: Date.now().toString(),
        amount,
        mode: 'cash',
        date: format(new Date(), 'yyyy-MM-dd'),
        reference: ''
      }]);
    } else {
      const updated = [...payments];
      updated[0].amount = amount;
      setPayments(updated);
    }
  };

  const handleAddPayment = () => {
    setPayments([...payments, {
      id: Date.now().toString() + Math.random(),
      amount: 0,
      mode: 'cash',
      date: format(new Date(), 'yyyy-MM-dd'),
      reference: ''
    }]);
  };

  const handleRemovePayment = (id: string) => {
    setPayments(payments.filter(p => p.id !== id));
  };

  const handleUpdatePayment = (id: string, field: keyof PaymentEntry, value: any) => {
    setPayments(payments.map(p => 
      p.id === id ? { ...p, [field]: value } : p
    ));
  };

  const handleSave = () => {
    // Validate all payments have valid amounts
    const invalidPayments = payments.filter(p => !p.amount || p.amount <= 0);
    if (invalidPayments.length > 0) {
      setError('All payment entries must have a valid amount greater than 0');
      return;
    }

    // Filter out empty payments (amount = 0)
    const validPayments = payments.filter(p => p.amount > 0);
    
    if (validPayments.length === 0) {
      setError('Please add at least one payment entry');
      return;
    }

    const total = validPayments.reduce((sum, p) => sum + p.amount, 0);
    if (total > grandTotal) {
      setError(`Total payments (₹${total.toFixed(2)}) cannot exceed invoice total (₹${grandTotal.toFixed(2)})`);
      return;
    }

    setError('');
    onSave(validPayments);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6">
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
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Payment Summary */}
        <div className="bg-gray-50 rounded-lg p-4 mb-6 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">Grand Total:</span>
            <span className="font-medium">₹{grandTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">Total Paid:</span>
            <span className="font-medium text-green-600">₹{totalPaid.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
          </div>
          <div className="flex justify-between text-sm border-t pt-2">
            <span className="text-gray-600 font-medium">Balance:</span>
            <span className={`font-bold ${balance > 0 ? 'text-red-600' : 'text-green-600'}`}>
              ₹{balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </span>
          </div>
        </div>

        {/* Quick Action Buttons */}
        <div className="grid grid-cols-2 gap-3 mb-6">
          <button
            type="button"
            onClick={() => handleQuickPayment(1)}
            className="px-4 py-2.5 text-sm font-medium text-primary-600 bg-slate-50 hover:bg-slate-100 rounded-lg border border-primary-200 transition"
          >
            Full Payment (₹{grandTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })})
          </button>
          <button
            type="button"
            onClick={() => handleQuickPayment(0.5)}
            className="px-4 py-2.5 text-sm font-medium text-primary-600 bg-slate-50 hover:bg-slate-100 rounded-lg border border-primary-200 transition"
          >
            50% Payment (₹{(grandTotal * 0.5).toLocaleString('en-IN', { minimumFractionDigits: 2 })})
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">
            {error}
          </div>
        )}

        {/* Payment Entries */}
        <div className="space-y-4 mb-6">
          {payments.map((payment, idx) => (
            <div key={payment.id} className="p-4 bg-gray-50 rounded-lg border border-gray-200">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-700">Payment {idx + 1}</h3>
                {payments.length > 1 && (
                  <button
                    type="button"
                    onClick={() => handleRemovePayment(payment.id)}
                    className="p-1.5 text-red-500 hover:bg-red-50 rounded transition"
                    title="Remove payment"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
              
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Amount <span className="text-red-500">*</span>
                  </label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={payment.amount || ''}
                    onChange={(e) => handleUpdatePayment(payment.id, 'amount', Number(e.target.value) || 0)}
                    placeholder="0.00"
                    className="w-full"
                  />
                  {payment.amount > 200000 && payment.mode === 'cash' && (
                    <div className="mt-2 p-2 bg-amber-50 border border-amber-200 rounded text-xs text-amber-800">
                      ⚠️ <strong>Government Regulation:</strong> It is not advisable to collect cash for amounts exceeding ₹2,00,000 as it is against government law. Please use bank transfer, UPI, or cheque for such transactions.
                    </div>
                  )}
                </div>
                
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Mode <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={payment.mode}
                    onChange={(e) => handleUpdatePayment(payment.id, 'mode', e.target.value)}
                    className="input w-full"
                  >
                    <option value="cash">Cash</option>
                    <option value="bank">Bank Transfer</option>
                    <option value="upi">UPI</option>
                    <option value="cheque">Cheque</option>
                    <option value="card">Card</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Reference
                  </label>
                  <Input
                    type="text"
                    value={payment.reference}
                    onChange={(e) => handleUpdatePayment(payment.id, 'reference', e.target.value)}
                    placeholder="Txn ID / Cheque No."
                    className="w-full"
                  />
                </div>
                
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Date <span className="text-red-500">*</span>
                  </label>
                  <Input
                    type="date"
                    value={payment.date}
                    onChange={(e) => handleUpdatePayment(payment.id, 'date', e.target.value)}
                    className="w-full"
                  />
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Add Payment Button */}
        <button
          type="button"
          onClick={handleAddPayment}
          className="w-full py-2.5 px-4 text-sm text-primary-600 hover:bg-slate-50 border border-dashed border-primary-300 rounded-lg flex items-center justify-center gap-2 transition mb-6"
        >
          <Plus className="w-4 h-4" /> Add Another Payment
        </button>

        {/* Actions */}
        <div className="flex gap-3 pt-4 border-t">
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            className="flex-1"
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={handleSave}
            className="flex-1"
          >
            Save Payments
          </Button>
        </div>
      </div>
    </div>
  );
}

