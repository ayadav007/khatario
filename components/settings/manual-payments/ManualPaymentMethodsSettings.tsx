'use client';

import React from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { clsx } from 'clsx';
import { CreditCard, Edit, Loader2, Plus, QrCode, Save, Trash2, Wallet } from 'lucide-react';
import { usePaymentMethods } from '@/components/settings/manual-payments/usePaymentMethods';

export function ManualPaymentMethodsSettings(props: {
  businessId?: string | null;
  userId?: string | null; // reserved for future API auth; not used yet
  className?: string;
}) {
  const { businessId, className } = props;

  const {
    paymentMethods,
    loadingPaymentMethods,
    showPaymentMethodForm,
    editingPaymentMethod,
    paymentMethodForm,
    setPaymentMethodForm,
    startCreatePaymentMethod,
    startEditPaymentMethod,
    cancelPaymentMethodForm,
    submitPaymentMethod,
    deletePaymentMethod,
  } = usePaymentMethods({ businessId });

  return (
    <Card padding="lg" className={className}>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-text-primary">
            Payment Methods (UPI, etc.)
          </h3>
          <p className="text-sm text-text-secondary mt-1">
            Configure payment methods to receive payments via WhatsApp. The default method will be
            used for payment links.
          </p>
        </div>
        <Button type="button" variant="secondary" onClick={startCreatePaymentMethod}>
          <Plus className="w-4 h-4 mr-2" />
          Add Payment Method
        </Button>
      </div>

      {showPaymentMethodForm && (
        <div className="mb-6 p-4 bg-gray-50 dark:bg-slate-800/50 rounded-lg border border-border">
          <h4 className="font-medium text-text-primary mb-4">
            {editingPaymentMethod ? 'Edit Payment Method' : 'Add New Payment Method'}
          </h4>
          <form onSubmit={submitPaymentMethod} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">
                  Method Type *
                </label>
                <select
                  name="method_type"
                  value={paymentMethodForm.method_type}
                  onChange={(e) =>
                    setPaymentMethodForm({ ...paymentMethodForm, method_type: e.target.value })
                  }
                  className="input"
                  required
                >
                  <option value="upi">UPI</option>
                  <option value="bank_transfer">Bank Transfer</option>
                  <option value="wallet">Wallet (GPay, PhonePe, etc.)</option>
                  <option value="card">Card</option>
                  <option value="other">Other</option>
                </select>
              </div>

              <Input
                label="Method Name *"
                name="method_name"
                value={paymentMethodForm.method_name}
                onChange={(e) =>
                  setPaymentMethodForm({ ...paymentMethodForm, method_name: e.target.value })
                }
                placeholder="e.g., UPI ID 1, Google Pay, PhonePe"
                required
              />

              {paymentMethodForm.method_type === 'upi' && (
                <Input
                  label="UPI ID *"
                  name="upi_id"
                  value={paymentMethodForm.upi_id}
                  onChange={(e) =>
                    setPaymentMethodForm({ ...paymentMethodForm, upi_id: e.target.value })
                  }
                  placeholder="username@paytm, username@ybl, etc."
                  required
                />
              )}

              {paymentMethodForm.method_type === 'wallet' && (
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-1">
                    Wallet Provider
                  </label>
                  <select
                    name="wallet_provider"
                    value={paymentMethodForm.wallet_provider}
                    onChange={(e) =>
                      setPaymentMethodForm({
                        ...paymentMethodForm,
                        wallet_provider: e.target.value,
                      })
                    }
                    className="input"
                  >
                    <option value="">Select provider</option>
                    <option value="gpay">Google Pay</option>
                    <option value="phonepe">PhonePe</option>
                    <option value="paytm">Paytm</option>
                    <option value="amazonpay">Amazon Pay</option>
                    <option value="other">Other</option>
                  </select>
                </div>
              )}

              <Input
                label="Priority (Display Order)"
                name="priority"
                type="number"
                value={paymentMethodForm.priority}
                onChange={(e) =>
                  setPaymentMethodForm({
                    ...paymentMethodForm,
                    priority: Number(e.target.value) || 0,
                  })
                }
                placeholder="0"
              />
            </div>

            <div className="flex items-center gap-6">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={paymentMethodForm.is_active}
                  onChange={(e) =>
                    setPaymentMethodForm({ ...paymentMethodForm, is_active: e.target.checked })
                  }
                />
                <span className="text-sm text-text-secondary">Active</span>
              </label>

              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={paymentMethodForm.is_default}
                  onChange={(e) =>
                    setPaymentMethodForm({ ...paymentMethodForm, is_default: e.target.checked })
                  }
                />
                <span className="text-sm text-text-secondary">Default (used for payment links)</span>
              </label>
            </div>

            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">Notes</label>
              <textarea
                className="input min-h-[72px]"
                value={paymentMethodForm.notes}
                onChange={(e) =>
                  setPaymentMethodForm({ ...paymentMethodForm, notes: e.target.value })
                }
                placeholder="Optional notes about this payment method"
              />
            </div>

            <div className="flex gap-2 justify-end">
              <Button type="button" variant="secondary" onClick={cancelPaymentMethodForm}>
                Cancel
              </Button>
              <Button type="submit">
                <Save className="w-4 h-4 mr-2" />
                {editingPaymentMethod ? 'Update' : 'Add'} Payment Method
              </Button>
            </div>
          </form>
        </div>
      )}

      {loadingPaymentMethods ? (
        <div className="flex justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-text-muted" />
        </div>
      ) : paymentMethods.length === 0 ? (
        <div className="text-center py-8 text-text-muted">
          <QrCode className="w-12 h-12 mx-auto mb-2 text-text-muted" />
          <p>No payment methods added yet</p>
          <p className="text-sm mt-1">Add a payment method to send payment links via WhatsApp</p>
        </div>
      ) : (
        <div className="space-y-3">
          {paymentMethods.map((method) => (
            <div
              key={method.id}
              className={clsx(
                'p-4 rounded-lg border',
                method.is_active
                  ? 'bg-surface border-border'
                  : 'bg-gray-50 dark:bg-slate-800/40 border-border opacity-75'
              )}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    {method.method_type === 'upi' && (
                      <QrCode className="w-4 h-4 text-primary-600" />
                    )}
                    {method.method_type === 'wallet' && (
                      <Wallet className="w-4 h-4 text-primary-600" />
                    )}
                    {method.method_type === 'bank_transfer' && (
                      <CreditCard className="w-4 h-4 text-primary-600" />
                    )}
                    <h4 className="font-medium text-text-primary">{method.method_name}</h4>
                    {method.is_default && (
                      <span className="px-2 py-0.5 text-xs bg-slate-100 text-primary-700 rounded-full">
                        Default
                      </span>
                    )}
                    {method.is_active && !method.is_default && (
                      <span className="px-2 py-0.5 text-xs bg-green-100 text-green-700 rounded-full">
                        Active
                      </span>
                    )}
                    {!method.is_active && (
                      <span className="px-2 py-0.5 text-xs bg-gray-100 dark:bg-slate-700 text-text-secondary rounded-full">
                        Inactive
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-text-secondary space-y-1">
                    <p>
                      <span className="font-medium">Type:</span>{' '}
                      {String(method.method_type).replace('_', ' ').toUpperCase()}
                    </p>
                    {method.upi_id && (
                      <p>
                        <span className="font-medium">UPI ID:</span> {method.upi_id}
                      </p>
                    )}
                    {method.wallet_provider && (
                      <p>
                        <span className="font-medium">Provider:</span> {method.wallet_provider}
                      </p>
                    )}
                    {method.notes && (
                      <p>
                        <span className="font-medium">Notes:</span> {method.notes}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex gap-2 ml-4">
                  <button
                    type="button"
                    onClick={() => startEditPaymentMethod(method)}
                    className="p-2 text-text-secondary hover:text-primary-600 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg transition-colors"
                    title="Edit"
                  >
                    <Edit className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => deletePaymentMethod(method.id)}
                    className="p-2 text-text-secondary hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-lg transition-colors"
                    title="Delete"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

