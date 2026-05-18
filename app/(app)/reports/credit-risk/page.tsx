'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { Loader2, TrendingUp, TrendingDown, AlertTriangle, CheckCircle } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { Breadcrumbs } from '@/components/navigation/Breadcrumbs';
import { CreditStatus } from '@/lib/credit-utils';

interface CreditRiskData {
  total_receivables: number;
  total_payables: number;
  over_limit_count: number;
  customers_by_risk: Array<{
    id: string;
    name: string;
    credit_limit: number;
    current_balance: number;
    credit_used: number;
    available_credit: number | null;
    credit_utilization_percent: number | null;
    credit_status: CreditStatus;
  }>;
  suppliers_by_risk: Array<{
    id: string;
    name: string;
    credit_limit: number;
    current_balance: number;
    credit_used: number;
    available_credit: number | null;
    credit_utilization_percent: number | null;
    credit_status: CreditStatus;
  }>;
}

export default function CreditRiskDashboardPage() {
  const router = useRouter();
  const { business, user } = useAuth();
  const [data, setData] = useState<CreditRiskData | null>(null);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<'utilization' | 'balance' | 'name'>('utilization');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [activeTab, setActiveTab] = useState<'customers' | 'suppliers'>('customers');

  useEffect(() => {
    if (business?.id && user?.id) {
      fetchData();
    }
  }, [business?.id, user?.id]);

  async function fetchData() {
    if (!business?.id || !user?.id) return;
    
    setLoading(true);
    try {
      const res = await fetch(`/api/reports/credit-risk?business_id=${business.id}&user_id=${user.id}`);
      if (res.ok) {
        const result = await res.json();
        setData(result);
      } else {
        console.error('Error fetching credit risk data');
      }
    } catch (error) {
      console.error('Error fetching credit risk data:', error);
    } finally {
      setLoading(false);
    }
  }

  const getStatusBadge = (status: CreditStatus) => {
    switch (status) {
      case 'HEALTHY':
        return 'bg-green-100 text-green-700 border-green-200';
      case 'WARNING':
        return 'bg-yellow-100 text-yellow-700 border-yellow-200';
      case 'CRITICAL':
        return 'bg-orange-100 text-orange-700 border-orange-200';
      case 'OVER_LIMIT':
        return 'bg-red-100 text-red-700 border-red-200';
      default:
        return 'bg-gray-100 text-gray-700 border-gray-200';
    }
  };

  const getStatusIcon = (status: CreditStatus) => {
    switch (status) {
      case 'HEALTHY':
        return <CheckCircle className="w-4 h-4" />;
      case 'WARNING':
      case 'CRITICAL':
      case 'OVER_LIMIT':
        return <AlertTriangle className="w-4 h-4" />;
      default:
        return null;
    }
  };

  const sortedParties = () => {
    if (!data) return [];
    
    const parties = activeTab === 'customers' ? data.customers_by_risk : data.suppliers_by_risk;
    
    return [...parties].sort((a, b) => {
      let comparison = 0;
      
      switch (sortBy) {
        case 'utilization':
          const utilA = a.credit_utilization_percent ?? -1;
          const utilB = b.credit_utilization_percent ?? -1;
          comparison = utilA - utilB;
          break;
        case 'balance':
          comparison = a.current_balance - b.current_balance;
          break;
        case 'name':
          comparison = a.name.localeCompare(b.name);
          break;
      }
      
      return sortOrder === 'asc' ? comparison : -comparison;
    });
  };

  const handlePartyClick = (partyId: string, partyType: 'customer' | 'supplier') => {
    router.push(`/reports/party/ledger?party_id=${partyId}&party_type=${partyType}&business_id=${business?.id}&user_id=${user?.id}`);
  };

  return (
    
      <div className="max-w-7xl mx-auto space-y-6">
        <Breadcrumbs />
        
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Credit Risk Dashboard</h1>
            <p className="text-sm text-gray-600 mt-1">Monitor credit utilization and risk across customers and suppliers</p>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
          </div>
        ) : !data ? (
          <Card padding="md">
            <div className="text-center py-12">
              <AlertTriangle className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-600">No credit risk data available</p>
            </div>
          </Card>
        ) : (
          <>
            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <Card padding="md" className="bg-gradient-to-br from-slate-50 to-slate-100 border-primary-200">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-primary-600 mb-1">Total Receivables</p>
                    <p className="text-2xl font-bold text-gray-900">
                      ₹{data.total_receivables.toLocaleString('en-IN')}
                    </p>
                  </div>
                  <TrendingUp className="w-8 h-8 text-primary-500" />
                </div>
              </Card>

              <Card padding="md" className="bg-gradient-to-br from-purple-50 to-purple-100 border-purple-200">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-purple-600 mb-1">Total Payables</p>
                    <p className="text-2xl font-bold text-gray-900">
                      ₹{data.total_payables.toLocaleString('en-IN')}
                    </p>
                  </div>
                  <TrendingDown className="w-8 h-8 text-purple-500" />
                </div>
              </Card>

              <Card padding="md" className="bg-gradient-to-br from-red-50 to-red-100 border-red-200">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-red-600 mb-1">Over Limit</p>
                    <p className="text-2xl font-bold text-gray-900">
                      {data.over_limit_count}
                    </p>
                    <p className="text-xs text-gray-600 mt-1">parties</p>
                  </div>
                  <AlertTriangle className="w-8 h-8 text-red-500" />
                </div>
              </Card>

              <Card padding="md" className="bg-gradient-to-br from-green-50 to-green-100 border-green-200">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-green-600 mb-1">Total Parties</p>
                    <p className="text-2xl font-bold text-gray-900">
                      {data.customers_by_risk.length + data.suppliers_by_risk.length}
                    </p>
                    <p className="text-xs text-gray-600 mt-1">
                      {data.customers_by_risk.length} customers, {data.suppliers_by_risk.length} suppliers
                    </p>
                  </div>
                  <CheckCircle className="w-8 h-8 text-green-500" />
                </div>
              </Card>
            </div>

            {/* Tabs */}
            <div className="border-b border-gray-200">
              <nav className="-mb-px flex space-x-8">
                <button
                  onClick={() => setActiveTab('customers')}
                  className={`py-4 px-1 border-b-2 font-medium text-sm ${
                    activeTab === 'customers'
                      ? 'border-primary-500 text-primary-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  Customers ({data.customers_by_risk.length})
                </button>
                <button
                  onClick={() => setActiveTab('suppliers')}
                  className={`py-4 px-1 border-b-2 font-medium text-sm ${
                    activeTab === 'suppliers'
                      ? 'border-primary-500 text-primary-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  Suppliers ({data.suppliers_by_risk.length})
                </button>
              </nav>
            </div>

            {/* Risk Table */}
            <Card padding="none">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                          onClick={() => {
                            if (sortBy === 'name') {
                              setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
                            } else {
                              setSortBy('name');
                              setSortOrder('asc');
                            }
                          }}>
                        Party Name {sortBy === 'name' && (sortOrder === 'asc' ? '↑' : '↓')}
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                          onClick={() => {
                            if (sortBy === 'utilization') {
                              setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
                            } else {
                              setSortBy('utilization');
                              setSortOrder('desc');
                            }
                          }}>
                        Utilization {sortBy === 'utilization' && (sortOrder === 'asc' ? '↑' : '↓')}
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Credit Limit
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                          onClick={() => {
                            if (sortBy === 'balance') {
                              setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
                            } else {
                              setSortBy('balance');
                              setSortOrder('desc');
                            }
                          }}>
                        Current Balance {sortBy === 'balance' && (sortOrder === 'asc' ? '↑' : '↓')}
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Available Credit
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {sortedParties().map((party) => (
                      <tr
                        key={party.id}
                        className="hover:bg-gray-50 cursor-pointer transition-colors"
                        onClick={() => handlePartyClick(party.id, activeTab === 'customers' ? 'customer' : 'supplier')}
                      >
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="font-medium text-gray-900">{party.name}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <div className="w-24 bg-gray-200 rounded-full h-2">
                              <div
                                className={`h-2 rounded-full ${
                                  (party.credit_utilization_percent ?? 0) >= 100
                                    ? 'bg-red-600'
                                    : (party.credit_utilization_percent ?? 0) >= 90
                                    ? 'bg-orange-500'
                                    : (party.credit_utilization_percent ?? 0) >= 70
                                    ? 'bg-yellow-500'
                                    : 'bg-green-500'
                                }`}
                                style={{
                                  width: `${Math.min(party.credit_utilization_percent ?? 0, 100)}%`,
                                }}
                              />
                            </div>
                            <span className="text-sm font-medium text-gray-900">
                              {party.credit_utilization_percent !== null
                                ? `${party.credit_utilization_percent.toFixed(1)}%`
                                : 'Unlimited'}
                            </span>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {party.credit_limit > 0
                            ? `₹${party.credit_limit.toLocaleString('en-IN')}`
                            : 'Unlimited'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          ₹{party.current_balance.toLocaleString('en-IN')}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {party.available_credit !== null
                            ? `₹${party.available_credit.toLocaleString('en-IN')}`
                            : 'Unlimited'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span
                            className={`px-2.5 py-1 rounded-full text-xs font-medium border flex items-center gap-1 w-fit ${getStatusBadge(
                              party.credit_status
                            )}`}
                          >
                            {getStatusIcon(party.credit_status)}
                            {party.credit_status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        )}
      </div>
    
  );
}
