'use client';

export const dynamic = 'force-dynamic';

import { PageHeader } from '@/components/layout/PageHeader';
import React, { useState, useEffect } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Search, Loader2, FileText, Calendar } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { format } from 'date-fns';

interface LedgerEntry {
  id: string;
  entry_date: string;
  account_id: string;
  account_code: string;
  account_name: string;
  voucher_number?: string | null;
  voucher_type?: string | null;
  reference_number?: string | null;
  narration?: string | null;
  debit: number;
  credit: number;
  source?: string;
}

const VOUCHER_TYPES: { value: string; label: string }[] = [
  { value: 'invoice', label: 'Invoice' },
  { value: 'payment', label: 'Payment' },
  { value: 'purchase', label: 'Purchase' },
  { value: 'expense', label: 'Expense' },
  { value: 'journal', label: 'Journal' },
  { value: 'contra', label: 'Contra' },
  { value: 'opening_balance', label: 'Opening balance' },
  { value: 'opening_stock', label: 'Opening stock' },
  { value: 'credit_note', label: 'Credit note' },
  { value: 'debit_note', label: 'Debit note' },
  { value: 'purchase_return', label: 'Purchase return' },
  { value: 'supplier_credit_note', label: 'Supplier credit note' },
  { value: 'credit_note_refund', label: 'Credit note refund' },
  { value: 'advance_receipt', label: 'Advance receipt' },
  { value: 'advance_adjustment', label: 'Advance adjustment' },
  { value: 'advance_refund', label: 'Advance refund' },
  { value: 'gst_setoff', label: 'GST set-off' },
  { value: 'gst_payment', label: 'GST payment' },
  { value: 'gst_cash_deposit', label: 'GST cash deposit' },
  { value: 'gst_cash_utilization', label: 'GST cash utilisation' },
  { value: 'stock_adjustment', label: 'Stock adjustment' },
  { value: 'itc_reversal', label: 'ITC reversal' },
  { value: 'tds', label: 'TDS' },
  { value: 'asset_purchase', label: 'Asset purchase' },
  { value: 'depreciation', label: 'Depreciation' },
  { value: 'asset_disposal', label: 'Asset disposal' },
  { value: 'provision', label: 'Provision' },
  { value: 'tax_provision', label: 'Tax provision' },
  { value: 'inter_branch_receipt', label: 'Inter-branch receipt' },
  { value: 'staff_wage_accrual', label: 'Staff wage accrual' },
  { value: 'staff_wage_payment', label: 'Staff wage payment' },
  { value: 'salary_advance', label: 'Salary advance' },
  { value: 'salary_payment', label: 'Salary payment' },
];

function voucherLabel(type?: string | null): string {
  if (!type) return '';
  return VOUCHER_TYPES.find((item) => item.value === type)?.label || type.replace(/_/g, ' ');
}

/** 1 April of the Indian financial year that contains today. */
function indianFinancialYearStart(today = new Date()): string {
  const year = today.getMonth() < 3 ? today.getFullYear() - 1 : today.getFullYear();
  return format(new Date(year, 3, 1), 'yyyy-MM-dd');
}

