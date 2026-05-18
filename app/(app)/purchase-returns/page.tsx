'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Plus, FileText, Search } from 'lucide-react';
import Link from 'next/link';
import { ListPageHeader } from '@/components/layout/ListPageHeader';
import { format } from 'date-fns';

interface PurchaseReturn {
  id: string;
  return_number: string;
  return_date: string;
  supplier_name: string;
  purchase_bill_number?: string;
  grand_total: number;
  refund_status: string;
  reason?: string;
  itc_reversed: boolean;
}

export default function PurchaseReturnsPage() {
  const router = useRouter();
  const { business } = useAuth();
  const [purchaseReturns, setPurchaseReturns] = useState<PurchaseReturn[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, totalPages: 0 });

  useEffect(() => {
    if (business?.id) {
      fetchPurchaseReturns();
    }
  }, [business?.id, searchQuery, pagination.page]);

  useEffect(() => {
    if (business?.id) {
      // Reset to page 1 when search changes
      setPagination(prev => ({ ...prev, page: 1 }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [business?.id, searchQuery]);

  const fetchPurchaseReturns = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      params.append('business_id', business!.id);
      if (searchQuery) params.append('search', searchQuery);
      params.append('page', pagination.page.toString());
      params.append('limit', pagination.limit.toString());

      const response = await fetch(`/api/purchase-returns?${params.toString()}`);
      if (response.ok) {
        const data = await response.json();
        setPurchaseReturns(data.purchaseReturns || []);
        if (data.pagination) {
          setPagination(data.pagination);
        }
      } else {
        console.error('Failed to fetch purchase returns');
      }
    } catch (error) {
      console.error('Error fetching purchase returns:', error);
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
          title="Purchase Returns"
          description="Goods returned to suppliers"
          actions={
            <Link href="/purchase-returns/new">
              <Button className="h-10">
                <Plus className="w-4 h-4 md:mr-2" />
                <span className="hidden md:inline">New Purchase Return</span>
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
              placeholder="Return, supplier, or purchase"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>
        </Card>

        {/* Summary — above table */}
        {!loading && (pagination.total > 0 || purchaseReturns.length > 0) && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card padding="md">
              <div className="text-sm text-text-secondary">Total Returns</div>
              <div className="text-2xl font-bold text-text-primary mt-1">
                {pagination.total || purchaseReturns.length}
              </div>
            </Card>
            <Card padding="md">
              <div className="text-sm text-text-secondary">Total Amount</div>
              <div className="text-2xl font-bold text-gray-900 mt-1">
                ₹{purchaseReturns.reduce((sum, pr) => sum + Number(pr.grand_total), 0).toLocaleString('en-IN')}
              </div>
            </Card>
            <Card padding="md">
              <div className="text-sm text-text-secondary">Pending Refunds</div>
              <div className="text-2xl font-bold text-amber-600 mt-1">
                {purchaseReturns.filter((pr) => pr.refund_status === 'pending').length}
              </div>
            </Card>
          </div>
        )}

        {/* Purchase Returns List */}
        <Card padding="none">
          <div className="overflow-x-auto">
            {loading ? (
              <div className="text-center py-12">
                <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
                <p className="mt-2 text-text-secondary">Loading purchase returns...</p>
              </div>
            ) : purchaseReturns.length === 0 ? (
              <div className="text-center py-12">
                <FileText className="mx-auto h-12 w-12 text-gray-400" />
                <h3 className="mt-2 text-sm font-medium text-gray-900">No purchase returns</h3>
                <p className="mt-1 text-sm text-gray-500">
                  {searchQuery ? 'No purchase returns match your search.' : 'Get started by creating a new purchase return.'}
                </p>
                {!searchQuery && (
                  <div className="mt-6">
                    <Link href="/purchase-returns/new">
                      <Button>
                        <Plus className="w-4 h-4 mr-2" />
                        New Purchase Return
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
                      Return #
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Supplier
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Purchase #
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
                    <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                      ITC Reversed
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Reason
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {purchaseReturns.map((purchaseReturn) => (
                    <tr key={purchaseReturn.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => router.push(`/purchase-returns/${purchaseReturn.id}`)}>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">{purchaseReturn.return_number}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900">{purchaseReturn.supplier_name || '-'}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-500">{purchaseReturn.purchase_bill_number || '-'}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-500">
                          {format(new Date(purchaseReturn.return_date), 'dd MMM yyyy')}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right">
                        <div className="text-sm font-medium text-gray-900">
                          ₹{Number(purchaseReturn.grand_total).toLocaleString('en-IN')}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-center">
                        <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusBadge(purchaseReturn.refund_status)}`}>
                          {purchaseReturn.refund_status}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-center">
                        {purchaseReturn.itc_reversed ? (
                          <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 text-green-800">
                            Yes
                          </span>
                        ) : (
                          <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-red-100 text-red-800">
                            No
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-sm text-gray-500 truncate max-w-xs">
                          {purchaseReturn.reason || '-'}
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
                  Page {pagination.page} of {pagination.totalPages} ({pagination.total} purchase returns)
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

      </div>
    
  );
}
