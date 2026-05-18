'use client';

import React, { useState, useEffect } from 'react';
import { Input } from '@/components/ui/Input';

interface PaymentMethod {
  mode: string;
  label: string;
}

interface POSPaymentInputsProps {
  grandTotal: number;
  payments: Array<{ mode: string; amount: number }>;
  onChange: (payments: Array<{ mode: string; amount: number }>) => void;
}

const PAYMENT_METHODS: PaymentMethod[] = [
  { mode: 'cash', label: 'CASH' },
  { mode: 'upi', label: 'UPI' },
  { mode: 'credit_card', label: 'CREDIT CARD' },
  { mode: 'voucher', label: 'VOUCHER' },
  { mode: 'sodexo', label: 'SODEXO' },
];

function buildLocalFromParent(parent: Array<{ mode: string; amount: number }>) {
  return PAYMENT_METHODS.map((m) => {
    const fromParent = parent.find((p) => p.mode === m.mode);
    return {
      mode: m.mode,
      amount: fromParent !== undefined ? Number(fromParent.amount) || 0 : 0,
    };
  });
}

/** Rupees still owed (0 if paid within 1 paisa of grand total — avoids float tax noise). */
function balanceDueRupees(grandTotal: number, totalPaid: number): number {
  const duePaise = Math.round(grandTotal * 100) - Math.round(totalPaid * 100);
  return duePaise > 0 ? duePaise / 100 : 0;
}

export function POSPaymentInputs({ grandTotal, payments, onChange }: POSPaymentInputsProps) {
  const [localPayments, setLocalPayments] = useState<Array<{ mode: string; amount: number }>>(() =>
    buildLocalFromParent(payments.length > 0 ? payments : [])
  );

  /** Parent often passes a new array reference each render; key by content so we do not reset on unrelated re-renders. */
  const parentSyncKey = JSON.stringify(
    payments
      .map((p) => [p.mode, Number(p.amount) || 0] as const)
      .sort((a, b) => a[0].localeCompare(b[0]))
  );

  useEffect(() => {
    if (payments.length === 0) {
      setLocalPayments(buildLocalFromParent([]));
    } else {
      setLocalPayments(buildLocalFromParent(payments));
    }
  }, [parentSyncKey, payments]);

  const pushToParent = (rows: Array<{ mode: string; amount: number }>) => {
    setLocalPayments(rows);
    onChange(rows.filter((p) => p.amount > 0));
  };

  const updatePayment = (index: number, amount: number) => {
    const updated = [...localPayments];
    updated[index] = { ...updated[index], amount };
    pushToParent(updated);
  };

  const totalPaid = localPayments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
  const balance = balanceDueRupees(grandTotal, totalPaid);
  const cashPayment = localPayments.find((p) => p.mode === 'cash');
  const cashAmount = cashPayment?.amount || 0;
  const cashOverPaise = Math.round(cashAmount * 100) - Math.round(grandTotal * 100);
  const returnAmount = cashOverPaise > 0 ? cashOverPaise / 100 : 0;

  return (
    <div className="space-y-4">
      {/* Payment Methods */}
      <div className="space-y-3">
        {PAYMENT_METHODS.map((method) => {
          const payment =
            localPayments.find((p) => p.mode === method.mode) || { mode: method.mode, amount: 0 };
          const index = PAYMENT_METHODS.findIndex((m) => m.mode === method.mode);

          return (
            <div key={method.mode} className="flex items-center gap-3">
              <label className="w-32 text-[28px] font-semibold text-gray-700 uppercase">
                {method.label}
              </label>
              <div className="flex-1">
                <Input
                  type="number"
                  inputMode="decimal"
                  value={payment.amount > 0 ? payment.amount.toString() : ''}
                  onChange={(e) => {
                    const value = parseFloat(e.target.value) || 0;
                    updatePayment(index, value);
                  }}
                  placeholder="0.00"
                  className="text-right font-mono text-[36px] font-bold"
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Cash-specific UI (neutral surface + big black numbers, per color rules) */}
      {cashAmount > 0 && (
        <div className="bg-gray-50 border border-border rounded-lg p-3 space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-[28px] font-semibold text-text-secondary">Customer Paid:</span>
            <span className="text-[36px] font-bold text-gray-900">
              ₹{cashAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </span>
          </div>
          {returnAmount > 0 && (
            <div className="flex justify-between items-center">
              <span className="text-[28px] font-semibold text-text-secondary">Return Amount:</span>
              <span className="text-[36px] font-bold text-gray-900">
                ₹{returnAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Balance Display - Never show negative */}
      {balance > 0 && (
        <div className="border-t pt-3">
          <div className="flex justify-between items-center">
            <span className="text-[28px] font-semibold text-gray-700">Balance Due:</span>
            <span className="text-[36px] font-bold text-red-600">
              ₹{balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
