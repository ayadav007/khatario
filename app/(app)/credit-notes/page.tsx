'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Plus, FileText, Search } from 'lucide-react';
import Link from 'next/link';
import { format } from 'date-fns';
import { ListPageHeader } from '@/components/layout/ListPageHeader';

interface CreditNote {
  id: string;
  credit_note_number: string;
  credit_note_date: string;
  customer_name: string;
  invoice_number?: string;
  grand_total: number;
  refund_status: string;
  reason?: string;
}

export default function CreditNotesPage() {
  const router = useRouter();
  const { business, user } = useAuth();
  const [creditNotes, setCreditNotes] = useState<CreditNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, totalPages: 0 });

  useEffect(() => {
    if (business?.id) {
      fetchCreditNotes();
    }
  }, [business?.id, searchQuery, pagination.page]);

  useEffect(() => {
    if (business?.id) {
      // Reset to page 1 when search changes
      setPagination(prev => ({ ...prev, page: 1 }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [business?.id, searchQuery]);

  const fetchCreditNotes = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      params.append('business_id', business!.id);
      params.append('user_id', user?.id || ''); // Required for authorization
      if (searchQuery) params.append('search', searchQuery);
      params.append('page', pagination.page.toString());
      params.append('limit', pagination.limit.toString());

      const response = await fetch(`/api/credit-notes?${params.toString()}`);
      if (response.ok) {
        const data = await response.json();
        setCreditNotes(data.creditNotes || []);
        if (data.pagination) {
          setPagination(data.pagination);
        }
      } else {
        console.error('Failed to fetch credit notes');
      }
    } catch (error) {
      console.error('Error fetching credit notes:', error);
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      pending: 'bg-yellow-100 text-yellow-800',
      refunded: 'bg-green-100 text-green-800',
      adjusted: 'bg-slate-100 text-primary-800',
    };
    return colors[status] || 'bg-gray-100 text-gray-800';
  };

  return (
    
      <div className="space-y-3 md:space-y-6">
        <ListPageHeader
          title="Credit Notes"
          description="Sales returns — goods returned by customers"
          actions={
            <Link href="/credit-notes/new">
              <Button className="h-10">
                <Plus className="w-4 h-4 md:mr-2" />
                <span className="hidden md:inline">New Credit Note</span>
              </Button>
            </Link>
          }
        />

        {/* Search */}
        <Card padding="md">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
            <input
              type="text"
              placeholder="Number, customer, or invoice"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>
        </Card>

        {/* Credit Notes List */}
        <Card padding="none">
          <div className="overflow-x-auto">
            {loading ? (
              <div className="text-center py-12">
                <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
                <p className="mt-2 text-text-secondary">Loading credit notes...</p>
              </div>
            ) : creditNotes.length === 0 ? (
              <div className="text-center py-12">
                <FileText className="mx-auto h-12 w-12 text-gray-400" />
                <h3 className="mt-2 text-sm font-medium text-gray-900">No credit notes</h3>
                <p className="mt-1 text-sm text-gray-500">
                  {searchQuery ? 'No credit notes match your search.' : 'Get started by creating a new credit note.'}
                </p>
                {!searchQuery && (
                  <div className="mt-6">
                    <Link href="/credit-notes/new">
                      <Button>
                        <Plus className="w-4 h-4 mr-2" />
                        New Credit Note
                      </Button>
                    </Link>
                  </div>
                )}
              </div>
            ) : (
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Credit Note #
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Customer
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Invoice #
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Date
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Amount
                    </th>
                    <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Reason
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {creditNotes.map((creditNote) => (
                    <tr key={creditNote.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => router.push(`/credit-notes/${creditNote.id}`)}>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">{creditNote.credit_note_number}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900">{creditNote.customer_name || '-'}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-500">{creditNote.invoice_number || '-'}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-500">
                          {format(new Date(creditNote.credit_note_date), 'dd MMM yyyy')}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right">
                        <div className="text-sm font-medium text-gray-900">
                          ₹{Number(creditNote.grand_total).toLocaleString('en-IN')}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-center">
                        <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusBadge(creditNote.refund_status)}`}>
                          {creditNote.refund_status}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-sm text-gray-500 truncate max-w-xs">
                          {creditNote.reason || '-'}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {/* Pagination Controls */}
            {pagination.totalPages > 1 && (
              <div className="flex justify-between items-center p-4 border-t border-gray-200">
                <p className="text-sm text-gray-600">
                  Page {pagination.page} of {pagination.totalPages} ({pagination.total} credit notes)
                </p>
                <div className="flex space-x-2">
                  <button
                    onClick={() => setPagination(prev => ({ ...prev, page: Math.max(1, prev.page - 1) }))}
                    disabled={pagination.page === 1}
                    className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Previous
                  </button>
                  <button
                    onClick={() => setPagination(prev => ({ ...prev, page: Math.min(prev.totalPages, prev.page + 1) }))}
                    disabled={pagination.page === pagination.totalPages}
                    className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        </Card>

        {/* Summary Cards */}
        {creditNotes.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card padding="md">
              <div className="text-sm text-text-secondary">Total Credit Notes</div>
              <div className="text-2xl font-bold text-text-primary mt-1">
                {creditNotes.length}
              </div>
            </Card>
            <Card padding="md">
              <div className="text-sm text-text-secondary">Total Amount</div>
              <div className="text-2xl font-bold text-text-primary mt-1">
                ₹{creditNotes.reduce((sum, cn) => sum + Number(cn.grand_total), 0).toLocaleString('en-IN')}
              </div>
            </Card>
            <Card padding="md">
              <div className="text-sm text-text-secondary">Pending Refunds</div>
              <div className="text-2xl font-bold text-warning mt-1">
                {creditNotes.filter(cn => cn.refund_status === 'pending').length}
              </div>
            </Card>
          </div>
        )}
      </div>
    
  );
}
