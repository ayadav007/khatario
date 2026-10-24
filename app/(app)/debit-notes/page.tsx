'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { Plus, FileText, Calendar, User, CheckCircle, Clock, Eye } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { ListPageHeader } from '@/components/layout/ListPageHeader';
import { Button } from '@/components/ui/Button';
import { useToastContext } from '@/contexts/ToastContext';

interface DebitNote {
  id: string;
  customer_id: string;
  customer_name: string;
  invoice_id: string | null;
  invoice_number: string | null;
  debit_note_number: string;
  debit_note_date: string;
  reason: string;
  grand_total: number;
  adjustment_status: string;
  status?: 'active' | 'cancelled';
  cancellation_reason?: string | null;
}

export default function DebitNotesPage() {
  const router = useRouter();
  const { business, user } = useAuth();
  const toast = useToastContext();
  const [debitNotes, setDebitNotes] = useState<DebitNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  useEffect(() => {
    async function fetchDebitNotes() {
      if (!business?.id) return;
      try {
        const response = await fetch(`/api/debit-notes?business_id=${business.id}&user_id=${user?.id}`);
        const data = await response.json();
        setDebitNotes(data.debitNotes || data.debit_notes || []);
      } catch (error) {
        console.error('Error fetching debit notes:', error);
      } finally {
        setLoading(false);
      }
    }
    fetchDebitNotes();
  }, [business, user]);

  const cancelDebitNote = async (debitNote: DebitNote) => {
    const reason = prompt(
      `Cancel debit note ${debitNote.debit_note_number}? The books and the amount the customer owes will be reversed. Stock is put back only if this note took it out.\n\nReason for cancellation:`
    );
    if (!reason?.trim()) return;
    setCancellingId(debitNote.id);
    try {
      const res = await fetch(`/api/debit-notes/${debitNote.id}/cancel`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || 'Could not cancel the debit note');
        return;
      }
      toast.success(`Debit note ${debitNote.debit_note_number} cancelled`);
      setDebitNotes((current) =>
        current.map((row) =>
          row.id === debitNote.id
            ? { ...row, status: 'cancelled', cancellation_reason: reason.trim() }
            : row
        )
      );
    } finally {
      setCancellingId(null);
    }
  };

  const getStatusBadge = (status: string) => {
    const badges: Record<string, { color: string; icon: any; label: string }> = {
      pending: { color: 'bg-yellow-100 text-yellow-800', icon: Clock, label: 'Pending' },
      adjusted: { color: 'bg-slate-100 text-primary-800', icon: CheckCircle, label: 'Adjusted' },
      refunded: { color: 'bg-green-100 text-green-800', icon: CheckCircle, label: 'Refunded' },
      cancelled: { color: 'bg-red-100 text-red-800', icon: Clock, label: 'Cancelled' },
    };
    const badge = badges[status] || badges.pending;
    const Icon = badge.icon;
    return (
      <div className={`flex items-center space-x-2 px-3 py-1 rounded-full text-xs font-medium ${badge.color}`}>
        <Icon className="w-4 h-4" />
        <span>{badge.label}</span>
      </div>
    );
  };

  return (
    
      <div className="space-y-3 md:space-y-6">
        <ListPageHeader
          title="Debit Notes"
          description="Record additional charges or upward adjustments"
          actions={
            <button
              type="button"
              onClick={() => router.push('/debit-notes/new')}
              className="flex items-center space-x-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition h-10"
            >
              <Plus className="w-5 h-5" />
              <span className="hidden md:inline">New Debit Note</span>
            </button>
          }
        />

        {/* Info Banner */}
        <div className="bg-slate-50 border border-primary-200 rounded-lg p-4">
          <div className="flex items-start space-x-3">
            <FileText className="w-5 h-5 text-primary-600 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-primary-900">About Debit Notes</p>
              <p className="text-sm text-primary-700 mt-1">
                Issue debit notes to increase the invoice value (e.g., underbilling corrections). Customer receivable will increase.
              </p>
            </div>
          </div>
        </div>

        {/* Debit Notes List */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200">
          {loading ? (
            <div className="p-12 text-center">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
            </div>
          ) : debitNotes.length === 0 ? (
            <div className="p-12 text-center">
              <FileText className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-600">No debit notes found</p>
              <button
                onClick={() => router.push('/debit-notes/new')}
                className="mt-4 px-6 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition"
              >
                Create Your First Debit Note
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Debit Note #</th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Invoice #</th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Customer</th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Date</th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Amount</th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Reason</th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Status</th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {debitNotes.map((debitNote) => (
                    <tr key={debitNote.id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="py-4 px-4">
                        <div className="flex items-center space-x-2">
                          <FileText className="w-4 h-4 text-gray-400" />
                          <span className="text-sm font-medium text-gray-900">
                            {debitNote.debit_note_number}
                          </span>
                        </div>
                      </td>
                      <td className="py-4 px-4">
                        {debitNote.invoice_number ? (
                          <span className="text-sm text-primary-600 hover:underline cursor-pointer">
                            {debitNote.invoice_number}
                          </span>
                        ) : (
                          <span className="text-sm text-gray-400">-</span>
                        )}
                      </td>
                      <td className="py-4 px-4">
                        <div className="flex items-center space-x-2">
                          <User className="w-4 h-4 text-gray-400" />
                          <span className="text-sm text-gray-700">{debitNote.customer_name || 'Cash Sale'}</span>
                        </div>
                      </td>
                      <td className="py-4 px-4">
                        <div className="flex items-center space-x-2 text-sm text-gray-600">
                          <Calendar className="w-4 h-4" />
                          <span>{new Date(debitNote.debit_note_date).toLocaleDateString()}</span>
                        </div>
                      </td>
                      <td className="py-4 px-4">
                        <span className="text-sm font-semibold text-green-600">
                          +₹{Number(debitNote.grand_total || 0).toFixed(2)}
                        </span>
                      </td>
                      <td className="py-4 px-4">
                        <span className="text-sm text-gray-600">{debitNote.reason || '-'}</span>
                      </td>
                      <td className="py-4 px-4">
                        {debitNote.status === 'cancelled'
                          ? getStatusBadge('cancelled')
                          : getStatusBadge(debitNote.adjustment_status)}
                      </td>
                      <td className="py-4 px-4">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => router.push(`/debit-notes/${debitNote.id}`)}
                            className="text-primary-600 hover:text-primary-700"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          {debitNote.status !== 'cancelled' && (
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={cancellingId === debitNote.id}
                              onClick={() => cancelDebitNote(debitNote)}
                            >
                              {cancellingId === debitNote.id ? 'Cancelling…' : 'Cancel'}
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    
  );
}
