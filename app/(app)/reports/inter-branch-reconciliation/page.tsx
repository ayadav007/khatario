'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { RefreshCw, AlertCircle, CheckCircle, Loader2, TrendingUp, TrendingDown } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { format } from 'date-fns';
import { useToastContext } from '@/contexts/ToastContext';

interface ReconciliationData {
  as_on_date: string;
  receivables_account: {
    id: string;
    code: string;
    name: string;
  };
  payables_account: {
    id: string;
    code: string;
    name: string;
  };
  totals: {
    receivables: number;
    payables: number;
    difference: number;
    is_reconciled: boolean;
  };
  branch_wise: {
    receivables: Array<{
      branch_id: string;
      branch_name: string;
      receivables_balance: number;
    }>;
    payables: Array<{
      branch_id: string;
      branch_name: string;
      payables_balance: number;
    }>;
  };
  unmatched_transactions: Array<{
    voucher_id: string;
    voucher_type: string;
    entry_date: string;
    narration: string;
    branch_name: string;
    transaction_type: string;
    amount: number;
  }>;
  reconciliation_status: string;
  message: string;
}

export default function InterBranchReconciliationPage() {
  const { business, user } = useAuth();
  const toast = useToastContext();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<ReconciliationData | null>(null);
  const [asOnDate, setAsOnDate] = useState(format(new Date(), 'yyyy-MM-dd'));

  useEffect(() => {
    if (business?.id) {
      fetchReconciliation();
    }
  }, [business, asOnDate]);

  async function fetchReconciliation() {
    if (!business?.id) return;
    
    setLoading(true);
    try {
      const response = await fetch(
        `/api/reports/inter-branch-reconciliation?business_id=${business.id}&as_on_date=${asOnDate}&user_id=${user?.id}`
      );
      const data = await response.json();
      
      if (response.ok) {
        setData(data);
      } else {
        console.error('Error:', data.error);
        toast.error(data.error || 'Failed to fetch reconciliation data');
      }
    } catch (error) {
      console.error('Error fetching reconciliation:', error);
      toast.error('Failed to fetch reconciliation data');
    } finally {
      setLoading(false);
    }
  }

  if (loading && !data) {
    return (
      
        <div className="flex items-center justify-center h-[calc(100vh-100px)]">
          <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
        </div>
      
    );
  }

  if (!data) {
    return (
      
        <div className="max-w-2xl mx-auto py-8">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center">
            <AlertCircle className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-gray-900 mb-2">
              Inter-Branch Accounts Not Found
            </h2>
            <p className="text-gray-600">
              Please ensure accounts 1109 (Inter-Branch Receivables) and 2111 (Inter-Branch Payables) exist in your chart of accounts.
            </p>
          </div>
        </div>
      
    );
  }

  return (
    
      <div className="space-y-6">
        {/* Header */}
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Inter-Branch Reconciliation</h1>
            <p className="text-gray-600 text-sm mt-1">Validate inter-branch receivables and payables</p>
          </div>
          <div className="flex items-center space-x-3">
            <input
              type="date"
              value={asOnDate}
              onChange={(e) => setAsOnDate(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            />
            <button
              onClick={fetchReconciliation}
              className="flex items-center space-x-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition"
            >
              <RefreshCw className="w-4 h-4" />
              <span>Refresh</span>
            </button>
          </div>
        </div>

        {/* Status Banner */}
        <div className={`rounded-lg p-4 ${
          data.totals.is_reconciled
            ? 'bg-green-50 border border-green-200'
            : 'bg-red-50 border border-red-200'
        }`}>
          <div className="flex items-start space-x-3">
            {data.totals.is_reconciled ? (
              <CheckCircle className="w-5 h-5 text-green-600 mt-0.5" />
            ) : (
              <AlertCircle className="w-5 h-5 text-red-600 mt-0.5" />
            )}
            <div>
              <p className={`text-sm font-medium ${
                data.totals.is_reconciled ? 'text-green-900' : 'text-red-900'
              }`}>
                {data.reconciliation_status === 'reconciled' ? 'Reconciled' : 'Not Reconciled'}
              </p>
              <p className={`text-sm mt-1 ${
                data.totals.is_reconciled ? 'text-green-700' : 'text-red-700'
              }`}>
                {data.message}
              </p>
            </div>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-gray-600">Inter-Branch Receivables</p>
              <TrendingUp className="w-5 h-5 text-primary-600" />
            </div>
            <p className="text-2xl font-bold text-gray-900">
              ₹{data.totals.receivables.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
            <p className="text-xs text-gray-500 mt-1">Account: {data.receivables_account.code} - {data.receivables_account.name}</p>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-gray-600">Inter-Branch Payables</p>
              <TrendingDown className="w-5 h-5 text-red-600" />
            </div>
            <p className="text-2xl font-bold text-gray-900">
              ₹{data.totals.payables.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
            <p className="text-xs text-gray-500 mt-1">Account: {data.payables_account.code} - {data.payables_account.name}</p>
          </div>

          <div className={`rounded-xl shadow-sm border p-6 ${
            data.totals.is_reconciled
              ? 'bg-green-50 border-green-200'
              : 'bg-red-50 border-red-200'
          }`}>
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-gray-600">Difference</p>
              {data.totals.is_reconciled ? (
                <CheckCircle className="w-5 h-5 text-green-600" />
              ) : (
                <AlertCircle className="w-5 h-5 text-red-600" />
              )}
            </div>
            <p className={`text-2xl font-bold ${
              data.totals.is_reconciled ? 'text-green-900' : 'text-red-900'
            }`}>
              ₹{data.totals.difference.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
            <p className="text-xs text-gray-500 mt-1">As on: {format(new Date(data.as_on_date), 'dd MMM yyyy')}</p>
          </div>
        </div>

        {/* Branch-Wise Breakdown */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Receivables by Branch */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Receivables by Branch</h3>
            {data.branch_wise.receivables.length === 0 ? (
              <p className="text-sm text-gray-500">No receivables found</p>
            ) : (
              <div className="space-y-3">
                {data.branch_wise.receivables.map((item) => (
                  <div key={item.branch_id} className="flex justify-between items-center p-3 bg-gray-50 rounded">
                    <span className="text-sm font-medium text-gray-900">{item.branch_name}</span>
                    <span className="text-sm font-semibold text-primary-600">
                      ₹{item.receivables_balance.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Payables by Branch */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Payables by Branch</h3>
            {data.branch_wise.payables.length === 0 ? (
              <p className="text-sm text-gray-500">No payables found</p>
            ) : (
              <div className="space-y-3">
                {data.branch_wise.payables.map((item) => (
                  <div key={item.branch_id} className="flex justify-between items-center p-3 bg-gray-50 rounded">
                    <span className="text-sm font-medium text-gray-900">{item.branch_name}</span>
                    <span className="text-sm font-semibold text-red-600">
                      ₹{item.payables_balance.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Unmatched Transactions */}
        {data.unmatched_transactions.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Unmatched Transactions</h3>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Date</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Branch</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Type</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Narration</th>
                    <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {data.unmatched_transactions.map((txn, idx) => (
                    <tr key={idx} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm text-gray-900">
                        {format(new Date(txn.entry_date), 'dd MMM yyyy')}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900">{txn.branch_name}</td>
                      <td className="px-4 py-3 text-sm text-gray-900">{txn.transaction_type}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{txn.narration || '-'}</td>
                      <td className="px-4 py-3 text-sm font-medium text-right text-gray-900">
                        ₹{txn.amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    
  );
}
