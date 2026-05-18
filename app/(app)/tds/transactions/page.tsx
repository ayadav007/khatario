'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { Receipt, Loader2, ArrowLeft, Search, Filter } from 'lucide-react';
import { format } from 'date-fns';
import { useToastContext } from '@/contexts/ToastContext';

interface TDSTransaction {
  id: string;
  supplier_id: string;
  supplier_name?: string;
  tds_category_id: string;
  section_name?: string;
  transaction_date: string;
  amount: number;
  tds_amount: number;
  financial_year: string;
  quarter: string;
  is_deposited: boolean;
  deposited_date?: string;
  challan_number?: string;
  created_at: string;
}

export default function TDSTransactionsPage() {
  const router = useRouter();
  const { business } = useAuth();
  const toast = useToastContext();
  const [transactions, setTransactions] = useState<TDSTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    financial_year: '',
    quarter: '',
    supplier_id: '',
    is_deposited: ''
  });

  useEffect(() => {
    if (business?.id) {
      fetchTransactions();
    }
  }, [business?.id, filters]);

  const fetchTransactions = async () => {
    if (!business?.id) return;
    
    setLoading(true);
    try {
      const params = new URLSearchParams({ business_id: business.id });
      if (filters.financial_year) params.append('financial_year', filters.financial_year);
      if (filters.quarter) params.append('quarter', filters.quarter);
      if (filters.supplier_id) params.append('supplier_id', filters.supplier_id);
      if (filters.is_deposited) params.append('is_deposited', filters.is_deposited);

      const response = await fetch(`/api/tds/transactions?${params.toString()}`);
      if (response.ok) {
        const data = await response.json();
        setTransactions(data.transactions || []);
      } else {
        toast.error('Failed to load TDS transactions');
      }
    } catch (error) {
      console.error('Error fetching TDS transactions:', error);
      toast.error('Failed to load TDS transactions');
    } finally {
      setLoading(false);
    }
  };

  const currentYear = new Date().getFullYear();
  const financialYears = Array.from({ length: 5 }, (_, i) => currentYear - i);
  const quarters = ['Q1', 'Q2', 'Q3', 'Q4'];

  return (
    
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push('/tds')}
            className="p-2 rounded-lg hover:bg-gray-100 transition"
            title="Back to TDS"
          >
            <ArrowLeft className="w-5 h-5 text-gray-600" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">TDS Transactions</h1>
            <p className="text-gray-600 text-sm mt-1">View all TDS deductions</p>
          </div>
        </div>

        {/* Filters */}
        <Card padding="md">
          <div className="flex items-center gap-2 mb-4">
            <Filter className="w-5 h-5 text-gray-600" />
            <h3 className="font-semibold text-gray-900">Filters</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Financial Year</label>
              <select
                value={filters.financial_year}
                onChange={(e) => setFilters({ ...filters, financial_year: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              >
                <option value="">All Years</option>
                {financialYears.map(year => (
                  <option key={year} value={year}>{year}-{year + 1}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Quarter</label>
              <select
                value={filters.quarter}
                onChange={(e) => setFilters({ ...filters, quarter: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              >
                <option value="">All Quarters</option>
                {quarters.map(q => (
                  <option key={q} value={q}>{q}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Deposit Status</label>
              <select
                value={filters.is_deposited}
                onChange={(e) => setFilters({ ...filters, is_deposited: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              >
                <option value="">All</option>
                <option value="true">Deposited</option>
                <option value="false">Pending</option>
              </select>
            </div>
            <div className="flex items-end">
              <Button
                variant="secondary"
                onClick={() => setFilters({ financial_year: '', quarter: '', supplier_id: '', is_deposited: '' })}
              >
                Clear Filters
              </Button>
            </div>
          </div>
        </Card>

        {/* Transactions List */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
          </div>
        ) : transactions.length === 0 ? (
          <Card padding="lg">
            <div className="text-center text-gray-500">
              <Receipt className="w-12 h-12 mx-auto mb-2 opacity-30" />
              <p>No TDS transactions found</p>
              <p className="text-sm mt-1">TDS transactions will appear here when recorded</p>
            </div>
          </Card>
        ) : (
          <Card padding="none">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Supplier</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Section</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Amount</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">TDS Amount</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">FY/Quarter</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {transactions.map((transaction) => (
                    <tr key={transaction.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {format(new Date(transaction.transaction_date), 'dd MMM yyyy')}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {transaction.supplier_name || 'N/A'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                        {transaction.section_name || 'N/A'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">
                        ₹{Number(transaction.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-semibold text-gray-900">
                        ₹{Number(transaction.tds_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                        {transaction.financial_year} {transaction.quarter}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {transaction.is_deposited ? (
                          <span className="px-2 py-1 text-xs font-medium bg-green-100 text-green-800 rounded-full">
                            Deposited
                          </span>
                        ) : (
                          <span className="px-2 py-1 text-xs font-medium bg-yellow-100 text-yellow-800 rounded-full">
                            Pending
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-6 py-4 bg-gray-50 border-t border-gray-200">
              <div className="flex justify-between items-center">
                <p className="text-sm text-gray-600">
                  Total: {transactions.length} transaction{transactions.length !== 1 ? 's' : ''}
                </p>
                <p className="text-sm font-semibold text-gray-900">
                  Total TDS: ₹{transactions.reduce((sum, t) => sum + Number(t.tds_amount), 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </p>
              </div>
            </div>
          </Card>
        )}
      </div>
    
  );
}

