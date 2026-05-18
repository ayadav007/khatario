'use client';

import React, { useState, useEffect } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useAuth } from '@/contexts/AuthContext';
import { format } from 'date-fns';
import { Toast } from '@/components/ui/Toast';
import { ConfirmDialog } from '@/components/whatsapp/ConfirmDialog';

interface Invoice {
  id: string;
  invoice_number: string;
  invoice_date: string;
  due_date: string;
  payment_status: string;
  grand_total: number;
  balance_amount: number;
  customer: {
    id: string | null;
    name: string;
    phone: string | null;
  };
}

const DEFAULT_TEMPLATE = `Hi {customer_name},

Invoice {invoice_no} for {balance_amount} is now overdue. The due date was {due_date}.

Please arrange payment immediately to avoid any inconvenience.

Thank you!
{business_name}`;

export function SendRemindersTab() {
  const { business, user } = useAuth();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [selectedInvoices, setSelectedInvoices] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [paymentStatusFilter, setPaymentStatusFilter] = useState<string>('both');
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [messageTemplate, setMessageTemplate] = useState(DEFAULT_TEMPLATE);
  const [includePdf, setIncludePdf] = useState(true);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' | 'warning' } | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{ title: string; message: string; onConfirm: () => void } | null>(null);

  useEffect(() => {
    if (business?.id) {
      fetchInvoices();
    }
  }, [business?.id, paymentStatusFilter, search, dateFrom, dateTo]);

  const fetchInvoices = async () => {
    if (!business?.id) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        business_id: business.id,
        payment_status: paymentStatusFilter,
        ...(search && { search }),
        ...(dateFrom && { date_from: dateFrom }),
        ...(dateTo && { date_to: dateTo }),
        user_id: user?.id || '' // Required for authorization
      });

      const res = await fetch(`/api/invoices/for-reminders?${params}`);
      if (res.ok) {
        const data = await res.json();
        setInvoices(data.invoices || []);
      }
    } catch (error) {
      console.error('Failed to fetch invoices:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      setSelectedInvoices(new Set(invoices.map(inv => inv.id)));
    } else {
      setSelectedInvoices(new Set());
    }
  };

  const handleSelectInvoice = (invoiceId: string, checked: boolean) => {
    const newSelected = new Set(selectedInvoices);
    if (checked) {
      newSelected.add(invoiceId);
    } else {
      newSelected.delete(invoiceId);
    }
    setSelectedInvoices(newSelected);
  };

  const performSend = async () => {
    setSending(true);
    try {
      const res = await fetch('/api/whatsapp/send-bulk-reminders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: business?.id,
          invoice_ids: Array.from(selectedInvoices),
          message_template: messageTemplate,
          include_pdf: includePdf
        })
      });

      const data = await res.json();

      if (res.ok) {
        setToast({
          message: `Reminders sent! Success: ${data.success_count}, Failed: ${data.failed_count}`,
          type: 'success'
        });
        setSelectedInvoices(new Set());
        fetchInvoices();
      } else {
        if (data.code === 'LIMIT_EXCEEDED') {
          setToast({ message: `Cannot send reminders: ${data.error}`, type: 'error' });
        } else {
          setToast({ message: `Failed to send reminders: ${data.error}`, type: 'error' });
        }
      }
    } catch (error) {
      console.error('Failed to send reminders:', error);
      setToast({ message: 'Failed to send reminders', type: 'error' });
    } finally {
      setSending(false);
    }
  };

  const handleSend = () => {
    if (selectedInvoices.size === 0) {
      setToast({ message: 'Please select at least one invoice', type: 'error' });
      return;
    }

    if (!messageTemplate.trim()) {
      setToast({ message: 'Please enter a message template', type: 'error' });
      return;
    }

    setConfirmDialog({
      title: 'Send reminders',
      message: `Send reminder to ${selectedInvoices.size} invoice(s)?`,
      onConfirm: () => {
        setConfirmDialog(null);
        void performSend();
      }
    });
  };

  const allSelected = invoices.length > 0 && selectedInvoices.size === invoices.length;
  const someSelected = selectedInvoices.size > 0 && selectedInvoices.size < invoices.length;

  return (
    <div className="space-y-6">
      {/* Filters */}
      <Card padding="lg">
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-gray-900">Filter Invoices</h3>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Payment Status</label>
              <select
                value={paymentStatusFilter}
                onChange={(e) => setPaymentStatusFilter(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                <option value="both">Both</option>
                <option value="unpaid">Unpaid</option>
                <option value="partially_paid">Partially Paid</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">From Date</label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">To Date</label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Search</label>
              <Input
                placeholder="Invoice # or Customer"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Invoice List */}
        <div className="lg:col-span-2">
          <Card padding="lg">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-900">Invoices</h3>
                <span className="text-sm text-gray-500">
                  {selectedInvoices.size} selected
                </span>
              </div>

              {loading ? (
                <div className="text-center py-8 text-gray-500">Loading...</div>
              ) : invoices.length === 0 ? (
                <div className="text-center py-8 text-gray-500">No invoices found</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left">
                          <input
                            type="checkbox"
                            checked={allSelected}
                            onChange={handleSelectAll}
                            className="rounded border-gray-300"
                            ref={(input) => {
                              if (input) {
                                input.indeterminate = someSelected;
                              }
                            }}
                          />
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Invoice #</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Customer</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Amount</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Balance</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Due Date</th>
                        <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Status</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {invoices.map((invoice) => (
                        <tr key={invoice.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3">
                            <input
                              type="checkbox"
                              checked={selectedInvoices.has(invoice.id)}
                              onChange={(e) => handleSelectInvoice(invoice.id, e.target.checked)}
                              className="rounded border-gray-300"
                            />
                          </td>
                          <td className="px-4 py-3 text-sm font-medium text-gray-900">{invoice.invoice_number}</td>
                          <td className="px-4 py-3 text-sm text-gray-900">{invoice.customer.name}</td>
                          <td className="px-4 py-3 text-sm text-gray-900 text-right">
                            ₹{invoice.grand_total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-900 text-right">
                            ₹{invoice.balance_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-900">
                            {invoice.due_date ? format(new Date(invoice.due_date), 'dd/MM/yyyy') : '-'}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className={`px-2 py-1 text-xs rounded-full ${
                              invoice.payment_status === 'paid' ? 'bg-green-100 text-green-800' :
                              invoice.payment_status === 'partially_paid' ? 'bg-yellow-100 text-yellow-800' :
                              'bg-red-100 text-red-800'
                            }`}>
                              {invoice.payment_status.replace('_', ' ')}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </Card>
        </div>

        {/* Message Configuration */}
        <div>
          <Card padding="lg">
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-gray-900">Message</h3>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Message Template
                </label>
                <textarea
                  value={messageTemplate}
                  onChange={(e) => setMessageTemplate(e.target.value)}
                  rows={10}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Placeholders: {'{customer_name}'}, {'{invoice_no}'}, {'{amount}'}, {'{due_date}'}, {'{balance_amount}'}, {'{business_name}'}
                </p>
              </div>

              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={includePdf}
                  onChange={(e) => setIncludePdf(e.target.checked)}
                  className="mr-2"
                />
                <span className="text-sm text-gray-700">Include PDF attachment</span>
              </label>

              <Button
                onClick={handleSend}
                disabled={selectedInvoices.size === 0 || sending}
                className="w-full"
              >
                {sending
                  ? `Sending...`
                  : `Send Reminder to ${selectedInvoices.size} Invoice(s)`
                }
              </Button>
            </div>
          </Card>
        </div>
      </div>

      {toast && (
        <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />
      )}
      <ConfirmDialog
        isOpen={!!confirmDialog}
        title={confirmDialog?.title || ''}
        message={confirmDialog?.message || ''}
        variant="default"
        confirmLabel="Send"
        onConfirm={() => {
          confirmDialog?.onConfirm();
        }}
        onCancel={() => setConfirmDialog(null)}
      />
    </div>
  );
}

