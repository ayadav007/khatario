'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Plus, Search, Filter, ArrowUp, ArrowDown, Eye } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { format } from 'date-fns';
import Link from 'next/link';

interface Adjustment {
  id: string;
  adjustment_number: string;
  adjustment_date: string;
  adjustment_type: 'QUANTITY' | 'VALUE';
  direction?: 'INCREASE' | 'DECREASE';
  item_name: string;
  item_code?: string;
  variant_name?: string;
  location_name?: string;
  quantity_before: number;
  quantity_after: number;
  unit_cost_before: number;
  unit_cost_after: number;
  total_value_before: number;
  total_value_after: number;
  reason_code: string;
  reason_notes?: string;
  notes?: string;
  created_by_name?: string;
  created_at: string;
}

export default function InventoryAdjustmentsPage() {
  const router = useRouter();
  const { business, user } = useAuth();
  const [adjustments, setAdjustments] = useState<Adjustment[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    adjustment_type: '',
    reason_code: '',
    start_date: '',
    end_date: '',
    search: ''
  });
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 50,
    total: 0,
    totalPages: 0
  });

  useEffect(() => {
    if (business?.id) {
      fetchAdjustments();
    }
  }, [business?.id, filters, pagination.page]);

  const fetchAdjustments = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        business_id: business!.id,
        page: pagination.page.toString(),
        limit: pagination.limit.toString()
      });

      if (filters.adjustment_type) {
        params.append('adjustment_type', filters.adjustment_type);
      }
      if (filters.reason_code) {
        params.append('reason_code', filters.reason_code);
      }
      if (filters.start_date) {
        params.append('start_date', filters.start_date);
      }
      if (filters.end_date) {
        params.append('end_date', filters.end_date);
      }
      params.append('user_id', user?.id || ''); // Required for authorization

      const res = await fetch(`/api/inventory-adjustments?${params}`);
      if (res.ok) {
        const data = await res.json();
        // Convert string numbers to actual numbers
        const adjustments = (data.adjustments || []).map((adj: any) => ({
          ...adj,
          quantity_before: Number(adj.quantity_before) || 0,
          quantity_after: Number(adj.quantity_after) || 0,
          unit_cost_before: Number(adj.unit_cost_before) || 0,
          unit_cost_after: Number(adj.unit_cost_after) || 0,
          total_value_before: Number(adj.total_value_before) || 0,
          total_value_after: Number(adj.total_value_after) || 0,
        }));
        setAdjustments(adjustments);
        setPagination(prev => ({
          ...prev,
          total: data.pagination?.total || 0,
          totalPages: data.pagination?.totalPages || 0
        }));
      }
    } catch (error) {
      console.error('Error fetching adjustments:', error);
    } finally {
      setLoading(false);
    }
  };

  const reasonCodeLabels: Record<string, string> = {
    STOCK_TAKE: 'Stock Take',
    DAMAGE: 'Damage',
    THEFT: 'Theft',
    EXPIRED: 'Expired',
    FREE_SAMPLE: 'Free Sample',
    COST_CORRECTION: 'Cost Correction',
    LANDED_COST: 'Landed Cost',
    REVALUATION: 'Revaluation',
    WRITE_DOWN: 'Write Down'
  };

  const getReasonLabel = (code: string) => {
    return reasonCodeLabels[code] || code;
  };

  const filteredAdjustments = adjustments.filter(adj => {
    if (filters.search) {
      const searchLower = filters.search.toLowerCase();
      return (
        adj.adjustment_number.toLowerCase().includes(searchLower) ||
        adj.item_name.toLowerCase().includes(searchLower) ||
        adj.item_code?.toLowerCase().includes(searchLower) ||
        adj.variant_name?.toLowerCase().includes(searchLower)
      );
    }
    return true;
  });

  return (
    
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Inventory Adjustments</h1>
            <p className="text-sm text-gray-600 mt-1">Manage quantity and value adjustments</p>
          </div>
          <Link href="/inventory-adjustments/new">
            <Button>
              <Plus className="w-4 h-4 mr-2" />
              New Adjustment
            </Button>
          </Link>
        </div>

        {/* Filters */}
        <Card>
          <div className="p-4">
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Type</label>
                <select
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                  value={filters.adjustment_type}
                  onChange={(e) => {
                    setFilters(prev => ({ ...prev, adjustment_type: e.target.value }));
                    setPagination(prev => ({ ...prev, page: 1 }));
                  }}
                >
                  <option value="">All Types</option>
                  <option value="QUANTITY">Quantity</option>
                  <option value="VALUE">Value</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Reason</label>
                <select
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                  value={filters.reason_code}
                  onChange={(e) => {
                    setFilters(prev => ({ ...prev, reason_code: e.target.value }));
                    setPagination(prev => ({ ...prev, page: 1 }));
                  }}
                >
                  <option value="">All Reasons</option>
                  {Object.entries(reasonCodeLabels).map(([code, label]) => (
                    <option key={code} value={code}>{label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Start Date</label>
                <Input
                  type="date"
                  value={filters.start_date}
                  onChange={(e) => {
                    setFilters(prev => ({ ...prev, start_date: e.target.value }));
                    setPagination(prev => ({ ...prev, page: 1 }));
                  }}
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">End Date</label>
                <Input
                  type="date"
                  value={filters.end_date}
                  onChange={(e) => {
                    setFilters(prev => ({ ...prev, end_date: e.target.value }));
                    setPagination(prev => ({ ...prev, page: 1 }));
                  }}
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Search</label>
                <div className="relative">
                  <Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
                  <Input
                    type="text"
                    placeholder="Search..."
                    value={filters.search}
                    onChange={(e) => setFilters(prev => ({ ...prev, search: e.target.value }))}
                    className="pl-9"
                  />
                </div>
              </div>
            </div>
          </div>
        </Card>

        {/* Adjustments Table */}
        <Card>
          <div className="overflow-x-auto">
            {loading ? (
              <div className="p-8 text-center text-gray-500">Loading...</div>
            ) : filteredAdjustments.length === 0 ? (
              <div className="p-8 text-center text-gray-500">
                <p>No adjustments found</p>
                <Link href="/inventory-adjustments/new">
                  <Button variant="secondary" className="mt-4">
                    <Plus className="w-4 h-4 mr-2" />
                    Create First Adjustment
                  </Button>
                </Link>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-700">Adjustment #</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-700">Date</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-700">Type</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-700">Item</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-700">Reason</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-700">Quantity</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-700">Unit Cost</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-700">Total Value</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-700">Created By</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-700">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {filteredAdjustments.map((adj) => {
                    const quantityChange = adj.quantity_after - adj.quantity_before;
                    const valueChange = adj.total_value_after - adj.total_value_before;
                    const unitCostChange = adj.unit_cost_after - adj.unit_cost_before;

                    return (
                      <tr key={adj.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <span className="font-medium text-gray-900">{adj.adjustment_number}</span>
                        </td>
                        <td className="px-4 py-3 text-gray-600">
                          {format(new Date(adj.adjustment_date), 'dd MMM yyyy')}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-1 text-xs rounded-full ${
                            adj.adjustment_type === 'QUANTITY'
                              ? 'bg-slate-100 text-primary-800'
                              : 'bg-purple-100 text-purple-800'
                          }`}>
                            {adj.adjustment_type}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div>
                            <div className="font-medium text-gray-900">{adj.item_name}</div>
                            {adj.variant_name && (
                              <div className="text-xs text-gray-500">Variant: {adj.variant_name}</div>
                            )}
                            {adj.location_name && (
                              <div className="text-xs text-gray-500">Location: {adj.location_name}</div>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-gray-600">{getReasonLabel(adj.reason_code)}</span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            {quantityChange !== 0 && (
                              quantityChange > 0 ? (
                                <ArrowUp className="w-3 h-3 text-green-600" />
                              ) : (
                                <ArrowDown className="w-3 h-3 text-red-600" />
                              )
                            )}
                            <span className={quantityChange > 0 ? 'text-green-600' : quantityChange < 0 ? 'text-red-600' : 'text-gray-900'}>
                              {adj.quantity_after.toFixed(2)}
                            </span>
                          </div>
                          {quantityChange !== 0 && (
                            <div className="text-xs text-gray-500">
                              ({quantityChange > 0 ? '+' : ''}{quantityChange.toFixed(2)})
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div>
                            <span className="text-gray-900">₹{adj.unit_cost_after.toFixed(2)}</span>
                            {unitCostChange !== 0 && (
                              <div className={`text-xs ${unitCostChange > 0 ? 'text-green-600' : 'text-red-600'}`}>
                                ({unitCostChange > 0 ? '+' : ''}₹{unitCostChange.toFixed(2)})
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div>
                            <span className="font-medium text-gray-900">₹{adj.total_value_after.toFixed(2)}</span>
                            {valueChange !== 0 && (
                              <div className={`text-xs ${valueChange > 0 ? 'text-green-600' : 'text-red-600'}`}>
                                ({valueChange > 0 ? '+' : ''}₹{valueChange.toFixed(2)})
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-gray-600 text-sm">
                          {adj.created_by_name || 'System'}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => router.push(`/inventory-adjustments/${adj.id}`)}
                          >
                            <Eye className="w-4 h-4" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Pagination */}
          {pagination.totalPages > 1 && (
            <div className="px-4 py-3 border-t flex items-center justify-between">
              <div className="text-sm text-gray-600">
                Showing {((pagination.page - 1) * pagination.limit) + 1} to{' '}
                {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total} adjustments
              </div>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setPagination(prev => ({ ...prev, page: prev.page - 1 }))}
                  disabled={pagination.page === 1}
                >
                  Previous
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setPagination(prev => ({ ...prev, page: prev.page + 1 }))}
                  disabled={pagination.page >= pagination.totalPages}
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
