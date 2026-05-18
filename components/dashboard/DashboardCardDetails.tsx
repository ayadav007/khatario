'use client';

import React from 'react';
import { X, Loader2 } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { format } from 'date-fns';
import { Chip } from '@/components/ui/Chip';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';

interface Invoice {
  id: string;
  invoice_number: string;
  customer_name?: string;
  invoice_date: string;
  grand_total: number;
  paid_amount: number;
  balance_amount: number;
  payment_status: string;
  status: string;
}

interface Purchase {
  id: string;
  bill_number: string | null;
  supplier_name?: string;
  bill_date: string;
  grand_total: number;
  paid_amount: number;
  status: string;
}

interface DashboardCardDetailsProps {
  type: 'sales' | 'purchases' | 'receivables' | 'payables';
  title: string;
  data: Invoice[] | Purchase[];
  loading?: boolean;
  onClose: () => void;
}

export function DashboardCardDetails({ type, title, data, loading = false, onClose }: DashboardCardDetailsProps) {
  const total = data.reduce((sum: number, item: any) => {
    if (type === 'sales' || type === 'receivables') {
      return sum + Number(item.grand_total || 0);
    } else {
      return sum + Number(item.grand_total || 0);
    }
  }, 0);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <Card className="w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-border">
          <div>
            <h2 className="text-xl font-semibold text-text-primary">{title}</h2>
            <p className="text-sm text-text-secondary mt-1">
              Total: ₹{total.toLocaleString('en-IN')} • {data.length} {data.length === 1 ? 'item' : 'items'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg transition-colors text-text-secondary"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
            </div>
          ) : data.length === 0 ? (
            <div className="text-center py-12 text-text-secondary">
              <p>No {title.toLowerCase()} found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    {(type === 'sales' || type === 'receivables') ? (
                      <>
                        <th className="text-left py-3 px-4 font-medium text-text-secondary">Invoice #</th>
                        <th className="text-left py-3 px-4 font-medium text-text-secondary">Customer</th>
                        <th className="text-left py-3 px-4 font-medium text-text-secondary">Date</th>
                        <th className="text-right py-3 px-4 font-medium text-text-secondary">Amount</th>
                        {type === 'receivables' && (
                          <>
                            <th className="text-right py-3 px-4 font-medium text-text-secondary">Paid</th>
                            <th className="text-right py-3 px-4 font-medium text-text-secondary">Balance</th>
                          </>
                        )}
                        <th className="text-center py-3 px-4 font-medium text-text-secondary">Status</th>
                      </>
                    ) : (
                      <>
                        <th className="text-left py-3 px-4 font-medium text-text-secondary">Bill #</th>
                        <th className="text-left py-3 px-4 font-medium text-text-secondary">Supplier</th>
                        <th className="text-left py-3 px-4 font-medium text-text-secondary">Date</th>
                        <th className="text-right py-3 px-4 font-medium text-text-secondary">Amount</th>
                        {type === 'payables' && (
                          <>
                            <th className="text-right py-3 px-4 font-medium text-text-secondary">Paid</th>
                            <th className="text-right py-3 px-4 font-medium text-text-secondary">Balance</th>
                          </>
                        )}
                        <th className="text-center py-3 px-4 font-medium text-text-secondary">Status</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {data.map((item: any) => {
                    if (type === 'sales' || type === 'receivables') {
                      const invoice = item as Invoice;
                      const balance = Number(invoice.balance_amount || invoice.grand_total) - Number(invoice.paid_amount || 0);
                      
                      return (
                        <tr key={invoice.id} className="border-b border-border hover:bg-slate-100/80 dark:hover:bg-slate-800/60">
                          <td className="py-3 px-4">
                            <Link 
                              href={`/invoices/${invoice.id}`}
                              className="text-primary-600 dark:text-primary-400 hover:underline font-medium"
                              onClick={onClose}
                            >
                              {invoice.invoice_number}
                            </Link>
                          </td>
                          <td className="py-3 px-4 text-sm text-text-primary">{invoice.customer_name || 'Cash Sale'}</td>
                          <td className="py-3 px-4 text-sm text-text-secondary">
                            {format(new Date(invoice.invoice_date), 'dd MMM yyyy')}
                          </td>
                          <td className="py-3 px-4 text-right font-medium text-text-primary">
                            ₹{Number(invoice.grand_total).toLocaleString('en-IN')}
                          </td>
                          {type === 'receivables' && (
                            <>
                              <td className="py-3 px-4 text-right text-sm text-text-secondary">
                                ₹{Number(invoice.paid_amount || 0).toLocaleString('en-IN')}
                              </td>
                              <td className="py-3 px-4 text-right font-medium text-warning">
                                ₹{balance.toLocaleString('en-IN')}
                              </td>
                            </>
                          )}
                          <td className="py-3 px-4 text-center">
                            <Chip
                              variant={
                                invoice.payment_status === 'paid'
                                  ? 'success'
                                  : invoice.payment_status === 'partially_paid'
                                  ? 'warning'
                                  : invoice.status === 'final'
                                  ? 'default'
                                  : 'secondary'
                              }
                            >
                              {invoice.payment_status || invoice.status}
                            </Chip>
                          </td>
                        </tr>
                      );
                    } else {
                      const purchase = item as Purchase;
                      const balance = Number(purchase.grand_total) - Number(purchase.paid_amount || 0);
                      
                      return (
                        <tr key={purchase.id} className="border-b border-border hover:bg-slate-100/80 dark:hover:bg-slate-800/60">
                          <td className="py-3 px-4">
                            <Link 
                              href={`/purchases/new?edit=${purchase.id}`}
                              className="text-primary-600 dark:text-primary-400 hover:underline font-medium"
                              onClick={onClose}
                            >
                              {purchase.bill_number || purchase.id.slice(0, 8)}
                            </Link>
                          </td>
                          <td className="py-3 px-4 text-sm text-text-primary">{purchase.supplier_name || 'N/A'}</td>
                          <td className="py-3 px-4 text-sm text-text-secondary">
                            {format(new Date(purchase.bill_date), 'dd MMM yyyy')}
                          </td>
                          <td className="py-3 px-4 text-right font-medium text-text-primary">
                            ₹{Number(purchase.grand_total).toLocaleString('en-IN')}
                          </td>
                          {type === 'payables' && (
                            <>
                              <td className="py-3 px-4 text-right text-sm text-text-secondary">
                                ₹{Number(purchase.paid_amount || 0).toLocaleString('en-IN')}
                              </td>
                              <td className="py-3 px-4 text-right font-medium text-error">
                                ₹{balance.toLocaleString('en-IN')}
                              </td>
                            </>
                          )}
                          <td className="py-3 px-4 text-center">
                            <Chip
                              variant={
                                purchase.status === 'final'
                                  ? 'success'
                                  : purchase.status === 'draft'
                                  ? 'secondary'
                                  : 'default'
                              }
                            >
                              {purchase.status}
                            </Chip>
                          </td>
                        </tr>
                      );
                    }
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 p-6 border-t border-border">
          <Button variant="ghost" onClick={onClose}>Close</Button>
          {(type === 'sales' || type === 'receivables') && (
            <Link href="/invoices" onClick={onClose}>
              <Button>View All Invoices</Button>
            </Link>
          )}
          {(type === 'purchases' || type === 'payables') && (
            <Link href="/purchases" onClick={onClose}>
              <Button>View All Purchases</Button>
            </Link>
          )}
        </div>
      </Card>
    </div>
  );
}