function calendarDate(value: unknown): string | null {
  const match = String(value ?? '').match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

export default function LedgerPage() {
  const { business } = useAuth();
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [fromDate, setFromDate] = useState(indianFinancialYearStart);
  const [toDate, setToDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [voucherType, setVoucherType] = useState<string>('all');
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, totalPages: 0 });

  useEffect(() => {
    if (!business?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/financial-years?business_id=${business.id}`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const today = format(new Date(), 'yyyy-MM-dd');
        const current = (data.years || []).find((year: { is_closed?: boolean; start_date?: string; end_date?: string }) => {
          if (year.is_closed) return false;
          const start = calendarDate(year.start_date);
          const end = calendarDate(year.end_date);
          return !!start && !!end && start <= today && end >= today;
        });
        const start = calendarDate(current?.start_date);
        if (start) setFromDate(start);
      } catch {
        // Keep the Indian financial-year default.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [business?.id]);

  useEffect(() => {
    if (business?.id) {
      fetchEntries();
    }
  }, [business?.id, fromDate, toDate, voucherType, pagination.page]);

  useEffect(() => {
    if (business?.id) {
      // Reset to page 1 when filters change
      setPagination(prev => ({ ...prev, page: 1 }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [business?.id, fromDate, toDate, voucherType]);

  const fetchEntries = async () => {
    if (!business?.id) return;

    setLoading(true);
    try {
      const params = new URLSearchParams({
        business_id: business.id,
        from_date: fromDate,
        to_date: toDate,
        ...(voucherType !== 'all' && { voucher_type: voucherType }),
        page: pagination.page.toString(),
        limit: pagination.limit.toString(),
      });

      const res = await fetch(`/api/ledger?${params}`);
      if (res.ok) {
        const data = await res.json();
        setEntries(data.entries || []);
        if (data.pagination) {
          setPagination(data.pagination);
        }
      }
    } catch (error) {
      console.error('Error fetching ledger entries:', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredEntries = entries.filter(entry => {
    if (!search) return true;
    const searchLower = search.toLowerCase();
    return (
      entry.account_name?.toLowerCase().includes(searchLower) ||
      entry.account_code?.toLowerCase().includes(searchLower) ||
      entry.voucher_number?.toLowerCase().includes(searchLower) ||
      entry.reference_number?.toLowerCase().includes(searchLower) ||
      entry.narration?.toLowerCase().includes(searchLower) ||
      voucherLabel(entry.voucher_type).toLowerCase().includes(searchLower)
    );
  });

  return (
    
      <div className="space-y-6">
        <div>
          <PageHeader
  title="Ledger"
  subtitle="View all ledger entries"
/>
        </div>

        <Card>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-text-secondary w-4 h-4" />
              <Input
                placeholder="Search..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
              />
            </div>
            <Input
              type="date"
              label="From Date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
            />
            <Input
              type="date"
              label="To Date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
            />
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">
                Voucher Type
              </label>
              <select
                value={voucherType}
                onChange={(e) => setVoucherType(e.target.value)}
                className="input"
              >
                <option value="all">All Types</option>
                {VOUCHER_TYPES.map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </select>
            </div>
          </div>
        </Card>

        <Card>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
            </div>
          ) : filteredEntries.length === 0 ? (
            <div className="text-center py-12">
              <FileText className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <p className="text-text-secondary">No ledger entries found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-3 px-4 font-semibold text-text-primary">Date</th>
                    <th className="text-left py-3 px-4 font-semibold text-text-primary">Account</th>
                    <th className="text-left py-3 px-4 font-semibold text-text-primary">Voucher</th>
                    <th className="text-left py-3 px-4 font-semibold text-text-primary">Narration</th>
                    <th className="text-right py-3 px-4 font-semibold text-text-primary">Debit</th>
                    <th className="text-right py-3 px-4 font-semibold text-text-primary">Credit</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEntries.map((entry) => (
                    <tr key={`${entry.source || 'row'}-${entry.id}`} className="border-b border-border hover:bg-gray-50">
                      <td className="py-4 px-4">
                        {format(new Date(entry.entry_date), 'dd MMM yyyy')}
                      </td>
                      <td className="py-4 px-4">
                        <div>
                          <div className="font-medium">{entry.account_name}</div>
                          <div className="text-sm text-text-secondary font-mono">{entry.account_code}</div>
                        </div>
                      </td>
                      <td className="py-4 px-4">
                        <div className="text-sm">{entry.voucher_number || entry.reference_number || '—'}</div>
                        {entry.voucher_type && (
                          <div className="text-xs text-text-secondary">{voucherLabel(entry.voucher_type)}</div>
                        )}
                      </td>
                      <td className="py-4 px-4">
                        {entry.narration && (
                          <span className="text-sm text-text-secondary">{entry.narration}</span>
                        )}
                      </td>
                      <td className="py-4 px-4 text-right">
                        {Number(entry.debit) > 0 && (
                          <span className="text-primary-600">
                            ₹{Number(entry.debit).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                          </span>
                        )}
                      </td>
                      <td className="py-4 px-4 text-right">
                        {Number(entry.credit) > 0 && (
                          <span className="text-green-600">
                            ₹{Number(entry.credit).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination Controls */}
          {pagination.totalPages > 1 && (
            <div className="flex justify-between items-center p-4 border-t border-border">
              <p className="text-sm text-text-secondary">
                Page {pagination.page} of {pagination.totalPages} ({pagination.total} entries)
              </p>
              <div className="flex space-x-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setPagination(prev => ({ ...prev, page: Math.max(1, prev.page - 1) }))}
                  disabled={pagination.page === 1}
                >
                  Previous
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setPagination(prev => ({ ...prev, page: Math.min(prev.totalPages, prev.page + 1) }))}
                  disabled={pagination.page === pagination.totalPages}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </Card>
      </div>
    
  );
}

