'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Plus, Search, Calendar, User, ArrowLeft, Printer, Loader2, Download } from 'lucide-react';
import { SplitPaneLayout } from '@/components/layout/SplitPaneLayout';
import { ListPageHeader } from '@/components/layout/ListPageHeader';
import { PaymentDetailPanel } from '@/components/payments/PaymentDetailPanel';
import { clsx } from 'clsx';
import { useAuth } from '@/contexts/AuthContext';
import { useBranch } from '@/contexts/BranchContext';
import { useToastContext } from '@/contexts/ToastContext';
import { useLayoutData } from '@/contexts/LayoutDataContext';

interface Payment {
  id: string;
  customer_id: string | null;
  customer_name: string | null;
  reference_type: string | null;
  reference_id: string | null;
  amount: number;
  payment_mode: string;
  payment_date: string;
  notes: string | null;
  created_at: string;
}

interface Invoice {
  id: string;
  invoice_number: string;
  customer_id: string | null;
  customer_name: string | null;
  grand_total: number;
  paid_amount: number;
  balance_amount: number;
  invoice_date: string;
}

interface Customer {
  id: string;
  name: string;
  phone: string | null;
}

export default function PaymentInPage() {
  const router = useRouter();
  const { business, user } = useAuth();
  const { currentBranchId, isLoading: branchLoading } = useBranch();
  const toast = useToastContext();
  const { refreshBadgeCounts } = useLayoutData();
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedPaymentId, setSelectedPaymentId] = useState<string | null>(null);
  
  const [formData, setFormData] = useState({
    customer_id: '',
    invoice_id: '',
    amount: '',
    payment_mode: 'cash',
    payment_date: new Date().toISOString().split('T')[0],
    notes: ''
  });

  useEffect(() => {
    // Wait for branch context to be ready before fetching
    if (business?.id && !branchLoading) {
      fetchPayments();
      fetchCustomers();
    }
  }, [business, currentBranchId, branchLoading]);

  useEffect(() => {
    if (formData.customer_id && business?.id) {
      fetchCustomerInvoices(formData.customer_id);
    } else {
      setInvoices([]);
    }
  }, [formData.customer_id, business?.id]);

  async function fetchPayments() {
    if (!business?.id) return;
    try {
      const response = await fetch(`/api/payments?business_id=${business.id}&type=receivable&user_id=${user?.id}`);
      const data = await response.json();
      setPayments(data.payments || []);
    } catch (error) {
      console.error('Error fetching payments:', error);
    } finally {
      setLoading(false);
    }
  }

  async function fetchCustomers() {
    if (!business?.id) return;
    try {
      const response = await fetch(`/api/customers?business_id=${business.id}&user_id=${user?.id}`);
      const data = await response.json();
      setCustomers(data.customers || []);
    } catch (error) {
      console.error('Error fetching customers:', error);
    }
  }

  async function fetchCustomerInvoices(customerId: string) {
    if (!business?.id) return;
    try {
      const response = await fetch(`/api/invoices?business_id=${business.id}&status=all&user_id=${user?.id}`);
      const data = await response.json();
      // Filter invoices for this customer with balance
      const filteredInvoices = (data.invoices || []).filter((inv: Invoice) => 
        inv.customer_id === customerId && 
        (Number(inv.balance_amount || inv.grand_total) - Number(inv.paid_amount || 0)) > 0
      );
      setInvoices(filteredInvoices);
    } catch (error) {
      console.error('Error fetching invoices:', error);
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!business?.id) return;

    const paymentAmount = parseFloat(formData.amount);
    if (!paymentAmount || paymentAmount <= 0) {
      toast.error('Please enter a valid amount');
      return;
    }

    if (formData.invoice_id) {
      const selectedInvoice = invoices.find(inv => inv.id === formData.invoice_id);
      if (selectedInvoice) {
        const balance = Number(selectedInvoice.balance_amount || selectedInvoice.grand_total) - Number(selectedInvoice.paid_amount || 0);
        if (paymentAmount > balance) {
          toast.error(`Payment amount cannot exceed balance of ₹${balance.toLocaleString()}`);
          return;
        }
      }
    }

    try {
      const response = await fetch('/api/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: business.id,
          type: 'receivable',
          customer_id: formData.customer_id || null,
          reference_type: formData.invoice_id ? 'invoice' : null,
          created_by: user?.id, // Required for authorization
          reference_id: formData.invoice_id || null,
          amount: paymentAmount,
          payment_mode: formData.payment_mode,
          payment_date: formData.payment_date,
          notes: formData.notes || null
        })
      });

      if (response.ok) {
        toast.success('Payment recorded successfully');
        setShowForm(false);
        setFormData({
          customer_id: '',
          invoice_id: '',
          amount: '',
          payment_mode: 'cash',
          payment_date: new Date().toISOString().split('T')[0],
          notes: ''
        });
        await refreshBadgeCounts();
        fetchPayments();
      } else {
        const error = await response.json();
        toast.error(error.error || 'Failed to record payment');
      }
    } catch (error) {
      console.error('Error recording payment:', error);
      toast.error('Failed to record payment');
    }
  };

  const [printingReceipt, setPrintingReceipt] = useState<string | null>(null);
  const [downloadingReceipt, setDownloadingReceipt] = useState<string | null>(null);

  const handlePrintReceipt = async (paymentId: string) => {
    try {
      setPrintingReceipt(paymentId);
      const res = await fetch(`/api/payments/${paymentId}/receipt`);
      if (res.ok) {
        const { html } = await res.json();
        const printWindow = window.open('', '_blank');
        if (printWindow) {
          printWindow.document.write(html);
          printWindow.document.close();
          printWindow.focus();
          setTimeout(() => {
            printWindow.print();
          }, 500);
        }
      }
    } catch (error) {
      console.error('Error printing receipt:', error);
    } finally {
      setPrintingReceipt(null);
    }
  };

  const handleDownloadReceipt = async (paymentId: string) => {
    try {
      setDownloadingReceipt(paymentId);
      const res = await fetch(`/api/payments/${paymentId}/receipt/pdf`);
      if (res.ok) {
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Receipt-${paymentId.substring(0, 8)}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
    } catch (error) {
      console.error('Error downloading receipt:', error);
    } finally {
      setDownloadingReceipt(null);
    }
  };

  const filteredPayments = payments.filter(payment => {
    if (!searchTerm) return true;
    const search = searchTerm.toLowerCase();
    return (
      payment.customer_name?.toLowerCase().includes(search) ||
      payment.payment_mode?.toLowerCase().includes(search) ||
      payment.amount.toString().includes(search)
    );
  });

  const selectedInvoice = invoices.find(inv => inv.id === formData.invoice_id);
  const invoiceBalance = selectedInvoice 
    ? Number(selectedInvoice.balance_amount || selectedInvoice.grand_total) - Number(selectedInvoice.paid_amount || 0)
    : null;

  const referenceLabel = (p: Payment) => {
    if (p.reference_type === 'invoice') return 'Invoice';
    return 'On account';
  };

  useEffect(() => {
    if (selectedPaymentId && !payments.some((p) => p.id === selectedPaymentId)) {
      setSelectedPaymentId(null);
    }
  }, [payments, selectedPaymentId]);

  const isPaymentDetailOpen = selectedPaymentId !== null;

  const paymentToolbar = (
    <Card padding="md">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="text"
          placeholder="Search by customer, mode, or amount..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="input pl-10"
        />
      </div>
    </Card>
  );

  const paymentCompactList = (
    <Card padding="none" className="overflow-hidden h-full flex flex-col">
      <div className="p-3 border-b border-border">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="input pl-10 h-9 text-sm w-full"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto divide-y divide-border">
        {loading ? (
          <div className="p-8 flex justify-center">
            <Loader2 className="w-5 h-5 animate-spin text-primary-500" />
          </div>
        ) : filteredPayments.length === 0 ? (
          <div className="p-8 text-center text-sm text-text-secondary">No payments</div>
        ) : (
          filteredPayments.map((payment) => (
            <button
              key={payment.id}
              type="button"
              onClick={() => setSelectedPaymentId(payment.id)}
              className={clsx(
                'w-full text-left p-3 flex flex-col gap-1 transition-colors',
                selectedPaymentId === payment.id
                  ? 'bg-slate-50 border-l-[3px] border-primary-500'
                  : 'hover:bg-gray-50 border-l-[3px] border-transparent'
              )}
            >
              <div className="font-semibold text-sm text-text-primary truncate">
                {payment.customer_name || 'Cash sale'}
              </div>
              <div className="text-xs text-green-600 font-medium">
                +₹{Number(payment.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </div>
            </button>
          ))
        )}
      </div>
    </Card>
  );

  return (
    
      <div className="space-y-6 pb-4">
        <ListPageHeader
          title="Payment in"
          description="Money received from customers — with or without a specific invoice."
          actions={
            !showForm ? (
              <Button className="w-full sm:w-auto shrink-0" onClick={() => setShowForm(true)}>
                <Plus className="w-4 h-4 mr-2" />
                Record payment
              </Button>
            ) : undefined
          }
        />

        {/* Payment Form */}
        {showForm && (
          <Card className="p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-semibold">Record Payment</h2>
              <Button variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Customer *
                  </label>
                  <select
                    className="w-full border border-gray-300 rounded-md px-3 py-2"
                    value={formData.customer_id}
                    onChange={(e) => setFormData({ ...formData, customer_id: e.target.value, invoice_id: '' })}
                    required
                  >
                    <option value="">Select Customer</option>
                    {customers.map(customer => (
                      <option key={customer.id} value={customer.id}>
                        {customer.name} {customer.phone ? `(${customer.phone})` : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Invoice (Optional)
                  </label>
                  <select
                    className="w-full border border-gray-300 rounded-md px-3 py-2"
                    value={formData.invoice_id}
                    onChange={(e) => {
                      setFormData({ ...formData, invoice_id: e.target.value });
                      const inv = invoices.find(i => i.id === e.target.value);
                      if (inv) {
                        const balance = Number(inv.balance_amount || inv.grand_total) - Number(inv.paid_amount || 0);
                        setFormData(prev => ({ ...prev, amount: balance.toString() }));
                      }
                    }}
                    disabled={!formData.customer_id}
                  >
                    <option value="">No specific invoice</option>
                    {invoices.map(invoice => {
                      const balance = Number(invoice.balance_amount || invoice.grand_total) - Number(invoice.paid_amount || 0);
                      return (
                        <option key={invoice.id} value={invoice.id}>
                          {invoice.invoice_number} - Balance: ₹{balance.toLocaleString()}
                        </option>
                      );
                    })}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Amount *
                  </label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={formData.amount}
                    onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                    required
                    placeholder="0.00"
                  />
                  {invoiceBalance !== null && (
                    <p className="text-xs text-gray-500 mt-1">
                      Invoice Balance: ₹{invoiceBalance.toLocaleString()}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Payment Mode *
                  </label>
                  <select
                    className="w-full border border-gray-300 rounded-md px-3 py-2"
                    value={formData.payment_mode}
                    onChange={(e) => setFormData({ ...formData, payment_mode: e.target.value })}
                    required
                  >
                    <option value="cash">Cash</option>
                    <option value="bank">Bank Transfer</option>
                    <option value="upi">UPI</option>
                    <option value="cheque">Cheque</option>
                    <option value="card">Card</option>
                    <option value="credit">Credit</option>
                    <option value="other">Other</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Payment Date *
                  </label>
                  <Input
                    type="date"
                    value={formData.payment_date}
                    onChange={(e) => setFormData({ ...formData, payment_date: e.target.value })}
                    required
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Notes
                  </label>
                  <textarea
                    className="w-full border border-gray-300 rounded-md px-3 py-2"
                    rows={3}
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    placeholder="Optional notes about this payment"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4">
                <Button type="button" variant="ghost" onClick={() => setShowForm(false)}>
                  Cancel
                </Button>
                <Button type="submit">Record Payment</Button>
              </div>
            </form>
          </Card>
        )}

        {/* Payments List */}
        {!showForm && (
          <SplitPaneLayout
            isDetailOpen={isPaymentDetailOpen}
            onCloseDetail={() => setSelectedPaymentId(null)}
            toolbarSlot={paymentToolbar}
            listSlot={
              isPaymentDetailOpen ? (
                paymentCompactList
              ) : (
            <Card padding="md">
              {loading ? (
                <div className="text-center py-8">Loading payments...</div>
              ) : filteredPayments.length === 0 ? (
                <div className="text-center py-8 text-gray-500">No payments found</div>
              ) : (
                <>
                  <div className="md:hidden space-y-3">
                    {filteredPayments.map((payment) => (
                      <div
                        key={payment.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => setSelectedPaymentId(payment.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') setSelectedPaymentId(payment.id);
                        }}
                        className="rounded-xl border border-border bg-surface p-4 space-y-3 cursor-pointer hover:bg-slate-50/30"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <p className="font-semibold text-text-primary truncate">
                              {payment.customer_name || 'Cash sale'}
                            </p>
                            <p className="text-xs text-text-muted mt-0.5 flex items-center gap-1">
                              <Calendar className="w-3.5 h-3.5 shrink-0" />
                              {new Date(payment.payment_date).toLocaleDateString('en-IN', {
                                day: 'numeric',
                                month: 'short',
                                year: 'numeric',
                              })}
                            </p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-lg font-bold text-green-600 tabular-nums">
                              +₹{Number(payment.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                            </p>
                            <p className="text-xs text-text-muted capitalize mt-0.5">
                              {payment.payment_mode}
                            </p>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-text-secondary">
                          <span className="rounded-md bg-slate-50 text-primary-800 px-2 py-0.5 font-medium">
                            {referenceLabel(payment)}
                          </span>
                          {payment.notes ? (
                            <span className="truncate max-w-full">{payment.notes}</span>
                          ) : null}
                        </div>
                        <div className="flex justify-end gap-1 pt-1 border-t border-border" onClick={(e) => e.stopPropagation()}>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handlePrintReceipt(payment.id)}
                            disabled={!!printingReceipt || !!downloadingReceipt}
                            title="Print receipt"
                          >
                            {printingReceipt === payment.id ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Printer className="w-4 h-4" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDownloadReceipt(payment.id)}
                            disabled={!!printingReceipt || !!downloadingReceipt}
                            title="Download PDF"
                          >
                            {downloadingReceipt === payment.id ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Download className="w-4 h-4" />
                            )}
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="hidden md:block overflow-x-auto">
                    <table className="w-full min-w-[640px]">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left py-3 px-4 font-medium text-gray-700">Date</th>
                          <th className="text-left py-3 px-4 font-medium text-gray-700">Customer</th>
                          <th className="text-left py-3 px-4 font-medium text-gray-700">Reference</th>
                          <th className="text-right py-3 px-4 font-medium text-gray-700">Amount</th>
                          <th className="text-left py-3 px-4 font-medium text-gray-700">Mode</th>
                          <th className="text-left py-3 px-4 font-medium text-gray-700">Notes</th>
                          <th className="text-right py-3 px-4 font-medium text-gray-700">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredPayments.map((payment) => (
                          <tr
                            key={payment.id}
                            className="border-b hover:bg-gray-50 cursor-pointer"
                            onClick={() => setSelectedPaymentId(payment.id)}
                          >
                            <td className="py-3 px-4">
                              <div className="flex items-center gap-2 text-sm text-gray-600">
                                <Calendar className="w-4 h-4" />
                                {new Date(payment.payment_date).toLocaleDateString()}
                              </div>
                            </td>
                            <td className="py-3 px-4">
                              <div className="flex items-center gap-2">
                                <User className="w-4 h-4 text-gray-400" />
                                <span className="text-sm font-medium">{payment.customer_name || 'Cash Sale'}</span>
                              </div>
                            </td>
                            <td className="py-3 px-4 text-sm text-gray-600">
                              {referenceLabel(payment)}
                            </td>
                            <td className="py-3 px-4 text-right">
                              <span className="text-sm font-semibold text-green-600">
                                +₹{Number(payment.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                              </span>
                            </td>
                            <td className="py-3 px-4 text-sm text-gray-600 capitalize">
                              {payment.payment_mode}
                            </td>
                            <td className="py-3 px-4 text-sm text-gray-500">
                              {payment.notes || '-'}
                            </td>
                            <td className="py-3 px-4 text-right" onClick={(e) => e.stopPropagation()}>
                              <div className="flex items-center justify-end gap-1">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handlePrintReceipt(payment.id)}
                                  disabled={!!printingReceipt || !!downloadingReceipt}
                                  title="Print Receipt"
                                >
                                  {printingReceipt === payment.id ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                  ) : (
                                    <Printer className="w-4 h-4" />
                                  )}
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleDownloadReceipt(payment.id)}
                                  disabled={!!printingReceipt || !!downloadingReceipt}
                                  title="Download Receipt"
                                >
                                  {downloadingReceipt === payment.id ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                  ) : (
                                    <Download className="w-4 h-4" />
                                  )}
                                </Button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </Card>
              )
            }
            detailSlot={
              selectedPaymentId ? (
                <PaymentDetailPanel
                  paymentId={selectedPaymentId}
                  paymentKind="receivable"
                  onClose={() => setSelectedPaymentId(null)}
                />
              ) : null
            }
          />
        )}
      </div>
    
  );
}

