'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Plus, Search, Loader2, FileText, Eye, Edit, Lock, RotateCcw } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { format } from 'date-fns';
import Link from 'next/link';
import { useToastContext } from '@/contexts/ToastContext';
import { ReasonConfirmModal } from '@/components/modals/ReasonConfirmModal';
import {
  canManagePeriodLocks,
  describeAccountingError,
  type AccountingErrorView,
} from '@/lib/accounting-ui/errors';
import { REVERSAL_COPY } from '@/lib/accounting-ui/reversal';

const JOURNAL_LOCKED_MESSAGE = describeAccountingError(403, { code: 'JOURNAL_LOCKED' }, { context: 'journal', verb: 'reversed' }).message;

interface JournalEntry {
  voucher_id: string;
  voucher_number: string;
  entry_date: string;
  reference_number?: string;
  total_debit: number;
  total_credit: number;
  line_count: number;
  is_locked?: boolean;
  is_reversing?: boolean;
  is_reversed?: boolean;
  template_id?: string;
  tags?: string[];
  lines?: Array<{
    account_code: string;
    account_name: string;
    debit: number;
    credit: number;
    narration?: string;
  }>;
}

export default function JournalEntriesPage() {
  const { business, user, permissions, isPrimaryAdmin } = useAuth();
  const toast = useToastContext();
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [reversing, setReversing] = useState<JournalEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [fromDate, setFromDate] = useState(format(new Date(new Date().getFullYear(), 0, 1), 'yyyy-MM-dd'));
  const [toDate, setToDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, totalPages: 0 });

  useEffect(() => {
    if (business?.id) {
      fetchEntries();
    }
  }, [business?.id, fromDate, toDate, pagination.page]);

  useEffect(() => {
    if (business?.id) {
      // Reset to page 1 when date filters change
      setPagination(prev => ({ ...prev, page: 1 }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [business?.id, fromDate, toDate]);

  const fetchEntries = async () => {
    if (!business?.id) return;

    setLoading(true);
    try {
      const params = new URLSearchParams({
        business_id: business.id,
        user_id: user?.id || '', // Required for authorization
        from_date: fromDate,
        to_date: toDate,
        page: pagination.page.toString(),
        limit: pagination.limit.toString(),
      });

      const res = await fetch(`/api/journal-entries?${params}`);
      if (res.ok) {
        const data = await res.json();
        setEntries(data.entries || []);
        if (data.pagination) {
          setPagination(data.pagination);
        }
      }
    } catch (error) {
      console.error('Error fetching journal entries:', error);
    } finally {
      setLoading(false);
    }
  };

  const reverseEntry = async (reason: string): Promise<AccountingErrorView | null> => {
    if (!reversing || !business?.id) return null;
    let res: Response;
    try {
      res = await fetch(`/api/journal-entries/${reversing.voucher_id}/reverse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() }),
      });
    } catch {
      return { message: 'Could not reach the server. Check your connection and try again.' };
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      return describeAccountingError(res.status, data, {
        context: 'journal',
        verb: 'reversed',
        canManagePeriods: canManagePeriodLocks(isPrimaryAdmin, permissions),
        currentPath: '/journal-entries',
        fallback: 'Could not reverse the journal entry. Please try again.',
      });
    }
    setReversing(null);
    toast.success(REVERSAL_COPY.success);
    await fetchEntries();
    return null;
  };

  const filteredEntries = entries.filter(entry => {
    if (!search) return true;
    const searchLower = search.toLowerCase();
    return (
      entry.voucher_number?.toLowerCase().includes(searchLower) ||
      entry.reference_number?.toLowerCase().includes(searchLower)
    );
  });

  return (
    
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-text-primary">Journal Entries</h1>
            <p className="text-sm text-text-secondary mt-1">Manual accounting entries</p>
          </div>
          <Link href="/journal-entries/new">
            <Button>
              <Plus className="w-4 h-4 mr-2" />
              New Journal Entry
            </Button>
          </Link>
        </div>

        <Card>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <Input
              label="Search"
              icon={<Search className="h-4 w-4" />}
              placeholder="Search by voucher number..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
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
              <p className="text-text-secondary">No journal entries found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-3 px-4 font-semibold text-text-primary">Date</th>
                    <th className="text-left py-3 px-4 font-semibold text-text-primary">Voucher Number</th>
                    <th className="text-left py-3 px-4 font-semibold text-text-primary">Reference</th>
                    <th className="text-left py-3 px-4 font-semibold text-text-primary">Lines</th>
                    <th className="text-right py-3 px-4 font-semibold text-text-primary">Total Debit</th>
                    <th className="text-right py-3 px-4 font-semibold text-text-primary">Total Credit</th>
                    <th className="text-center py-3 px-4 font-semibold text-text-primary">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEntries.map((entry) => (
                    <tr key={entry.voucher_id} className="border-b border-border hover:bg-gray-50">
                      <td className="py-4 px-4">
                        {format(new Date(entry.entry_date), 'dd MMM yyyy')}
                      </td>
                      <td className="py-4 px-4 font-mono text-sm">
                        {entry.voucher_number}
                        {entry.is_reversed && (
                          <span
                            className="ml-2 px-2 py-0.5 rounded-md text-xs font-sans bg-gray-100 text-gray-700"
                            data-testid={`journal-reversed-${entry.voucher_id}`}
                          >
                            {REVERSAL_COPY.journal.reversedBadge}
                          </span>
                        )}
                      </td>
                      <td className="py-4 px-4 text-sm text-text-secondary">
                        {entry.reference_number || '-'}
                      </td>
                      <td className="py-4 px-4">
                        <span className="px-2 py-1 rounded-md text-xs bg-gray-100 text-gray-800">
                          {entry.line_count} lines
                        </span>
                      </td>
                      <td className="py-4 px-4 text-right text-primary-600">
                        ₹{Number(entry.total_debit).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-4 px-4 text-right text-green-600">
                        ₹{Number(entry.total_credit).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-4 px-4">
                        <div className="flex items-center justify-center gap-2">
                          <Link href={`/journal-entries/${entry.voucher_id}`}>
                            <Button size="sm" variant="ghost">
                              <Eye className="w-4 h-4" />
                            </Button>
                          </Link>
                          {!entry.is_reversed && (
                            <Link href={`/journal-entries/${entry.voucher_id}/edit`}>
                              <Button size="sm" variant="ghost">
                                <Edit className="w-4 h-4" />
                              </Button>
                            </Link>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setReversing(entry)}
                            disabled={entry.is_locked || entry.is_reversed}
                            title={
                              entry.is_reversed
                                ? REVERSAL_COPY.journal.alreadyReversed
                                : entry.is_locked
                                  ? JOURNAL_LOCKED_MESSAGE
                                  : REVERSAL_COPY.journal.title
                            }
                            aria-label={REVERSAL_COPY.journal.title}
                            data-testid={`journal-reverse-${entry.voucher_id}`}
                            className="text-red-600 hover:text-red-700 disabled:text-gray-400"
                          >
                            {entry.is_locked ? <Lock className="w-4 h-4" /> : <RotateCcw className="w-4 h-4" />}
                          </Button>
                        </div>
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

        {reversing && (
          <ReasonConfirmModal
            key={reversing.voucher_id}
            title={REVERSAL_COPY.journal.title}
            subject={`Voucher: ${reversing.voucher_number}`}
            description={REVERSAL_COPY.journal.description}
            confirmLabel={REVERSAL_COPY.confirm}
            requireReason
            reasonLabel={REVERSAL_COPY.reasonLabel}
            reasonPlaceholder={REVERSAL_COPY.reasonPlaceholder}
            onConfirm={reverseEntry}
            onClose={() => setReversing(null)}
          />
        )}
      </div>
    
  );
}

