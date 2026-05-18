'use client';

export const dynamic = 'force-dynamic';

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
  voucher_number?: string;
  voucher_type?: string;
  reference_number?: string;
  debit: number;
  credit: number;
  balance: number;
  description?: string;
}

export default function LedgerPage() {
  const { business } = useAuth();
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [fromDate, setFromDate] = useState(format(new Date(new Date().getFullYear(), 0, 1), 'yyyy-MM-dd'));
  const [toDate, setToDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [voucherType, setVoucherType] = useState<string>('all');
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, totalPages: 0 });

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
      entry.reference_number?.toLowerCase().includes(searchLower)
    );
  });

  return (
    
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Ledger</h1>
          <p className="text-sm text-text-secondary mt-1">View all ledger entries</p>
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
                <option value="invoice">Invoice</option>
                <option value="payment">Payment</option>
                <option value="purchase">Purchase</option>
                <option value="expense">Expense</option>
                <option value="journal">Journal</option>
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
                    <th className="text-left py-3 px-4 font-semibold text-text-primary">Reference</th>
                    <th className="text-right py-3 px-4 font-semibold text-text-primary">Debit</th>
                    <th className="text-right py-3 px-4 font-semibold text-text-primary">Credit</th>
                    <th className="text-right py-3 px-4 font-semibold text-text-primary">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEntries.map((entry) => (
                    <tr key={entry.id} className="border-b border-border hover:bg-gray-50">
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
                        {entry.voucher_number && (
                          <span className="text-sm">{entry.voucher_number}</span>
                        )}
                      </td>
                      <td className="py-4 px-4">
                        {entry.reference_number && (
                          <span className="text-sm text-text-secondary">{entry.reference_number}</span>
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
                      <td className="py-4 px-4 text-right font-semibold">
                        ₹{Number(entry.balance).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
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

